import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 7 — EPC project execution (ADR 0036). The full booked project →
 * installation → QC → net metering → handover → completion chain over HTTP,
 * plus the field-agent boundary, material readiness, completion invariants,
 * transactional atomicity and concurrency/idempotency. Direct PostgreSQL RLS
 * proof is in `rls.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)('EPC project execution', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await makeFixtures();
    app = await bootTestApp();
    http = request(app.getHttpServer());
  });
  afterAll(async () => {
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  const login = (email: string, password: string) =>
    http.post('/api/v1/auth/login').send({ email, password });
  const cookieFor = async (email: string, password: string, membershipId: string) => {
    const res = await login(email, password);
    const cookie = sessionCookie(res);
    await http.post('/api/v1/auth/switch-tenant').set('Cookie', cookie).send({ membershipId });
    return cookie;
  };
  const adminCookie = () => cookieFor(fx.admin.email, fx.admin.password, fx.admin.membershipId);
  const adminBCookie = () => cookieFor(fx.adminB.email, fx.adminB.password, fx.adminB.membershipId);

  /** designate + log in a field agent (holds only the FIELD_AGENT role). */
  const agentCookie = async (
    adminC: string,
    who: { email: string; password: string; membershipId: string },
  ) => {
    await http
      .post('/api/v1/field-agents')
      .set('Cookie', adminC)
      .send({ membershipId: who.membershipId });
    return cookieFor(who.email, who.password, who.membershipId);
  };

  const uniq = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  async function bookedProject(cookie: string, withMaterial = false): Promise<string> {
    const lead = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({ name: `EPC ${uniq()}`, phone: `9${Math.floor(Math.random() * 1e9)}`.slice(0, 10) });
    const project = await http
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ leadId: lead.body.id });
    expect(project.status).toBe(200);
    await http.post(`/api/v1/projects/${project.body.id}/approve`).set('Cookie', cookie);
    if (withMaterial) {
      const unit = await http
        .post('/api/v1/inventory/units')
        .set('Cookie', cookie)
        .send({ code: `U${uniq()}`, name: 'Pieces' });
      const product = await http
        .post('/api/v1/inventory/products')
        .set('Cookie', cookie)
        .send({ sku: `SKU-${uniq()}`, name: 'Panel', unitId: unit.body.id });
      await http
        .post(`/api/v1/projects/${project.body.id}/materials`)
        .set('Cookie', cookie)
        .send({ productId: product.body.id, requiredQty: '10' });
    }
    return project.body.id as string;
  }

  const start = (cookie: string, id: string) =>
    http.post(`/api/v1/projects/${id}/execution/start`).set('Cookie', cookie).send({});

  async function toggleAllRequired(
    cookie: string,
    id: string,
    kind: string,
    inspectionId?: string,
  ) {
    if (inspectionId) {
      const insp = await http
        .get(`/api/v1/projects/${id}/qc/${inspectionId}`)
        .set('Cookie', cookie);
      for (const item of insp.body.checklist.filter((i: { required: boolean }) => i.required)) {
        await http
          .post(`/api/v1/projects/${id}/qc/${inspectionId}/checklist/${item.id}/toggle`)
          .set('Cookie', cookie)
          .send({ status: 'done' });
      }
      return;
    }
    const list = await http
      .get(`/api/v1/projects/${id}/checklists`)
      .query({ kind })
      .set('Cookie', cookie);
    for (const item of list.body.filter((i: { required: boolean }) => i.required)) {
      await http
        .post(`/api/v1/projects/${id}/checklists/${item.id}/toggle`)
        .set('Cookie', cookie)
        .send({ status: 'done' });
    }
  }

  // ---- golden path ------------------------------------------------

  it('runs a booked project through installation, QC, net metering, handover and completion', async () => {
    const cookie = await adminCookie();
    const agent = await agentCookie(cookie, fx.plainMember);
    const projectId = await bookedProject(cookie);

    const started = await start(cookie, projectId);
    expect(started.status).toBe(200);
    expect(started.body.executionStarted).toBe(true);
    expect(started.body.milestones).toHaveLength(11);
    expect(started.body.readiness.state).toBe('READY'); // no material lines

    // assign installation to the field agent
    const assigned = await http
      .post(`/api/v1/projects/${projectId}/installations/assign`)
      .set('Cookie', cookie)
      .send({ membershipId: fx.plainMember.membershipId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.installation.status).toBe('ASSIGNED');

    // field agent sees it
    const mine = await http.get('/api/v1/field/projects').set('Cookie', agent);
    expect(mine.status).toBe(200);
    expect(mine.body.some((p: { projectId: string }) => p.projectId === projectId)).toBe(true);

    // start installation
    const startInst = await http
      .post(`/api/v1/projects/${projectId}/installations/start`)
      .set('Cookie', agent)
      .send({});
    expect(startInst.status).toBe(200);
    expect(startInst.body.installation.status).toBe('IN_PROGRESS');

    // completing before the checklist is done is blocked
    const early = await http
      .post(`/api/v1/projects/${projectId}/installations/complete`)
      .set('Cookie', agent)
      .send({});
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INSTALLATION_CHECKLIST_INCOMPLETE');

    // upload a photo
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgDTD2qgAAAAASUVORK5CYII=',
      'base64',
    );
    const up = await http
      .post(`/api/v1/projects/${projectId}/execution/attachments`)
      .query({ entityKind: 'installation', entityId: startInst.body.installation.id })
      .set('Cookie', agent)
      .attach('file', png, { filename: 'install.png', contentType: 'image/png' });
    expect(up.status).toBe(200);

    await toggleAllRequired(agent, projectId, 'installation');
    const doneInst = await http
      .post(`/api/v1/projects/${projectId}/installations/complete`)
      .set('Cookie', agent)
      .send({ notes: 'All good', equipmentInstalled: '1x inverter' });
    expect(doneInst.status).toBe(200);
    expect(doneInst.body.installation.status).toBe('COMPLETED');
    expect(
      doneInst.body.milestones.find((m: { key: string }) => m.key === 'INSTALLATION_COMPLETED')
        .status,
    ).toBe('done');

    // QC
    const qc = await http.post(`/api/v1/projects/${projectId}/qc`).set('Cookie', cookie).send({});
    expect(qc.status).toBe(200);
    const inspectionId = qc.body.qcInspections[0].id;

    // raise a defect -> QC pass is blocked
    const defect = await http
      .post(`/api/v1/projects/${projectId}/defects`)
      .set('Cookie', cookie)
      .send({
        description: 'Loose bracket',
        severity: 'high',
        assignedMembershipId: fx.plainMember.membershipId,
      });
    expect(defect.status).toBe(200);
    await toggleAllRequired(cookie, projectId, 'qc', inspectionId);
    const blocked = await http
      .post(`/api/v1/projects/${projectId}/qc/${inspectionId}/pass`)
      .set('Cookie', cookie);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('QC_BLOCKING_DEFECTS');

    // agent resolves the defect, admin verifies
    const resolved = await http
      .patch(`/api/v1/projects/${projectId}/defects/${defect.body.id}`)
      .set('Cookie', agent)
      .send({ status: 'RESOLVED', resolutionNote: 'Re-torqued' });
    expect(resolved.status).toBe(200);
    await http
      .patch(`/api/v1/projects/${projectId}/defects/${defect.body.id}`)
      .set('Cookie', cookie)
      .send({ status: 'VERIFIED' });

    const passed = await http
      .post(`/api/v1/projects/${projectId}/qc/${inspectionId}/pass`)
      .set('Cookie', cookie);
    expect(passed.status).toBe(200);
    expect(passed.body.qcInspections[0].status).toBe('PASSED');

    // completing before net metering + handover is blocked with a specific list
    const cantComplete = await http
      .post(`/api/v1/projects/${projectId}/complete`)
      .set('Cookie', cookie);
    expect(cantComplete.status).toBe(409);
    expect(cantComplete.body.error.code).toBe('PROJECT_COMPLETION_BLOCKED');
    expect(cantComplete.body.error.details.missing).toEqual(
      expect.arrayContaining(['Net metering not completed', 'Handover not completed']),
    );

    // net metering
    await http
      .patch(`/api/v1/projects/${projectId}/net-metering`)
      .set('Cookie', cookie)
      .send({ status: 'SUBMITTED', referenceNumber: 'NM-123' });
    await http
      .patch(`/api/v1/projects/${projectId}/net-metering`)
      .set('Cookie', cookie)
      .send({ status: 'APPROVED' });
    const nmDone = await http
      .patch(`/api/v1/projects/${projectId}/net-metering`)
      .set('Cookie', cookie)
      .send({ status: 'COMPLETED' });
    expect(nmDone.status).toBe(200);
    expect(nmDone.body.netMetering.status).toBe('COMPLETED');

    // handover
    await toggleAllRequired(cookie, projectId, 'handover');
    await http.patch(`/api/v1/projects/${projectId}/handover`).set('Cookie', cookie).send({
      customerAcknowledged: true,
      acknowledgedByName: 'Customer',
      notes: 'Walkthrough done',
    });
    const ho = await http
      .post(`/api/v1/projects/${projectId}/handover/complete`)
      .set('Cookie', cookie);
    expect(ho.status).toBe(200);
    expect(ho.body.handover.status).toBe('COMPLETED');

    // complete the project
    const complete = await http
      .post(`/api/v1/projects/${projectId}/complete`)
      .set('Cookie', cookie);
    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({ completed: true, projectStatus: 'COMPLETED' });

    const project = await http.get(`/api/v1/projects/${projectId}`).set('Cookie', cookie);
    expect(project.body.status).toBe('COMPLETED');

    // CRM lead timeline shows the completion
    const view = await http.get(`/api/v1/projects/${projectId}/execution`).set('Cookie', cookie);
    const acts = await http
      .get(`/api/v1/crm/leads/${view.body.leadId}/activities`)
      .set('Cookie', cookie);
    expect(acts.body.map((a: { type: string }) => a.type)).toContain('project_completed');
  });

  // ---- material readiness + override ----------------------

  it('blocks installation start when materials are not ready unless an override is set', async () => {
    const cookie = await adminCookie();
    await agentCookie(cookie, fx.plainMember);
    const projectId = await bookedProject(cookie, true); // has an undelivered material
    await start(cookie, projectId);

    const view = await http.get(`/api/v1/projects/${projectId}/execution`).set('Cookie', cookie);
    expect(view.body.readiness.state).toBe('NOT_READY');

    await http
      .post(`/api/v1/projects/${projectId}/installations/assign`)
      .set('Cookie', cookie)
      .send({ membershipId: fx.plainMember.membershipId });

    const agent = await cookieFor(
      fx.plainMember.email,
      fx.plainMember.password,
      fx.plainMember.membershipId,
    );
    const blocked = await http
      .post(`/api/v1/projects/${projectId}/installations/start`)
      .set('Cookie', agent)
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('MATERIAL_NOT_READY');

    // an authorised user sets the override
    const override = await http
      .post(`/api/v1/projects/${projectId}/installations/material-override`)
      .set('Cookie', cookie)
      .send({ reason: 'Customer wants to proceed with partial stock' });
    expect(override.status).toBe(200);
    expect(override.body.installation.materialOverride).toBe(true);

    const ok = await http
      .post(`/api/v1/projects/${projectId}/installations/start`)
      .set('Cookie', agent)
      .send({});
    expect(ok.status).toBe(200);
  });

  // ---- field-agent boundary --------------------------------

  it('a field agent only sees and touches their assigned projects', async () => {
    const cookie = await adminCookie();
    const agentA = await agentCookie(cookie, fx.plainMember);
    const agentB = await agentCookie(cookie, fx.limited);

    const projectId = await bookedProject(cookie);
    await start(cookie, projectId);
    await http
      .post(`/api/v1/projects/${projectId}/installations/assign`)
      .set('Cookie', cookie)
      .send({ membershipId: fx.plainMember.membershipId });

    // the assigned agent can view it
    expect(
      (await http.get(`/api/v1/field/projects/${projectId}`).set('Cookie', agentA)).status,
    ).toBe(200);
    // an unassigned agent cannot
    const denied = await http.get(`/api/v1/field/projects/${projectId}`).set('Cookie', agentB);
    expect(denied.status).toBe(403);

    // a field agent has no admin execution powers
    expect(
      (
        await http
          .post(`/api/v1/projects/${projectId}/execution/start`)
          .set('Cookie', agentA)
          .send({})
      ).status,
    ).toBe(403);
    expect(
      (
        await http
          .post(`/api/v1/projects/${projectId}/installations/assign`)
          .set('Cookie', agentA)
          .send({ membershipId: fx.limited.membershipId })
      ).status,
    ).toBe(403);
    expect(
      (await http.post(`/api/v1/projects/${projectId}/qc`).set('Cookie', agentA).send({})).status,
    ).toBe(403);
    expect(
      (await http.post(`/api/v1/projects/${projectId}/complete`).set('Cookie', agentA)).status,
    ).toBe(403);
  });

  // ---- tenant isolation + attachment auth -----------------

  it('tenant B cannot read a tenant A execution workspace or its attachments', async () => {
    const cookie = await adminCookie();
    const bCookie = await adminBCookie();
    const projectId = await bookedProject(cookie);
    await start(cookie, projectId);
    const view = await http.get(`/api/v1/projects/${projectId}/execution`).set('Cookie', cookie);

    expect(
      (await http.get(`/api/v1/projects/${projectId}/execution`).set('Cookie', bCookie)).status,
    ).toBe(404);
    expect(
      (
        await http
          .post(`/api/v1/projects/${projectId}/execution/start`)
          .set('Cookie', bCookie)
          .send({})
      ).status,
    ).toBe(404);

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgDTD2qgAAAAASUVORK5CYII=',
      'base64',
    );
    const up = await http
      .post(`/api/v1/projects/${projectId}/execution/attachments`)
      .query({ entityKind: 'handover', entityId: view.body.handover.id })
      .set('Cookie', cookie)
      .attach('file', png, { filename: 'doc.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    const bDl = await http
      .get(`/api/v1/projects/${projectId}/execution/attachments/${up.body.id}/download`)
      .set('Cookie', bCookie);
    expect([403, 404]).toContain(bDl.status);
  });

  // ---- concurrency / idempotency -------------------------

  it('duplicate/concurrent completions each resolve to exactly one transition', async () => {
    const cookie = await adminCookie();
    const agent = await agentCookie(cookie, fx.plainMember);
    const projectId = await bookedProject(cookie);
    await start(cookie, projectId);
    await http
      .post(`/api/v1/projects/${projectId}/installations/assign`)
      .set('Cookie', cookie)
      .send({ membershipId: fx.plainMember.membershipId });
    await http
      .post(`/api/v1/projects/${projectId}/installations/start`)
      .set('Cookie', agent)
      .send({});
    await toggleAllRequired(agent, projectId, 'installation');

    const [a, b] = await Promise.all([
      http
        .post(`/api/v1/projects/${projectId}/installations/complete`)
        .set('Cookie', agent)
        .send({}),
      http
        .post(`/api/v1/projects/${projectId}/installations/complete`)
        .set('Cookie', agent)
        .send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);

    const qc = await http.post(`/api/v1/projects/${projectId}/qc`).set('Cookie', cookie).send({});
    const inspectionId = qc.body.qcInspections[0].id;
    await toggleAllRequired(cookie, projectId, 'qc', inspectionId);
    const [p1, p2] = await Promise.all([
      http.post(`/api/v1/projects/${projectId}/qc/${inspectionId}/pass`).set('Cookie', cookie),
      http.post(`/api/v1/projects/${projectId}/qc/${inspectionId}/pass`).set('Cookie', cookie),
    ]);
    expect([p1.status, p2.status].sort()).toEqual([200, 200]);

    await http
      .patch(`/api/v1/projects/${projectId}/net-metering`)
      .set('Cookie', cookie)
      .send({ notRequired: true });
    await toggleAllRequired(cookie, projectId, 'handover');
    await http
      .patch(`/api/v1/projects/${projectId}/handover`)
      .set('Cookie', cookie)
      .send({ customerAcknowledged: true });
    const [h1, h2] = await Promise.all([
      http.post(`/api/v1/projects/${projectId}/handover/complete`).set('Cookie', cookie),
      http.post(`/api/v1/projects/${projectId}/handover/complete`).set('Cookie', cookie),
    ]);
    expect([h1.status, h2.status].sort()).toEqual([200, 200]);

    const [c1, c2] = await Promise.all([
      http.post(`/api/v1/projects/${projectId}/complete`).set('Cookie', cookie),
      http.post(`/api/v1/projects/${projectId}/complete`).set('Cookie', cookie),
    ]);
    expect([c1.status, c2.status].sort()).toEqual([200, 200]);

    const view = await http.get(`/api/v1/projects/${projectId}/execution`).set('Cookie', cookie);
    const acts = await http
      .get(`/api/v1/crm/leads/${view.body.leadId}/activities`)
      .set('Cookie', cookie);
    expect(acts.body.filter((x: { type: string }) => x.type === 'project_completed')).toHaveLength(
      1,
    );
  });

  it('rejects unauthenticated callers', async () => {
    expect(
      (await http.get('/api/v1/projects/00000000-0000-7000-8000-000000000000/execution')).status,
    ).toBe(401);
  });
});
