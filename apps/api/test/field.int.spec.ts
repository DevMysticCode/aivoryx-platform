import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 4 — field operations (ADR 0033): visit lifecycle, GPS check-in/out,
 * survey, notes, attachments, field-generated leads, and access boundaries,
 * driven over HTTP. Direct PostgreSQL RLS proof lives in `rls.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)('Field operations', () => {
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

  const adminBCookie = async (): Promise<string> => {
    const res = await login(fx.adminB.email, fx.adminB.password);
    const cookie = sessionCookie(res);
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: fx.adminB.membershipId });
    return cookie;
  };

  /** `fx.plainMember` designated as a field agent, logged in and switched into tenant A. */
  const fieldAgentCookie = async (adminC: string): Promise<string> => {
    await http
      .post('/api/v1/field-agents')
      .set('Cookie', adminC)
      .send({ membershipId: fx.plainMember.membershipId });
    const res = await login(fx.plainMember.email, fx.plainMember.password);
    const cookie = sessionCookie(res);
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: fx.plainMember.membershipId });
    return cookie;
  };

  const createLead = async (cookie: string) => {
    const res = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({
        name: 'Field Lead',
        phone: `9${Math.floor(Math.random() * 1_000_000_000)}`.slice(0, 10),
      });
    expect(res.status).toBe(200);
    return res.body as { id: string };
  };

  const scheduleVisit = async (
    cookie: string,
    leadId: string,
    patch: Record<string, unknown> = {},
  ) => {
    const res = await http
      .post('/api/v1/visits')
      .set('Cookie', cookie)
      .send({ leadId, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), ...patch });
    expect(res.status).toBe(200);
    return res.body as { id: string; status: string };
  };

  // ---- field agents ----------------------------------------------------

  describe('FIELD AGENTS', () => {
    it('designates and deactivates a field agent', async () => {
      const cookie = await adminCookie();
      const designated = await http
        .post('/api/v1/field-agents')
        .set('Cookie', cookie)
        .send({ membershipId: fx.limited.membershipId });
      expect(designated.status).toBe(200);
      expect(designated.body).toMatchObject({
        membershipId: fx.limited.membershipId,
        status: 'active',
      });

      const list = await http.get('/api/v1/field-agents').set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(
        list.body.some((a: { membershipId: string }) => a.membershipId === fx.limited.membershipId),
      ).toBe(true);

      const deactivated = await http
        .post(`/api/v1/field-agents/${fx.limited.membershipId}/deactivate`)
        .set('Cookie', cookie);
      expect(deactivated.status).toBe(200);
      expect(deactivated.body.status).toBe('inactive');
    });

    it('a non-admin cannot designate field agents', async () => {
      const adminC = await adminCookie();
      const agentC = await fieldAgentCookie(adminC);
      const res = await http
        .post('/api/v1/field-agents')
        .set('Cookie', agentC)
        .send({ membershipId: fx.secondAdmin.membershipId });
      expect(res.status).toBe(403);
    });
  });

  // ---- visit lifecycle ---------------------------------------------------

  describe('VISIT LIFECYCLE', () => {
    it('schedules, assigns, reschedules, and cancels a visit', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);
      const lead = await createLead(cookie);

      const visit = await scheduleVisit(cookie, lead.id);
      expect(visit.status).toBe('SCHEDULED');

      const assigned = await http
        .post(`/api/v1/visits/${visit.id}/assign`)
        .set('Cookie', cookie)
        .send({ membershipId: fx.plainMember.membershipId });
      expect(assigned.status).toBe(200);
      expect(assigned.body.status).toBe('ASSIGNED');
      expect(assigned.body.assignee.membershipId).toBe(fx.plainMember.membershipId);

      const newTime = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const rescheduled = await http
        .post(`/api/v1/visits/${visit.id}/reschedule`)
        .set('Cookie', cookie)
        .send({ scheduledAt: newTime });
      expect(rescheduled.status).toBe(200);
      expect(rescheduled.body.scheduledAt).toBe(newTime);

      const cancelled = await http
        .post(`/api/v1/visits/${visit.id}/cancel`)
        .set('Cookie', cookie)
        .send({ reason: 'customer unavailable' });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');

      // terminal — cannot be checked into
      const checkIn = await http
        .post(`/api/v1/visits/${visit.id}/check-in`)
        .set('Cookie', agentC)
        .send({ lat: 12.9, lng: 77.6 });
      expect(checkIn.status).toBe(409);
      expect(checkIn.body.error.code).toBe('VISIT_INVALID_TRANSITION');
    });

    it('a field agent cannot check in to a visit assigned to someone else', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);
      await http
        .post('/api/v1/field-agents')
        .set('Cookie', cookie)
        .send({ membershipId: fx.secondAdmin.membershipId });
      const lead = await createLead(cookie);
      const visit = await scheduleVisit(cookie, lead.id, {
        assignedMembershipId: fx.secondAdmin.membershipId,
      });
      expect(visit.status).toBe('ASSIGNED');

      const res = await http
        .post(`/api/v1/visits/${visit.id}/check-in`)
        .set('Cookie', agentC)
        .send({ lat: 12.9, lng: 77.6 });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('VISIT_NOT_ASSIGNED_TO_YOU');
    });

    it('cannot skip check-in and go straight to complete', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);
      const lead = await createLead(cookie);
      const visit = await scheduleVisit(cookie, lead.id, {
        assignedMembershipId: fx.plainMember.membershipId,
      });

      const res = await http.post(`/api/v1/visits/${visit.id}/complete`).set('Cookie', agentC);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VISIT_INVALID_TRANSITION');
    });
  });

  // ---- GPS check-in/out ---------------------------------------------------

  describe('GPS CHECK-IN / CHECK-OUT', () => {
    async function assignedVisit(cookie: string, agentC: string) {
      const lead = await createLead(cookie);
      const visit = await scheduleVisit(cookie, lead.id, {
        assignedMembershipId: fx.plainMember.membershipId,
        siteLat: 12.9716,
        siteLng: 77.5946,
      });
      return { lead, visit, agentC };
    }

    it('checks in, then out, and computes a straight-line GPS distance', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);
      const { visit } = await assignedVisit(cookie, agentC);

      const checkIn = await http
        .post(`/api/v1/visits/${visit.id}/check-in`)
        .set('Cookie', agentC)
        .send({ lat: 12.972, lng: 77.595, accuracyM: 8 });
      expect(checkIn.status).toBe(200);
      expect(checkIn.body.status).toBe('IN_PROGRESS');
      expect(checkIn.body.checkInAt).toBeTruthy();

      const checkOut = await http
        .post(`/api/v1/visits/${visit.id}/check-out`)
        .set('Cookie', agentC)
        .send({ lat: 12.973, lng: 77.596, travelKm: 4.2, travelNotes: 'by bike' });
      expect(checkOut.status).toBe(200);
      expect(checkOut.body.checkOutAt).toBeTruthy();
      expect(checkOut.body.gpsDistanceMeters).not.toBeNull();
      expect(checkOut.body.gpsDistanceMeters).toBeGreaterThan(0);
      expect(checkOut.body.travelKm).toBe(4.2);
    });

    it('repeated check-in is idempotent, not an error', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);
      const { visit } = await assignedVisit(cookie, agentC);

      const first = await http
        .post(`/api/v1/visits/${visit.id}/check-in`)
        .set('Cookie', agentC)
        .send({ lat: 12.972, lng: 77.595 });
      expect(first.status).toBe(200);

      const second = await http
        .post(`/api/v1/visits/${visit.id}/check-in`)
        .set('Cookie', agentC)
        .send({ lat: 13.5, lng: 78.1 }); // a different point — must NOT overwrite
      expect(second.status).toBe(200);
      expect(second.body.checkInLat).toBe(first.body.checkInLat);
    });

    it('concurrent duplicate check-ins never produce two check-in records', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);
      const { visit } = await assignedVisit(cookie, agentC);

      const [a, b] = await Promise.all([
        http
          .post(`/api/v1/visits/${visit.id}/check-in`)
          .set('Cookie', agentC)
          .send({ lat: 1, lng: 1 }),
        http
          .post(`/api/v1/visits/${visit.id}/check-in`)
          .set('Cookie', agentC)
          .send({ lat: 2, lng: 2 }),
      ]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect(a.body.checkInLat).toBe(b.body.checkInLat);

      const timeline = await http
        .get(`/api/v1/visits/${visit.id}/activities`)
        .set('Cookie', agentC);
      const checkIns = (timeline.body as { type: string }[]).filter((e) => e.type === 'checked_in');
      expect(checkIns).toHaveLength(1);
    });

    it('cannot check out before checking in', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);
      const { visit } = await assignedVisit(cookie, agentC);

      const res = await http
        .post(`/api/v1/visits/${visit.id}/check-out`)
        .set('Cookie', agentC)
        .send({ lat: 1, lng: 1 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('VISIT_NOT_CHECKED_IN');
    });
  });

  // ---- survey -------------------------------------------------------------

  describe('SITE SURVEY', () => {
    it('requires the required survey field before completion, and blocks an invalid value', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);

      const fieldKey = `roof_type_${randomUUID().slice(0, 8)}`;
      const def = await http
        .post('/api/v1/crm/custom-fields')
        .set('Cookie', cookie)
        .send({
          key: fieldKey,
          label: 'Roof type',
          dataType: 'select',
          isRequired: true,
          options: ['flat', 'sloped'],
          entity: 'visit',
        });
      expect(def.status).toBe(200);
      expect(def.body.entity).toBe('visit');

      const lead = await createLead(cookie);
      const visit = await scheduleVisit(cookie, lead.id, {
        assignedMembershipId: fx.plainMember.membershipId,
      });
      await http
        .post(`/api/v1/visits/${visit.id}/check-in`)
        .set('Cookie', agentC)
        .send({ lat: 1, lng: 1 });

      const invalid = await http
        .post(`/api/v1/visits/${visit.id}/survey`)
        .set('Cookie', agentC)
        .send({ values: { [fieldKey]: 'not-an-option' } });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('CUSTOM_FIELD_INVALID_VALUE');

      await http
        .post(`/api/v1/visits/${visit.id}/check-out`)
        .set('Cookie', agentC)
        .send({ lat: 1, lng: 1 });

      const incomplete = await http
        .post(`/api/v1/visits/${visit.id}/complete`)
        .set('Cookie', agentC);
      expect(incomplete.status).toBe(409);
      expect(incomplete.body.error.code).toBe('VISIT_INCOMPLETE');
      expect(incomplete.body.error.details.missing).toContain('survey');

      const valid = await http
        .post(`/api/v1/visits/${visit.id}/survey`)
        .set('Cookie', agentC)
        .send({ values: { [fieldKey]: 'flat' } });
      expect(valid.status).toBe(200);
      expect(valid.body.surveyCompletedAt).toBeTruthy();

      const complete = await http.post(`/api/v1/visits/${visit.id}/complete`).set('Cookie', agentC);
      expect(complete.status).toBe(200);
      expect(complete.body.status).toBe('COMPLETED');
    });
  });

  // ---- notes ---------------------------------------------------------

  describe('VISIT NOTES', () => {
    it('adds a note and it appears in the timeline', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);
      const lead = await createLead(cookie);
      const visit = await scheduleVisit(cookie, lead.id, {
        assignedMembershipId: fx.plainMember.membershipId,
      });

      const note = await http
        .post(`/api/v1/visits/${visit.id}/notes`)
        .set('Cookie', agentC)
        .send({ body: 'Customer prefers evening visits.' });
      expect(note.status).toBe(200);

      const timeline = await http
        .get(`/api/v1/visits/${visit.id}/activities`)
        .set('Cookie', agentC);
      expect((timeline.body as { type: string }[]).some((e) => e.type === 'note')).toBe(true);
    });
  });

  // ---- field-generated leads ---------------------------------------------

  describe('FIELD-GENERATED LEADS', () => {
    it('a field agent can create a lead marked with field_agent origin', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);

      const res = await http
        .post('/api/v1/crm/leads')
        .set('Cookie', agentC)
        .send({
          name: 'Doorstep Lead',
          phone: `9${Math.floor(Math.random() * 1_000_000_000)}`.slice(0, 10),
          origin: 'field_agent',
        });
      expect(res.status).toBe(200);
      expect(res.body.origin).toBe('field_agent');
    });

    it('a field agent cannot read the general lead list (no crm.leads.read)', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);
      const res = await http.get('/api/v1/crm/leads').set('Cookie', agentC);
      expect(res.status).toBe(403);
    });
  });

  // ---- access boundaries --------------------------------------------------

  describe('ACCESS BOUNDARIES', () => {
    it('a field agent only sees their own visits in the list, never another agent’s', async () => {
      const cookie = await adminCookie();
      const agentC = await fieldAgentCookie(cookie);
      await http
        .post('/api/v1/field-agents')
        .set('Cookie', cookie)
        .send({ membershipId: fx.secondAdmin.membershipId });
      const leadOwn = await createLead(cookie);
      const leadOther = await createLead(cookie);
      const own = await scheduleVisit(cookie, leadOwn.id, {
        assignedMembershipId: fx.plainMember.membershipId,
      });
      const other = await scheduleVisit(cookie, leadOther.id, {
        assignedMembershipId: fx.secondAdmin.membershipId,
      });

      const list = await http.get('/api/v1/visits').set('Cookie', agentC);
      expect(list.status).toBe(200);
      const ids = (list.body.items as { id: string }[]).map((v) => v.id);
      expect(ids).toContain(own.id);
      expect(ids).not.toContain(other.id);

      const getOther = await http.get(`/api/v1/visits/${other.id}`).set('Cookie', agentC);
      expect(getOther.status).toBe(403);
    });

    it('cross-tenant: tenant B cannot read or act on tenant A visits', async () => {
      const cookieA = await adminCookie();
      const cookieB = await adminBCookie();
      const lead = await createLead(cookieA);
      const visit = await scheduleVisit(cookieA, lead.id);

      const get = await http.get(`/api/v1/visits/${visit.id}`).set('Cookie', cookieB);
      expect(get.status).toBe(404);

      const cancel = await http.post(`/api/v1/visits/${visit.id}/cancel`).set('Cookie', cookieB);
      expect(cancel.status).toBe(404);
    });

    it('scheduling a visit against a lead in another tenant is rejected', async () => {
      const cookieA = await adminCookie();
      const cookieB = await adminBCookie();
      const leadB = await createLead(cookieB);

      const res = await http
        .post('/api/v1/visits')
        .set('Cookie', cookieA)
        .send({ leadId: leadB.id, scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LEAD_NOT_FOUND');
    });

    it('assigning a visit to a deactivated field agent is rejected', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie);
      // fx.limited was deactivated in the FIELD AGENTS describe above.
      const res = await http
        .post('/api/v1/visits')
        .set('Cookie', cookie)
        .send({
          leadId: lead.id,
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          assignedMembershipId: fx.limited.membershipId,
        });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('FIELD_AGENT_NOT_FOUND');
    });

    it('assigning a visit to a member who was never a field agent is rejected', async () => {
      const cookie = await adminCookie();
      const lead = await createLead(cookie);
      const res = await http
        .post('/api/v1/visits')
        .set('Cookie', cookie)
        .send({
          leadId: lead.id,
          scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
          assignedMembershipId: fx.suspended.membershipId,
        });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('FIELD_AGENT_NOT_FOUND');
    });

    it('an unauthenticated request is rejected', async () => {
      const res = await http.get('/api/v1/visits');
      expect(res.status).toBe(401);
    });
  });
});
