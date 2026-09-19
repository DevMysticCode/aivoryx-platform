import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import {
  addTenantMember,
  createTenantWithModules,
  makeFixtures,
  rawPool,
  type Fixtures,
  type UserFixture,
} from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 18 — CRM ↔ Field ↔ Commercial workflow integration. Proves the
 * boundaries, not just the happy path: a cross-module action needs access to
 * BOTH sides (module + permission + CRM data scope), never leaks that an
 * inaccessible record exists, and every module keeps working when a neighbour is
 * not enabled.
 */
describe.skipIf(!INTEGRATION_ENABLED)('CRM ↔ Field ↔ Commercial (Phase 18)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;
  let pool: Pool;

  beforeAll(async () => {
    fx = await makeFixtures();
    app = await bootTestApp();
    http = request(app.getHttpServer());
    pool = await rawPool();
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  const cookieFor = async (u: UserFixture) => {
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password });
    const cookie = sessionCookie(res);
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: u.membershipId });
    return cookie;
  };
  const adminCookie = () => cookieFor(fx.admin);

  /** Give a member a PROFILE role with exactly these permissions and a data scope. */
  async function grantProfile(
    membershipId: string,
    keys: string[],
    dataScope: 'OWN' | 'TEAM' | 'DEPARTMENT' | 'COMPANY' = 'COMPANY',
    tenantId = fx.tenantA,
  ) {
    const roleId = randomUUID();
    await pool.query(
      `insert into roles (id, tenant_id, key, name, kind) values ($1,$2,$3,$4,'profile')`,
      [roleId, tenantId, `P18_${roleId.slice(0, 8)}`, 'Phase 18 test profile'],
    );
    const rows = await pool.query('select id from permissions where key = any($1)', [keys]);
    for (const r of rows.rows as { id: string }[]) {
      await pool.query(
        'insert into role_permissions (role_id, tenant_id, permission_id) values ($1,$2,$3)',
        [roleId, tenantId, r.id],
      );
    }
    await pool.query(
      'insert into membership_roles (membership_id, role_id, tenant_id, data_scope) values ($1,$2,$3,$4)',
      [membershipId, roleId, tenantId, dataScope],
    );
  }

  const phone = () => `9${Math.floor(Math.random() * 1_000_000_000)}`.slice(0, 10);
  async function createLead(cookie: string, patch: Record<string, unknown> = {}) {
    const res = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({ name: `P18 Lead ${randomUUID().slice(0, 6)}`, phone: phone(), ...patch });
    expect(res.status).toBe(200);
    return res.body as { id: string; name: string };
  }
  const assignLead = (cookie: string, leadId: string, membershipId: string) =>
    http.post(`/api/v1/crm/leads/${leadId}/assign`).set('Cookie', cookie).send({ membershipId });
  const when = () => new Date(Date.now() + 86_400_000).toISOString();
  const schedule = (cookie: string, leadId: string, patch: Record<string, unknown> = {}) =>
    http
      .post('/api/v1/visits')
      .set('Cookie', cookie)
      .send({ leadId, scheduledAt: when(), ...patch });

  const CRM_READ = ['crm.leads.read', 'crm.activities.read'];
  const FIELD_MANAGE = ['field.visits.read', 'field.visits.create', 'field.visits.assign'];

  /** A field agent (designated) who has checked in/out, ready to complete. */
  async function agentWithVisit(admin: string, leadId: string, agent: UserFixture) {
    await http
      .post('/api/v1/field-agents')
      .set('Cookie', admin)
      .send({ membershipId: agent.membershipId });
    const visit = await schedule(admin, leadId, { assignedMembershipId: agent.membershipId });
    expect(visit.status).toBe(200);
    const agentC = await cookieFor(agent);
    await http
      .post(`/api/v1/visits/${visit.body.id}/check-in`)
      .set('Cookie', agentC)
      .send({ lat: 12.97, lng: 77.59, accuracyM: 5 });
    await http
      .post(`/api/v1/visits/${visit.body.id}/check-out`)
      .set('Cookie', agentC)
      .send({ lat: 12.97, lng: 77.59 });
    return { visitId: visit.body.id as string, agentC };
  }

  // ---- CRM → Field --------------------------------------------------

  describe('CRM → Field: scheduling a visit from a lead', () => {
    it('creates a visit that keeps the lead reference, snapshots the lead address and records instructions', async () => {
      const admin = await adminCookie();
      const lead = await createLead(admin, { addressLine: '12 Solar Way', city: 'Pune' });
      const res = await schedule(admin, lead.id, {
        instructions: 'Ring the bell twice; dog in the yard.',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        leadId: lead.id,
        addressLine: '12 Solar Way',
        city: 'Pune',
        outcome: null,
      });

      const notes = await http.get(`/api/v1/visits/${res.body.id}/notes`).set('Cookie', admin);
      expect(notes.body.map((n: { body: string }) => n.body)).toContain(
        'Ring the bell twice; dog in the yard.',
      );

      // the lead's timeline and its visit list both know about it — no duplicated lead data
      const list = await http.get(`/api/v1/visits?leadId=${lead.id}`).set('Cookie', admin);
      expect(list.body.items.map((v: { id: string }) => v.id)).toContain(res.body.id);
      const acts = await http.get(`/api/v1/crm/leads/${lead.id}/activities`).set('Cookie', admin);
      expect(JSON.stringify(acts.body)).toContain('visit_scheduled');
    });

    it('needs BOTH sides: Field permission without CRM access is refused, CRM access without Field permission is refused', async () => {
      const admin = await adminCookie();
      const lead = await createLead(admin);

      const fieldOnly = await addTenantMember(fx.tenantA);
      await grantProfile(fieldOnly.membershipId, FIELD_MANAGE);
      const a = await schedule(await cookieFor(fieldOnly), lead.id);
      expect(a.status).toBe(403);
      expect(a.body.error.code).toBe('VISIT_CRM_ACCESS_REQUIRED');

      const crmOnly = await addTenantMember(fx.tenantA);
      await grantProfile(crmOnly.membershipId, CRM_READ);
      const b = await schedule(await cookieFor(crmOnly), lead.id);
      expect(b.status).toBe(403);
      expect(b.body.error.code).toBe('AUTH_FORBIDDEN');

      const both = await addTenantMember(fx.tenantA);
      await grantProfile(both.membershipId, [...CRM_READ, ...FIELD_MANAGE]);
      expect((await schedule(await cookieFor(both), lead.id)).status).toBe(200);
    });

    it('CRM data scope is not bypassed: an OWN-scoped user cannot schedule for, list, or open another user’s lead or its visits', async () => {
      const admin = await adminCookie();
      const rep = await addTenantMember(fx.tenantA);
      await grantProfile(rep.membershipId, [...CRM_READ, ...FIELD_MANAGE], 'OWN');
      const mine = await createLead(admin);
      const theirs = await createLead(admin);
      expect((await assignLead(admin, mine.id, rep.membershipId)).status).toBe(200);
      const theirVisit = await schedule(admin, theirs.id);
      expect(theirVisit.status).toBe(200);

      const cookie = await cookieFor(rep);
      const ok = await schedule(cookie, mine.id);
      expect(ok.status).toBe(200);

      const denied = await schedule(cookie, theirs.id);
      expect(denied.status).toBe(404);
      expect(denied.body.error.code).toBe('LEAD_NOT_FOUND'); // exactly a missing lead — nothing to learn

      // the lead's visits: empty for the lead they cannot open, and never listed generally
      const byLead = await http.get(`/api/v1/visits?leadId=${theirs.id}`).set('Cookie', cookie);
      expect(byLead.status).toBe(200);
      expect(byLead.body.items).toEqual([]);
      const all = await http.get('/api/v1/visits?pageSize=100').set('Cookie', cookie);
      const ids = all.body.items.map((v: { id: string }) => v.id);
      expect(ids).toContain(ok.body.id);
      expect(ids).not.toContain(theirVisit.body.id);
      expect(
        (await http.get(`/api/v1/visits/${theirVisit.body.id}`).set('Cookie', cookie)).status,
      ).toBe(404);

      // and CRM itself agrees
      expect((await http.get(`/api/v1/crm/leads/${theirs.id}`).set('Cookie', cookie)).status).toBe(
        404,
      );
      const leads = await http.get('/api/v1/crm/leads?pageSize=100').set('Cookie', cookie);
      expect(leads.body.items.map((l: { id: string }) => l.id)).toEqual([mine.id]);
    });

    it('an OWN-scoped rep can still create a lead and hand their own lead to a colleague (writes are never blocked by the scope)', async () => {
      const admin = await adminCookie();
      const rep = await addTenantMember(fx.tenantA);
      await grantProfile(
        rep.membershipId,
        [...CRM_READ, 'crm.leads.create', 'crm.leads.assign', 'crm.leads.update'],
        'OWN',
      );
      const cookie = await cookieFor(rep);
      const created = await http
        .post('/api/v1/crm/leads')
        .set('Cookie', cookie)
        .send({ name: 'Rep Lead', phone: phone() });
      expect(created.status).toBe(200);
      // unassigned, so outside their OWN scope until assigned — but the write itself succeeded
      expect(
        (await http.get(`/api/v1/crm/leads/${created.body.id}`).set('Cookie', cookie)).status,
      ).toBe(404);
      await assignLead(admin, created.body.id, rep.membershipId);
      expect(
        (await http.get(`/api/v1/crm/leads/${created.body.id}`).set('Cookie', cookie)).status,
      ).toBe(200);
      const handed = await assignLead(cookie, created.body.id, fx.secondAdmin.membershipId);
      expect(handed.status).toBe(200);
      expect(handed.body.assignee.membershipId).toBe(fx.secondAdmin.membershipId);
    });

    it('a disqualified lead cannot be visited', async () => {
      const admin = await adminCookie();
      const lead = await createLead(admin);
      await http
        .post(`/api/v1/crm/leads/${lead.id}/qualify`)
        .set('Cookie', admin)
        .send({ outcome: 'DISQUALIFIED', note: 'no roof' });
      const res = await schedule(admin, lead.id);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VISIT_LEAD_NOT_ELIGIBLE');
    });

    it('tenant isolation: another workspace can neither schedule against nor read this workspace’s records', async () => {
      const admin = await adminCookie();
      const lead = await createLead(admin);
      const visit = await schedule(admin, lead.id);
      const adminB = await cookieFor({ ...fx.adminB, membershipId: fx.adminB.membershipId });
      const cross = await schedule(adminB, lead.id);
      expect(cross.status).toBe(404);
      expect((await http.get(`/api/v1/visits/${visit.body.id}`).set('Cookie', adminB)).status).toBe(
        404,
      );
      expect(
        (await http.get(`/api/v1/visits?leadId=${lead.id}`).set('Cookie', adminB)).body.items,
      ).toEqual([]);
    });
  });

  // ---- Field → CRM ----------------------------------------------------

  describe('Field → CRM: visit outcome and follow-up', () => {
    it('records the outcome, surfaces it on the lead timeline and audits it', async () => {
      const admin = await adminCookie();
      const agent = await addTenantMember(fx.tenantA);
      const lead = await createLead(admin);
      const { visitId, agentC } = await agentWithVisit(admin, lead.id, agent);
      const done = await http
        .post(`/api/v1/visits/${visitId}/complete`)
        .set('Cookie', agentC)
        .send({ outcome: 'SUITABLE', outcomeNote: 'South-facing roof, 40 m²' });
      expect(done.status).toBe(200);
      expect(done.body).toMatchObject({
        status: 'COMPLETED',
        outcome: 'SUITABLE',
        outcomeNote: 'South-facing roof, 40 m²',
      });

      const row = await pool.query(
        `select payload from lead_activities where tenant_id=$1 and lead_id=$2 and type='visit_completed'`,
        [fx.tenantA, lead.id],
      );
      expect(row.rows[0].payload.outcome).toBe('SUITABLE');
      const audit = await pool.query(
        `select metadata from audit_logs where tenant_id=$1 and action='field.visit.completed' and entity_id=$2`,
        [fx.tenantA, visitId],
      );
      expect(audit.rows[0].metadata.outcome).toBe('SUITABLE');
      // SUITABLE alone does not create a follow-up
      const fu = await http.get(`/api/v1/crm/leads/${lead.id}/followups`).set('Cookie', admin);
      expect(fu.body).toEqual([]);
    });

    it('FOLLOW_UP_REQUIRED creates the CRM follow-up atomically (assigned to the lead owner) and audits it', async () => {
      const admin = await adminCookie();
      const agent = await addTenantMember(fx.tenantA);
      const owner = fx.secondAdmin;
      const lead = await createLead(admin);
      await assignLead(admin, lead.id, owner.membershipId);
      const { visitId, agentC } = await agentWithVisit(admin, lead.id, agent);
      const due = new Date(Date.now() + 3 * 86_400_000).toISOString();
      const done = await http
        .post(`/api/v1/visits/${visitId}/complete`)
        .set('Cookie', agentC)
        .send({
          outcome: 'FOLLOW_UP_REQUIRED',
          outcomeNote: 'Owner wants a second opinion',
          followUpDueAt: due,
        });
      expect(done.status).toBe(200);

      const fu = await http.get(`/api/v1/crm/leads/${lead.id}/followups`).set('Cookie', admin);
      expect(fu.body).toHaveLength(1);
      expect(fu.body[0]).toMatchObject({
        status: 'pending',
        assignedMembershipId: owner.membershipId,
      });
      expect(fu.body[0].note).toContain('Owner wants a second opinion');
      const audit = await pool.query(
        `select metadata from audit_logs where tenant_id=$1 and action='crm.lead.followup_created' and entity_id=$2`,
        [fx.tenantA, lead.id],
      );
      expect(audit.rows[0].metadata).toMatchObject({ source: 'field_visit', visitId });
      // the notification engine gets the outcome (so the lead owner can be told)
      const ev = await pool.query(
        `select payload from outbox_events where tenant_id=$1 and type='visit.completed' and payload->>'visitId'=$2`,
        [fx.tenantA, visitId],
      );
      expect(ev.rows[0].payload.outcome).toBe('FOLLOW_UP_REQUIRED');
    });

    it('completing without an outcome still works (existing Field workflow unchanged)', async () => {
      const admin = await adminCookie();
      const agent = await addTenantMember(fx.tenantA);
      const lead = await createLead(admin);
      const { visitId, agentC } = await agentWithVisit(admin, lead.id, agent);
      const done = await http.post(`/api/v1/visits/${visitId}/complete`).set('Cookie', agentC);
      expect(done.status).toBe(200);
      expect(done.body.outcome).toBeNull();
    });

    it('rejects an outcome that is not part of the Field domain', async () => {
      const admin = await adminCookie();
      const agent = await addTenantMember(fx.tenantA);
      const lead = await createLead(admin);
      const { visitId, agentC } = await agentWithVisit(admin, lead.id, agent);
      const bad = await http
        .post(`/api/v1/visits/${visitId}/complete`)
        .set('Cookie', agentC)
        .send({ outcome: 'SOLD' });
      expect(bad.status).toBe(400);
    });

    it('a field agent sees only the lead context on their own visit — no CRM access is implied', async () => {
      const admin = await adminCookie();
      const agent = await addTenantMember(fx.tenantA);
      const lead = await createLead(admin, { email: 'private@example.test' });
      const { visitId, agentC } = await agentWithVisit(admin, lead.id, agent);
      const v = await http.get(`/api/v1/visits/${visitId}`).set('Cookie', agentC);
      expect(v.status).toBe(200);
      expect(v.body.leadName).toBe(lead.name);
      expect(JSON.stringify(v.body)).not.toContain('private@example.test');
      // …and the CRM routes stay closed to them
      expect((await http.get(`/api/v1/crm/leads/${lead.id}`).set('Cookie', agentC)).status).toBe(
        403,
      );
      expect(
        (await http.get(`/api/v1/crm/leads/${lead.id}/followups`).set('Cookie', agentC)).status,
      ).toBe(403);
      // another agent's visit is invisible to them
      const otherLead = await createLead(admin);
      const other = await schedule(admin, otherLead.id);
      expect((await http.get(`/api/v1/visits/${other.body.id}`).set('Cookie', agentC)).status).toBe(
        403,
      );
    });

    it('dashboards get real counts, bound to the caller’s visibility', async () => {
      const admin = await adminCookie();
      const s = await http.get('/api/v1/visits/summary').set('Cookie', admin);
      expect(s.status).toBe(200);
      expect(s.body.followUpRequired).toBeGreaterThanOrEqual(1);
      expect(s.body.scheduledNext7Days).toBeGreaterThanOrEqual(1);
      const limited = await cookieFor(fx.limited);
      expect((await http.get('/api/v1/visits/summary').set('Cookie', limited)).status).toBe(403);
    });
  });

  // ---- CRM/Field → Commercial ----------------------------------------------

  describe('CRM / Field → Commercial: quotation context', () => {
    async function completedVisit(admin: string, leadId: string) {
      const agent = await addTenantMember(fx.tenantA);
      const { visitId, agentC } = await agentWithVisit(admin, leadId, agent);
      await http
        .post(`/api/v1/visits/${visitId}/complete`)
        .set('Cookie', agentC)
        .send({ outcome: 'SUITABLE' });
      return visitId;
    }

    it('a quotation can reference the completed visit it was prepared from and shows it back', async () => {
      const admin = await adminCookie();
      const lead = await createLead(admin);
      const visitId = await completedVisit(admin, lead.id);
      const q = await http
        .post('/api/v1/quotations')
        .set('Cookie', admin)
        .send({ leadId: lead.id, visitId });
      expect(q.status).toBe(200);
      expect(q.body.visitId).toBe(visitId);
      expect(q.body.visit).toMatchObject({ id: visitId, status: 'COMPLETED', outcome: 'SUITABLE' });
      const audit = await pool.query(
        `select metadata from audit_logs where tenant_id=$1 and action='quotation.created' and entity_id=$2`,
        [fx.tenantA, q.body.id],
      );
      expect(audit.rows[0].metadata.visitId).toBe(visitId);
      // the row keeps only a typed reference — no Field data was copied into Commercial
      const row = await pool.query('select visit_id from quotations where id=$1', [q.body.id]);
      expect(row.rows[0].visit_id).toBe(visitId);
    });

    it('rejects a visit from another lead, and a visit that is not completed', async () => {
      const admin = await adminCookie();
      const lead = await createLead(admin);
      const otherLead = await createLead(admin);
      const visitId = await completedVisit(admin, lead.id);
      const mismatch = await http
        .post('/api/v1/quotations')
        .set('Cookie', admin)
        .send({ leadId: otherLead.id, visitId });
      expect(mismatch.status).toBe(422);
      expect(mismatch.body.error.code).toBe('QUOTATION_VISIT_LEAD_MISMATCH');
      const open = await schedule(admin, lead.id);
      const notDone = await http
        .post('/api/v1/quotations')
        .set('Cookie', admin)
        .send({ leadId: lead.id, visitId: open.body.id });
      expect(notDone.status).toBe(422);
      expect(notDone.body.error.code).toBe('QUOTATION_VISIT_NOT_COMPLETED');
    });

    it('never reveals a visit the caller cannot see: creation is a plain 404, and the detail hides the reference', async () => {
      const admin = await adminCookie();
      const lead = await createLead(admin);
      const visitId = await completedVisit(admin, lead.id);
      const q = await http
        .post('/api/v1/quotations')
        .set('Cookie', admin)
        .send({ leadId: lead.id, visitId });

      const sales = await addTenantMember(fx.tenantA);
      await grantProfile(sales.membershipId, [...CRM_READ, 'quotations.read', 'quotations.create']);
      const cookie = await cookieFor(sales);
      const create = await http
        .post('/api/v1/quotations')
        .set('Cookie', cookie)
        .send({ leadId: lead.id, visitId });
      expect(create.status).toBe(404);
      expect(create.body.error.code).toBe('VISIT_NOT_FOUND');
      const detail = await http.get(`/api/v1/quotations/${q.body.id}`).set('Cookie', cookie);
      expect(detail.status).toBe(200);
      expect(detail.body.visitId).toBeNull();
      expect(detail.body.visit).toBeNull();
    });

    it('creating a quotation needs CRM access to the lead where CRM is enabled (permission and data scope)', async () => {
      const admin = await adminCookie();
      const lead = await createLead(admin);
      const noCrm = await addTenantMember(fx.tenantA);
      await grantProfile(noCrm.membershipId, ['quotations.read', 'quotations.create']);
      const a = await http
        .post('/api/v1/quotations')
        .set('Cookie', await cookieFor(noCrm))
        .send({ leadId: lead.id });
      expect(a.status).toBe(403);
      expect(a.body.error.code).toBe('QUOTATION_CRM_ACCESS_REQUIRED');

      const own = await addTenantMember(fx.tenantA);
      await grantProfile(
        own.membershipId,
        [...CRM_READ, 'quotations.read', 'quotations.create'],
        'OWN',
      );
      const b = await http
        .post('/api/v1/quotations')
        .set('Cookie', await cookieFor(own))
        .send({ leadId: lead.id });
      expect(b.status).toBe(404); // not their lead
      await assignLead(admin, lead.id, own.membershipId);
      const c = await http
        .post('/api/v1/quotations')
        .set('Cookie', await cookieFor(own))
        .send({ leadId: lead.id });
      expect(c.status).toBe(200);
    });

    it('lists quotations by project, and reports the real pipeline', async () => {
      const admin = await adminCookie();
      const byProject = await http
        .get(`/api/v1/quotations?projectId=${randomUUID()}`)
        .set('Cookie', admin);
      expect(byProject.status).toBe(200);
      expect(byProject.body.total).toBe(0);
      const lead = await createLead(admin);
      await http
        .post(`/api/v1/crm/leads/${lead.id}/qualify`)
        .set('Cookie', admin)
        .send({ outcome: 'QUALIFIED', note: 'ok' });
      const before = await http.get('/api/v1/quotations/pipeline-summary').set('Cookie', admin);
      expect(before.body.qualifiedAwaitingQuotation).toBeGreaterThanOrEqual(1);
      await http.post('/api/v1/quotations').set('Cookie', admin).send({ leadId: lead.id });
      const after = await http.get('/api/v1/quotations/pipeline-summary').set('Cookie', admin);
      expect(after.body.qualifiedAwaitingQuotation).toBe(
        before.body.qualifiedAwaitingQuotation - 1,
      );
      expect(after.body.draft).toBeGreaterThan(before.body.draft);
    });
  });

  // ---- module combinations -----------------------------------------------

  describe('optional module composition', () => {
    it('CRM + Commercial, Field DISABLED: CRM and quotations work; Field routes are closed; a visit cannot be referenced', async () => {
      const t = await createTenantWithModules({
        name: 'No Field Co',
        moduleKeys: ['CRM', 'COMMERCIAL'],
      });
      const admin = await cookieFor(t.admin);
      const lead = await createLead(admin);
      expect(
        (
          await http
            .post(`/api/v1/crm/leads/${lead.id}/qualify`)
            .set('Cookie', admin)
            .send({ outcome: 'QUALIFIED', note: 'ok' })
        ).status,
      ).toBe(200);
      const q = await http
        .post('/api/v1/quotations')
        .set('Cookie', admin)
        .send({ leadId: lead.id });
      expect(q.status).toBe(200);
      expect(q.body.visit).toBeNull();

      for (const [verb, path] of [
        ['post', '/api/v1/visits'],
        ['get', '/api/v1/visits'],
        ['get', '/api/v1/visits/summary'],
      ] as const) {
        const res = await http[verb](path)
          .set('Cookie', admin)
          .send({ leadId: lead.id, scheduledAt: when() });
        expect(res.status, path).toBe(403);
        expect(res.body.error.code, path).toBe('ENTITLEMENT_MODULE_NOT_ENABLED');
      }
      const ref = await http
        .post('/api/v1/quotations')
        .set('Cookie', admin)
        .send({ leadId: lead.id, visitId: randomUUID() });
      expect(ref.status).toBe(404);
    });

    it('Field only, CRM DISABLED: visits still work end to end and completion never needs CRM', async () => {
      const t = await createTenantWithModules({ name: 'Field Only Co', moduleKeys: ['FIELD'] });
      const admin = await cookieFor(t.admin);
      // CRM is off, so there is no CRM API to create a lead — seed the record the visit references
      const leadId = randomUUID();
      await pool.query(
        `insert into leads (id, tenant_id, name, phone, status, origin) values ($1,$2,'Standalone Lead','9000000001','NEW','manual')`,
        [leadId, t.tenantId],
      );
      const v = await schedule(admin, leadId, { assignedMembershipId: undefined });
      expect(v.status).toBe(200);
      expect((await http.get(`/api/v1/visits/${v.body.id}`).set('Cookie', admin)).status).toBe(200);
      expect((await http.get('/api/v1/visits/summary').set('Cookie', admin)).status).toBe(200);
      const crm = await http.get(`/api/v1/crm/leads/${leadId}`).set('Cookie', admin);
      expect(crm.status).toBe(403);
      expect(crm.body.error.code).toBe('ENTITLEMENT_MODULE_NOT_ENABLED');
    });

    it('a follow-up outcome with CRM disabled completes the visit and simply creates no follow-up', async () => {
      const t = await createTenantWithModules({ name: 'Field Outcome Co', moduleKeys: ['FIELD'] });
      const admin = await cookieFor(t.admin);
      const leadId = randomUUID();
      await pool.query(
        `insert into leads (id, tenant_id, name, phone, status, origin) values ($1,$2,'Standalone','9000000002','NEW','manual')`,
        [leadId, t.tenantId],
      );
      await http
        .post('/api/v1/field-agents')
        .set('Cookie', admin)
        .send({ membershipId: t.admin.membershipId });
      const v = await schedule(admin, leadId, { assignedMembershipId: t.admin.membershipId });
      await http
        .post(`/api/v1/visits/${v.body.id}/check-in`)
        .set('Cookie', admin)
        .send({ lat: 1, lng: 1 });
      await http
        .post(`/api/v1/visits/${v.body.id}/check-out`)
        .set('Cookie', admin)
        .send({ lat: 1, lng: 1 });
      const done = await http
        .post(`/api/v1/visits/${v.body.id}/complete`)
        .set('Cookie', admin)
        .send({ outcome: 'FOLLOW_UP_REQUIRED' });
      expect(done.status).toBe(200);
      const fu = await pool.query(
        'select count(*)::int as n from lead_followups where tenant_id=$1',
        [t.tenantId],
      );
      expect(fu.rows[0].n).toBe(0);
    });

    it('CRM only: a lead has no visits section data and nothing breaks', async () => {
      const t = await createTenantWithModules({ name: 'CRM Only Co', moduleKeys: ['CRM'] });
      const admin = await cookieFor(t.admin);
      const lead = await createLead(admin);
      expect((await http.get(`/api/v1/crm/leads/${lead.id}`).set('Cookie', admin)).status).toBe(
        200,
      );
      expect((await http.get(`/api/v1/visits?leadId=${lead.id}`).set('Cookie', admin)).status).toBe(
        403,
      );
      expect((await http.get('/api/v1/quotations').set('Cookie', admin)).status).toBe(403);
    });
  });
});
