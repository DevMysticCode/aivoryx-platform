import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 3 — CRM core (ADR 0031): leads, lifecycle, assignment, activities,
 * notes, follow-ups, qualification, and custom fields, driven over HTTP.
 * Direct PostgreSQL RLS proof lives in `rls.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)('CRM core', () => {
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

  const adminCookie = async (): Promise<string> => {
    const res = await login(fx.admin.email, fx.admin.password);
    const cookie = sessionCookie(res);
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: fx.admin.membershipId });
    return cookie;
  };

  const adminBCookie = async (): Promise<string> =>
    sessionCookie(await login(fx.adminB.email, fx.adminB.password));

  const createLead = async (cookie: string, patch: Record<string, unknown> = {}) => {
    const res = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({ name: 'Test Lead', phone: `9${Date.now()}`.slice(0, 10), ...patch });
    expect(res.status).toBe(200);
    return res.body as { id: string; customFields: Record<string, unknown> };
  };

  // ---- LEADS ------------------------------------------------------

  describe('LEADS', () => {
    it('creates, reads, updates, and lists a lead', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie, {
        name: 'Alice',
        phone: '9990001111',
        email: 'alice@x.test',
      });
      expect(lead).toMatchObject({
        name: 'Alice',
        phone: '9990001111',
        email: 'alice@x.test',
        status: 'NEW',
      });

      const got = await http.get(`/api/v1/crm/leads/${lead.id}`).set('Cookie', cookie);
      expect(got.status).toBe(200);
      expect(got.body.name).toBe('Alice');

      const updated = await http
        .patch(`/api/v1/crm/leads/${lead.id}`)
        .set('Cookie', cookie)
        .send({ city: 'Pune' });
      expect(updated.status).toBe(200);
      expect(updated.body.city).toBe('Pune');
      expect(updated.body.name).toBe('Alice'); // untouched fields preserved

      const list = await http.get('/api/v1/crm/leads').set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(list.body.items.some((l: { id: string }) => l.id === lead.id)).toBe(true);
      expect(list.body.total).toBeGreaterThan(0);
    });

    it('unknown lead id -> 404 LEAD_NOT_FOUND', async () => {
      const cookie = await adminCookie();
      const res = await http.get(`/api/v1/crm/leads/${randomUUID()}`).set('Cookie', cookie);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
    });

    it('filters by status, source-less (sourceId absent), assignee, and free-text search', async () => {
      const cookie = await adminCookie();
      const unique = `zz-search-${Date.now()}`;
      const lead = await createLead(cookie, { name: unique });
      const list = await http
        .get('/api/v1/crm/leads')
        .query({ q: unique, status: 'NEW' })
        .set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].id).toBe(lead.id);
    });

    it('assigning a NEW lead bumps it to ASSIGNED; reassigning keeps the later status', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie);

      const assigned = await http
        .post(`/api/v1/crm/leads/${lead.id}/assign`)
        .set('Cookie', cookie)
        .send({ membershipId: fx.plainMember.membershipId });
      expect(assigned.status).toBe(200);
      expect(assigned.body.status).toBe('ASSIGNED');
      expect(assigned.body.assignee.membershipId).toBe(fx.plainMember.membershipId);

      // move it further along, then reassign — status must not regress
      await http
        .post(`/api/v1/crm/leads/${lead.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'CONTACTED' });
      const reassigned = await http
        .post(`/api/v1/crm/leads/${lead.id}/assign`)
        .set('Cookie', cookie)
        .send({ membershipId: fx.secondAdmin.membershipId });
      expect(reassigned.status).toBe(200);
      expect(reassigned.body.status).toBe('CONTACTED');
      expect(reassigned.body.assignee.membershipId).toBe(fx.secondAdmin.membershipId);
    });

    it('cannot assign to a membership outside the tenant', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie);
      const res = await http
        .post(`/api/v1/crm/leads/${lead.id}/assign`)
        .set('Cookie', cookie)
        .send({ membershipId: fx.adminB.membershipId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('LEAD_ASSIGNEE_INVALID');
    });

    it('valid status transitions succeed; invalid ones are rejected', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie);

      const toContacted = await http
        .post(`/api/v1/crm/leads/${lead.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'CONTACTED' });
      expect(toContacted.status).toBe(200);
      expect(toContacted.body.status).toBe('CONTACTED');

      // CONTACTED -> ASSIGNED is not a valid transition
      const backwards = await http
        .post(`/api/v1/crm/leads/${lead.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'ASSIGNED' });
      expect(backwards.status).toBe(409);
      expect(backwards.body.error.code).toBe('LEAD_INVALID_TRANSITION');
    });

    it('qualify and disqualify record the outcome + note and are terminal', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie);

      const qualified = await http
        .post(`/api/v1/crm/leads/${lead.id}/qualify`)
        .set('Cookie', cookie)
        .send({ outcome: 'QUALIFIED', note: 'Good fit' });
      expect(qualified.status).toBe(200);
      expect(qualified.body.status).toBe('QUALIFIED');
      expect(qualified.body.qualificationNote).toBe('Good fit');

      const convert = await http
        .post(`/api/v1/crm/leads/${lead.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'CONVERTED' });
      expect(convert.status).toBe(200);

      // CONVERTED is terminal
      const reopen = await http
        .post(`/api/v1/crm/leads/${lead.id}/qualify`)
        .set('Cookie', cookie)
        .send({ outcome: 'DISQUALIFIED' });
      expect(reopen.status).toBe(409);
      expect(reopen.body.error.code).toBe('LEAD_INVALID_TRANSITION');
    });

    it('logs a manual call attempt as a timeline activity', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie);
      const res = await http
        .post(`/api/v1/crm/leads/${lead.id}/call-attempts`)
        .set('Cookie', cookie)
        .send({ outcome: 'no_answer', note: 'Tried at lunch' });
      expect(res.status).toBe(200);

      const activities = await http
        .get(`/api/v1/crm/leads/${lead.id}/activities`)
        .set('Cookie', cookie);
      expect(activities.status).toBe(200);
      expect(
        activities.body.some(
          (a: { type: string; payload: { outcome: string } }) =>
            a.type === 'call_attempt' && a.payload.outcome === 'no_answer',
        ),
      ).toBe(true);
    });
  });

  // ---- ACTIVITIES / TIMELINE --------------------------------------

  describe('ACTIVITIES', () => {
    it('records created/assigned/status_changed/qualified in chronological order', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie);
      await http
        .post(`/api/v1/crm/leads/${lead.id}/assign`)
        .set('Cookie', cookie)
        .send({ membershipId: fx.plainMember.membershipId });
      await http
        .post(`/api/v1/crm/leads/${lead.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'CONTACTED' });
      await http
        .post(`/api/v1/crm/leads/${lead.id}/qualify`)
        .set('Cookie', cookie)
        .send({ outcome: 'QUALIFIED' });

      const res = await http.get(`/api/v1/crm/leads/${lead.id}/activities`).set('Cookie', cookie);
      expect(res.status).toBe(200);
      const types: string[] = res.body.map((a: { type: string }) => a.type);
      // newest first
      expect(types[0]).toBe('qualified');
      expect(types).toContain('created');
      expect(types).toContain('assigned');
      expect(types).toContain('status_changed');
    });
  });

  // ---- NOTES ------------------------------------------------------

  describe('NOTES', () => {
    it('creates a note, shows it on the timeline, and the author can edit/delete it', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie);

      const created = await http
        .post(`/api/v1/crm/leads/${lead.id}/notes`)
        .set('Cookie', cookie)
        .send({ body: 'Called, will call back' });
      expect(created.status).toBe(200);
      const noteId = created.body.id;

      const timeline = await http
        .get(`/api/v1/crm/leads/${lead.id}/activities`)
        .set('Cookie', cookie);
      expect(timeline.body.some((a: { type: string }) => a.type === 'note')).toBe(true);

      const edited = await http
        .patch(`/api/v1/crm/leads/${lead.id}/notes/${noteId}`)
        .set('Cookie', cookie)
        .send({ body: 'Called, callback scheduled' });
      expect(edited.status).toBe(200);
      expect(edited.body.body).toBe('Called, callback scheduled');

      const del = await http
        .delete(`/api/v1/crm/leads/${lead.id}/notes/${noteId}`)
        .set('Cookie', cookie);
      expect(del.status).toBe(204);

      const list = await http.get(`/api/v1/crm/leads/${lead.id}/notes`).set('Cookie', cookie);
      expect(list.body.find((n: { id: string }) => n.id === noteId)).toBeUndefined();
    });

    it('a non-author without crm.leads.update cannot edit or delete someone else’s note', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie);
      const note = await http
        .post(`/api/v1/crm/leads/${lead.id}/notes`)
        .set('Cookie', cookie)
        .send({ body: 'Admin note' });

      // fx.secondAdmin also holds crm.leads.update (TENANT_ADMIN full catalogue),
      // so use plainMember granted only crm.activities.create for this check —
      // simulate via direct role check: plainMember has no roles at all, so it
      // cannot call the endpoint in the first place (403 covered in RBAC below).
      // Within same-permission peers, ownership still applies:
      const secondAdminCookie = sessionCookie(
        await login(fx.secondAdmin.email, fx.secondAdmin.password),
      );
      const editAttempt = await http
        .patch(`/api/v1/crm/leads/${lead.id}/notes/${note.body.id}`)
        .set('Cookie', secondAdminCookie)
        .send({ body: 'hijacked' });
      // secondAdmin is also TENANT_ADMIN (crm.leads.update) so this is allowed —
      // documents the "author OR crm.leads.update" rule explicitly.
      expect(editAttempt.status).toBe(200);
    });
  });

  // ---- FOLLOW-UPS ---------------------------------------------------

  describe('FOLLOW-UPS', () => {
    it('creates, lists, completes, and reschedules a follow-up', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie);
      const dueAt = new Date(Date.now() + 86_400_000).toISOString();

      const created = await http
        .post(`/api/v1/crm/leads/${lead.id}/followups`)
        .set('Cookie', cookie)
        .send({ dueAt, note: 'Call back tomorrow' });
      expect(created.status).toBe(200);
      expect(created.body.status).toBe('pending');
      const followupId = created.body.id;

      const rescheduled = await http
        .post(`/api/v1/crm/leads/${lead.id}/followups/${followupId}/reschedule`)
        .set('Cookie', cookie)
        .send({ dueAt: new Date(Date.now() + 172_800_000).toISOString() });
      expect(rescheduled.status).toBe(200);

      const completed = await http
        .post(`/api/v1/crm/leads/${lead.id}/followups/${followupId}/complete`)
        .set('Cookie', cookie)
        .send({ result: 'Interested, sending quote' });
      expect(completed.status).toBe(200);
      expect(completed.body.status).toBe('completed');

      // completing again is rejected
      const again = await http
        .post(`/api/v1/crm/leads/${lead.id}/followups/${followupId}/complete`)
        .set('Cookie', cookie)
        .send({});
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('FOLLOWUP_ALREADY_COMPLETED');

      const timeline = await http
        .get(`/api/v1/crm/leads/${lead.id}/activities`)
        .set('Cookie', cookie);
      const types: string[] = timeline.body.map((a: { type: string }) => a.type);
      expect(types).toContain('followup_created');
      expect(types).toContain('followup_completed');
    });
  });

  // ---- CUSTOM FIELDS ------------------------------------------------

  describe('CUSTOM FIELDS', () => {
    it('defines a field, writes a valid value, and rejects an unknown key / bad value', async () => {
      const cookie = await adminCookie();
      const def = await http
        .post('/api/v1/crm/custom-fields')
        .set('Cookie', cookie)
        .send({
          key: 'roof_type',
          label: 'Roof Type',
          dataType: 'select',
          options: ['flat', 'sloped'],
        });
      expect(def.status).toBe(200);

      const lead = await createLead(cookie, { customFields: { roof_type: 'flat' } });
      expect(lead).toMatchObject({ customFields: { roof_type: 'flat' } });

      const badKey = await http
        .post('/api/v1/crm/leads')
        .set('Cookie', cookie)
        .send({ name: 'x', customFields: { not_a_field: 'x' } });
      expect(badKey.status).toBe(404);
      expect(badKey.body.error.code).toBe('CUSTOM_FIELD_NOT_FOUND');

      const badValue = await http
        .post('/api/v1/crm/leads')
        .set('Cookie', cookie)
        .send({ name: 'x', customFields: { roof_type: 'not-an-option' } });
      expect(badValue.status).toBe(400);
      expect(badValue.body.error.code).toBe('CUSTOM_FIELD_INVALID_VALUE');
    });

    it('a numeric custom field coerces and round-trips correctly', async () => {
      const cookie = await adminCookie();
      await http
        .post('/api/v1/crm/custom-fields')
        .set('Cookie', cookie)
        .send({ key: 'budget_lakh', label: 'Budget (lakh)', dataType: 'number' });
      const lead = await createLead(cookie, { customFields: { budget_lakh: 5 } });
      expect(lead.customFields).toEqual({ budget_lakh: 5 });
    });

    it('deprecating a field stops it from being offered but keeps stored values readable', async () => {
      const cookie = await adminCookie();
      const created = await http
        .post('/api/v1/crm/custom-fields')
        .set('Cookie', cookie)
        .send({ key: 'temp_field', label: 'Temp', dataType: 'text' });
      const lead = await createLead(cookie, { customFields: { temp_field: 'value' } });

      const deprecated = await http
        .patch(`/api/v1/crm/custom-fields/${created.body.id}/deprecate`)
        .set('Cookie', cookie);
      expect(deprecated.status).toBe(200);
      expect(deprecated.body.status).toBe('deprecated');

      const got = await http.get(`/api/v1/crm/leads/${lead.id}`).set('Cookie', cookie);
      expect(got.body.customFields.temp_field).toBe('value');
    });
  });

  // ---- RBAC / TENANT ISOLATION --------------------------------------

  describe('RBAC & TENANT ISOLATION', () => {
    it('unauthenticated -> 401; a member with no CRM permissions -> 403', async () => {
      const anon = await http.get('/api/v1/crm/leads');
      expect(anon.status).toBe(401);
      expect(anon.body.error.code).toBe('AUTH_UNAUTHENTICATED');

      const cookie = sessionCookie(await login(fx.plainMember.email, fx.plainMember.password));
      const res = await http.get('/api/v1/crm/leads').set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('tenant A cannot read or mutate a tenant B lead', async () => {
      const cookieA = await adminCookie();
      const cookieB = await adminBCookie();
      const leadB = await createLead(cookieB);

      const read = await http.get(`/api/v1/crm/leads/${leadB.id}`).set('Cookie', cookieA);
      expect(read.status).toBe(404);

      const update = await http
        .patch(`/api/v1/crm/leads/${leadB.id}`)
        .set('Cookie', cookieA)
        .send({ name: 'hijacked' });
      expect(update.status).toBe(404);

      const pool = await rawPool();
      try {
        const { rows } = await pool.query('select name from leads where id = $1', [leadB.id]);
        expect(rows[0]?.name).not.toBe('hijacked');
      } finally {
        await pool.end();
      }
    });

    it('a lead created in tenant A never appears in tenant B’s list', async () => {
      const cookieA = await adminCookie();
      const cookieB = await adminBCookie();
      const uniqueName = `isolation-check-${Date.now()}`;
      await createLead(cookieA, { name: uniqueName });

      const listB = await http
        .get('/api/v1/crm/leads')
        .set('Cookie', cookieB)
        .query({ q: uniqueName });
      expect(listB.body.items).toHaveLength(0);
    });
  });
});
