import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Cross-module golden-path integration test (Existing Modules Reliability
 * Audit follow-up, see `docs/architecture/CUSTOMER-LAUNCH-READINESS.md`
 * §13.6/§13.9). Each module already has a strong lifecycle suite of its own
 * (`integrations*.int.spec.ts`, `crm.int.spec.ts`, `field.int.spec.ts`,
 * `commercial.int.spec.ts`, `execution.int.spec.ts`). What none of them
 * proves is the actual chained hand-off BETWEEN modules through the real,
 * implemented relationships:
 *
 *   lead ingestion (webhook) -> CRM lead -> field visit (visits.leadId) ->
 *   quotation (quotations.leadId + quotations.visitId, a real typed
 *   reference) -> booking (creates/activates the Phase 5 project,
 *   quotations.projectId) -> EPC execution (project_installations.projectId,
 *   with an optional project_installations.visitId back-reference to the
 *   same field visit).
 *
 * This file does not re-prove each module's own internal invariants (already
 * covered elsewhere) — it proves the hand-offs themselves, plus the
 * failure/concurrency/isolation/permission properties that must hold across
 * them. There is no real implemented relationship from this chain into
 * HR/Workforce (payroll is never triggered by a project or a lead) other
 * than the existing, already-tested, read-only Field<->HR employee link
 * (`hr.int.spec.ts` "Field -> HR employee link (optional, read-only)") — so
 * no HR step is force-fitted into the chain here, per the audit's explicit
 * instruction not to invent a cross-module link that does not exist.
 */
describe.skipIf(!INTEGRATION_ENABLED)('Cross-module golden path', () => {
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
  const limitedCookie = () =>
    cookieFor(fx.limited.email, fx.limited.password, fx.limited.membershipId);

  const uniq = () => Math.random().toString(36).slice(2, 8).toUpperCase();
  const phone = () => `9${Math.floor(Math.random() * 1_000_000_000)}`.slice(0, 10);

  /** designate `fx.plainMember` as a field agent and return their logged-in cookie. */
  const fieldAgentCookie = async (adminC: string): Promise<string> => {
    await http
      .post('/api/v1/field-agents')
      .set('Cookie', adminC)
      .send({ membershipId: fx.plainMember.membershipId });
    return cookieFor(fx.plainMember.email, fx.plainMember.password, fx.plainMember.membershipId);
  };

  /** a Pabbly-style inbound source + its bearer secret, created through the real admin API. */
  async function createSource(cookie: string, keyLabel: string) {
    const key = `gp-${keyLabel}-${uniq()}`;
    const res = await http
      .post('/api/v1/admin/integrations/sources')
      .set('Cookie', cookie)
      .send({ key, name: `Golden path ${keyLabel}` });
    expect(res.status).toBe(200);
    return {
      sourceId: res.body.source.id as string,
      secret: res.body.credential.secret as string,
      key,
    };
  }

  const webhook = (key: string, secret: string, body: unknown) =>
    http
      .post(`/api/v1/integrations/webhooks/pabbly/${key}`)
      .set('Authorization', `Bearer ${secret}`)
      .send(body as object);

  async function toggleAllRequired(cookie: string, projectId: string, kind: string) {
    const list = await http
      .get(`/api/v1/projects/${projectId}/checklists`)
      .query({ kind })
      .set('Cookie', cookie);
    for (const item of list.body.filter((i: { required: boolean }) => i.required)) {
      await http
        .post(`/api/v1/projects/${projectId}/checklists/${item.id}/toggle`)
        .set('Cookie', cookie)
        .send({ status: 'done' });
    }
  }

  const draftLines = () => [
    { description: 'Solar panels (10x550W)', quantity: '10', unitPrice: '2500', taxRate: '0.18' },
    { description: 'Installation labour', quantity: '1', unitPrice: '8000', taxRate: '0.18' },
  ];

  // ------------------------------------------------------------------
  // 1. the real golden path
  // ------------------------------------------------------------------

  it('ingestion -> CRM -> field visit -> quotation -> booking -> EPC execution, asserting state at each boundary', async () => {
    const cookie = await adminCookie();
    const agentC = await fieldAgentCookie(cookie);
    const { sourceId, secret, key } = await createSource(cookie, 'main');
    const leadPhone = phone();

    // 1. ingestion: a valid lead arrives through the real webhook pipeline
    const ingest = await webhook(key, secret, {
      name: 'Golden Path Lead',
      phone: leadPhone,
      email: 'golden.path@example.test',
      city: 'Pune',
    });
    expect(ingest.status).toBe(200);
    expect(ingest.body).toMatchObject({ accepted: true, status: 'DONE', dedupeOutcome: 'new' });
    const leadId = ingest.body.leadId as string;
    expect(leadId).toBeTruthy();

    // 2. the ingested lead is durably visible in CRM, correctly attributed and normalized
    const lead = await http.get(`/api/v1/crm/leads/${leadId}`).set('Cookie', cookie);
    expect(lead.status).toBe(200);
    expect(lead.body.status).toBe('NEW');
    expect(lead.body.sourceId).toBe(sourceId);
    expect(lead.body.phone).toBe(leadPhone);
    expect(lead.body.city).toBe('Pune');

    // 3. CRM assignment + qualification (real supported transitions)
    const assigned = await http
      .post(`/api/v1/crm/leads/${leadId}/assign`)
      .set('Cookie', cookie)
      .send({ membershipId: fx.secondAdmin.membershipId });
    expect(assigned.status).toBe(200);
    expect(assigned.body.status).toBe('ASSIGNED');

    const qualified = await http
      .post(`/api/v1/crm/leads/${leadId}/qualify`)
      .set('Cookie', cookie)
      .send({ outcome: 'QUALIFIED', note: 'Good fit for rooftop solar' });
    expect(qualified.status).toBe(200);
    expect(qualified.body.status).toBe('QUALIFIED');

    // 4. a field visit is scheduled against the lead and assigned to a field agent
    const visit = await http
      .post('/api/v1/visits')
      .set('Cookie', cookie)
      .send({
        leadId,
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        assignedMembershipId: fx.plainMember.membershipId,
        siteLat: 18.5204,
        siteLng: 73.8567,
      });
    expect(visit.status).toBe(200);
    expect(visit.body.status).toBe('ASSIGNED');
    const visitId = visit.body.id as string;

    // 5. the field agent exercises the real visit lifecycle to COMPLETED
    const checkIn = await http
      .post(`/api/v1/visits/${visitId}/check-in`)
      .set('Cookie', agentC)
      .send({ lat: 18.5205, lng: 73.8568 });
    expect(checkIn.status).toBe(200);
    expect(checkIn.body.status).toBe('IN_PROGRESS');

    const checkOut = await http
      .post(`/api/v1/visits/${visitId}/check-out`)
      .set('Cookie', agentC)
      .send({ lat: 18.521, lng: 73.857 });
    expect(checkOut.status).toBe(200);

    const completedVisit = await http
      .post(`/api/v1/visits/${visitId}/complete`)
      .set('Cookie', agentC)
      .send({ outcome: 'SUITABLE' });
    expect(completedVisit.status).toBe(200);
    expect(completedVisit.body.status).toBe('COMPLETED');

    // 6. a quotation is prepared FROM that lead and FROM that visit — a real
    //    typed cross-module reference (quotations.visitId), not an invented one
    const quotation = await http
      .post('/api/v1/quotations')
      .set('Cookie', cookie)
      .send({
        leadId,
        visitId,
        validityDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        lines: draftLines(),
      });
    expect(quotation.status).toBe(200);
    expect(quotation.body.leadId).toBe(leadId);
    expect(quotation.body.visitId).toBe(visitId);
    const quotationId = quotation.body.id as string;

    // 7. the real send -> accept -> book lifecycle activates a Phase 5 project
    const sent = await http.post(`/api/v1/quotations/${quotationId}/send`).set('Cookie', cookie);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('SENT');

    const accepted = await http
      .post(`/api/v1/quotations/${quotationId}/accept`)
      .set('Cookie', cookie)
      .send({});
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('ACCEPTED');

    const booked = await http
      .post(`/api/v1/quotations/${quotationId}/book`)
      .set('Cookie', cookie)
      .send({});
    expect(booked.status).toBe(200);
    expect(booked.body.quotation.status).toBe('BOOKED');
    const projectId = booked.body.projectId as string;
    expect(projectId).toBeTruthy();

    // 8. the activated project really does link back to the same lead, and the
    //    lead's own CRM status reflects the conversion
    const project = await http.get(`/api/v1/projects/${projectId}`).set('Cookie', cookie);
    expect(project.status).toBe(200);
    expect(project.body.status).toBe('APPROVED');
    expect(project.body.leadId).toBe(leadId);

    const leadAfterBooking = await http.get(`/api/v1/crm/leads/${leadId}`).set('Cookie', cookie);
    expect(leadAfterBooking.body.status).toBe('CONVERTED');

    // 9. EPC/Execution continues from the SAME project the quotation booked —
    //    this is the one hand-off no existing suite exercises end to end
    const started = await http
      .post(`/api/v1/projects/${projectId}/execution/start`)
      .set('Cookie', cookie)
      .send({});
    expect(started.status).toBe(200);
    expect(started.body.executionStarted).toBe(true);

    const assignInstall = await http
      .post(`/api/v1/projects/${projectId}/installations/assign`)
      .set('Cookie', cookie)
      .send({ membershipId: fx.plainMember.membershipId });
    expect(assignInstall.status).toBe(200);
    expect(assignInstall.body.installation.status).toBe('ASSIGNED');

    const startInstall = await http
      .post(`/api/v1/projects/${projectId}/installations/start`)
      .set('Cookie', agentC)
      .send({});
    expect(startInstall.status).toBe(200);
    expect(startInstall.body.installation.status).toBe('IN_PROGRESS');

    await toggleAllRequired(agentC, projectId, 'installation');
    const completeInstall = await http
      .post(`/api/v1/projects/${projectId}/installations/complete`)
      .set('Cookie', agentC)
      .send({ notes: 'Golden path install done' });
    expect(completeInstall.status).toBe(200);
    expect(completeInstall.body.installation.status).toBe('COMPLETED');

    // 10. the CRM timeline for the ORIGINAL ingested lead shows the full chain
    const activities = await http
      .get(`/api/v1/crm/leads/${leadId}/activities`)
      .set('Cookie', cookie);
    const types: string[] = activities.body.map((a: { type: string }) => a.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'created',
        'assigned',
        'qualified',
        'visit_completed',
        'quotation_booked',
      ]),
    );

    // 11. established dedup/idempotency contract is preserved even after the lead
    //     has progressed through the whole chain — resubmitting the identical
    //     payload must not fork a second chain or mutate the converted lead
    const resubmit = await webhook(key, secret, {
      name: 'Golden Path Lead',
      phone: leadPhone,
      email: 'golden.path@example.test',
      city: 'Pune',
    });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.status).toBe('DUPLICATE_RAW');
    expect(resubmit.body.leadId).toBe(leadId);
    const leadAfterResubmit = await http.get(`/api/v1/crm/leads/${leadId}`).set('Cookie', cookie);
    expect(leadAfterResubmit.body.status).toBe('CONVERTED'); // unchanged, not reverted
  });

  // ------------------------------------------------------------------
  // 2. concurrent duplicate submissions before any chaining happens
  // ------------------------------------------------------------------

  it('concurrent identical lead submissions produce exactly one lead to chain the rest of the journey from', async () => {
    const cookie = await adminCookie();
    const { secret, key } = await createSource(cookie, 'concurrent');
    const leadPhone = phone();
    const payload = { name: 'Concurrent Lead', phone: leadPhone };

    const [a, b] = await Promise.all([
      webhook(key, secret, payload),
      webhook(key, secret, payload),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const leadIds = new Set([a.body.leadId, b.body.leadId].filter(Boolean));
    expect(leadIds.size).toBe(1);

    const list = await http.get('/api/v1/crm/leads').query({ q: leadPhone }).set('Cookie', cookie);
    expect(list.body.items).toHaveLength(1);
  });

  // ------------------------------------------------------------------
  // 3. invalid / out-of-order cross-module transitions are rejected
  // ------------------------------------------------------------------

  it('rejects booking an unaccepted quotation and starting execution on an unapproved project', async () => {
    const cookie = await adminCookie();
    const leadRes = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({ name: 'Invalid Transition Lead', phone: phone() });
    const leadId = leadRes.body.id as string;

    // a DRAFT quotation (never sent/accepted) cannot be booked
    const quotation = await http
      .post('/api/v1/quotations')
      .set('Cookie', cookie)
      .send({ leadId, lines: draftLines() });
    const prematureBook = await http
      .post(`/api/v1/quotations/${quotation.body.id}/book`)
      .set('Cookie', cookie)
      .send({});
    expect(prematureBook.status).toBe(409);
    expect(prematureBook.body.error.code).toBe('QUOTATION_NOT_ACCEPTED');

    // a DRAFT project (created directly, never approved/booked) cannot start execution
    const project = await http.post('/api/v1/projects').set('Cookie', cookie).send({ leadId });
    expect(project.body.status).toBe('DRAFT');
    const prematureStart = await http
      .post(`/api/v1/projects/${project.body.id}/execution/start`)
      .set('Cookie', cookie)
      .send({});
    expect(prematureStart.status).toBe(409);
    expect(prematureStart.body.error.code).toBe('PROJECT_INVALID_TRANSITION');
  });

  // ------------------------------------------------------------------
  // 4. tenant isolation holds across the whole chain
  // ------------------------------------------------------------------

  it('tenant B cannot read the lead, visit, quotation or project created by this chain for tenant A', async () => {
    const cookie = await adminCookie();
    const agentC = await fieldAgentCookie(cookie);
    const leadRes = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({ name: 'Isolation Lead', phone: phone() });
    const leadId = leadRes.body.id as string;

    const visit = await http
      .post('/api/v1/visits')
      .set('Cookie', cookie)
      .send({
        leadId,
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        assignedMembershipId: fx.plainMember.membershipId,
      });
    const visitId = visit.body.id as string;
    await http
      .post(`/api/v1/visits/${visitId}/check-in`)
      .set('Cookie', agentC)
      .send({ lat: 1, lng: 1 });
    await http
      .post(`/api/v1/visits/${visitId}/check-out`)
      .set('Cookie', agentC)
      .send({ lat: 1, lng: 1 });
    await http.post(`/api/v1/visits/${visitId}/complete`).set('Cookie', agentC).send({});

    const quotation = await http
      .post('/api/v1/quotations')
      .set('Cookie', cookie)
      .send({ leadId, visitId, lines: draftLines() });
    const quotationId = quotation.body.id as string;
    await http.post(`/api/v1/quotations/${quotationId}/send`).set('Cookie', cookie);
    await http.post(`/api/v1/quotations/${quotationId}/accept`).set('Cookie', cookie).send({});
    const booked = await http
      .post(`/api/v1/quotations/${quotationId}/book`)
      .set('Cookie', cookie)
      .send({});
    const projectId = booked.body.projectId as string;

    const bCookie = await adminBCookie();
    expect((await http.get(`/api/v1/crm/leads/${leadId}`).set('Cookie', bCookie)).status).toBe(404);
    expect((await http.get(`/api/v1/visits/${visitId}`).set('Cookie', bCookie)).status).toBe(404);
    expect(
      (await http.get(`/api/v1/quotations/${quotationId}`).set('Cookie', bCookie)).status,
    ).toBe(404);
    expect((await http.get(`/api/v1/projects/${projectId}`).set('Cookie', bCookie)).status).toBe(
      404,
    );
    expect(
      (await http.get(`/api/v1/projects/${projectId}/execution`).set('Cookie', bCookie)).status,
    ).toBe(404);
  });

  // ------------------------------------------------------------------
  // 5. module permissions are enforced at every chained boundary, not just the UI
  // ------------------------------------------------------------------

  it('a member without the relevant module permissions cannot perform any step of the chain', async () => {
    const cookie = await adminCookie();
    const leadRes = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({ name: 'Permission Lead', phone: phone() });
    const leadId = leadRes.body.id as string;
    const visit = await http
      .post('/api/v1/visits')
      .set('Cookie', cookie)
      .send({ leadId, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });
    const visitId = visit.body.id as string;
    const quotation = await http
      .post('/api/v1/quotations')
      .set('Cookie', cookie)
      .send({ leadId, lines: draftLines() });
    const quotationId = quotation.body.id as string;
    await http.post(`/api/v1/quotations/${quotationId}/send`).set('Cookie', cookie);
    await http.post(`/api/v1/quotations/${quotationId}/accept`).set('Cookie', cookie).send({});

    // `fx.limited` holds only memberships.read — no CRM/Field/Commercial/Execution grant
    const unauthorized = await limitedCookie();
    expect(
      (
        await http
          .post(`/api/v1/crm/leads/${leadId}/assign`)
          .set('Cookie', unauthorized)
          .send({ membershipId: fx.limited.membershipId })
      ).status,
    ).toBe(403);
    expect(
      (
        await http
          .post(`/api/v1/visits/${visitId}/assign`)
          .set('Cookie', unauthorized)
          .send({ membershipId: fx.limited.membershipId })
      ).status,
    ).toBe(403);
    expect(
      (await http.post('/api/v1/quotations').set('Cookie', unauthorized).send({ leadId })).status,
    ).toBe(403);
    expect(
      (
        await http
          .post(`/api/v1/quotations/${quotationId}/book`)
          .set('Cookie', unauthorized)
          .send({})
      ).status,
    ).toBe(403);

    // booking still proceeds for an authorized caller, proving the 403s above were a
    // permission gate and not an accidental state/validation failure
    const booked = await http
      .post(`/api/v1/quotations/${quotationId}/book`)
      .set('Cookie', cookie)
      .send({});
    expect(booked.status).toBe(200);
    expect(
      (
        await http
          .post(`/api/v1/projects/${booked.body.projectId}/execution/start`)
          .set('Cookie', unauthorized)
          .send({})
      ).status,
    ).toBe(403);
  });
});
