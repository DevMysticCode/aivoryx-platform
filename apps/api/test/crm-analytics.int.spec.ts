import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 13D — CRM analytics (ADR 0031). Read-only aggregation over the
 * existing lead/follow-up/activity tables. Tenant-scoped via RLS; team
 * performance is gated by the caller's CRM data scope (the existing
 * `roles.kind='profile'` + `membership_roles.data_scope` model — no second
 * authorization system).
 */
describe.skipIf(!INTEGRATION_ENABLED)('CRM analytics', () => {
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
    const cookie = sessionCookie(await login(fx.admin.email, fx.admin.password));
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: fx.admin.membershipId });
    return cookie;
  };

  const createLead = async (
    cookie: string,
    patch: Record<string, unknown> = {},
  ): Promise<{ id: string; status: string }> => {
    const res = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({
        name: 'Analytics Lead',
        phone: `9${Date.now()}${Math.random()}`.slice(0, 10),
        ...patch,
      });
    expect(res.status).toBe(200);
    return res.body;
  };

  it('reports totals/funnel/sources for the tenant admin (COMPANY scope) and rejects without crm.leads.read', async () => {
    const cookie = await adminCookie();
    const a = await createLead(cookie);
    const b = await createLead(cookie);
    await http
      .post(`/api/v1/crm/leads/${a.id}/assign`)
      .set('Cookie', cookie)
      .send({ membershipId: fx.admin.membershipId });
    await http
      .post(`/api/v1/crm/leads/${a.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'ASSIGNED' });
    await http
      .post(`/api/v1/crm/leads/${b.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'ASSIGNED' });

    const res = await http.get('/api/v1/crm/analytics/overview').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('COMPANY');
    expect(res.body.totals.total).toBeGreaterThanOrEqual(2);
    expect(res.body.totals.byStatus.ASSIGNED).toBeGreaterThanOrEqual(2);
    expect(res.body.funnel.map((s: { stage: string }) => s.stage)).toEqual([
      'NEW',
      'ASSIGNED',
      'CONTACTED',
      'QUALIFIED',
      'CONVERTED',
    ]);
    expect(res.body.trend).toHaveLength(30); // default range
    expect(Array.isArray(res.body.sources)).toBe(true);
    expect(res.body.team).not.toBeNull();
    expect(
      res.body.team.some((t: { membershipId: string }) => t.membershipId === fx.admin.membershipId),
    ).toBe(true);

    // fx.limited holds only memberships.read
    const limitedCookie = sessionCookie(await login(fx.limited.email, fx.limited.password));
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', limitedCookie)
      .send({ membershipId: fx.limited.membershipId });
    const denied = await http.get('/api/v1/crm/analytics/overview').set('Cookie', limitedCookie);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('AUTH_FORBIDDEN');
  });

  it('an OWN-scope profile sees only its own leads and gets team=null (never merely hidden by the frontend)', async () => {
    const adminCk = await adminCookie();

    // a profile with crm.leads.read, assigned to fx.plainMember with OWN scope
    const profile = await http
      .post('/api/v1/admin/profiles')
      .set('Cookie', adminCk)
      .send({
        name: 'Analytics OWN Profile',
        permissionKeys: ['crm.leads.read', 'crm.leads.create'],
      });
    expect(profile.status).toBe(200);
    await http
      .post(`/api/v1/admin/access/${fx.plainMember.membershipId}/profile`)
      .set('Cookie', adminCk)
      .send({ roleId: profile.body.id, dataScope: 'OWN' })
      .expect(200);

    const memberCookie = sessionCookie(await login(fx.plainMember.email, fx.plainMember.password));
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', memberCookie)
      .send({ membershipId: fx.plainMember.membershipId });

    // a lead assigned to the admin should NOT count toward the member's OWN view
    const adminLead = await createLead(adminCk);
    await http
      .post(`/api/v1/crm/leads/${adminLead.id}/assign`)
      .set('Cookie', adminCk)
      .send({ membershipId: fx.admin.membershipId });

    // a lead the member creates + is assigned SHOULD count
    const ownLead = await createLead(memberCookie);
    await http
      .post(`/api/v1/crm/leads/${ownLead.id}/assign`)
      .set('Cookie', adminCk)
      .send({ membershipId: fx.plainMember.membershipId });

    const res = await http.get('/api/v1/crm/analytics/overview').set('Cookie', memberCookie);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('OWN');
    expect(res.body.team).toBeNull();
    expect(res.body.totals.unassigned).toBe(0);
    expect(res.body.recent.every((l: { id: string }) => l.id !== adminLead.id)).toBe(true);
    expect(res.body.recent.some((l: { id: string }) => l.id === ownLead.id)).toBe(true);
  });

  it('handles a tenant with zero leads — no NaN, no error, a fully-bucketed zero trend', async () => {
    // tenant B has no CRM leads in the shared fixtures — a real "empty" tenant.
    const cookie = sessionCookie(await login(fx.adminB.email, fx.adminB.password));
    const res = await http.get('/api/v1/crm/analytics/overview?days=7').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.totals.total).toBe(0);
    expect(res.body.trend).toHaveLength(7);
    expect(res.body.trend.every((d: { count: number }) => d.count === 0)).toBe(true);
    expect(res.body.trendDelta).toBeNull(); // fewer than 14 days requested — never fabricated
    expect(
      res.body.funnel.every(
        (s: { count: number; conversionFromStart: number | null }) =>
          s.count === 0 && s.conversionFromStart === null,
      ),
    ).toBe(true);
    expect(res.body.sources).toEqual([]);
    expect(res.body.followups).toMatchObject({
      overdueCount: 0,
      dueTodayCount: 0,
      upcomingCount: 0,
    });
    expect(res.body.recent).toEqual([]);
  });

  it('is tenant-isolated: tenant A leads never appear in tenant B analytics', async () => {
    const bCookie = sessionCookie(await login(fx.adminB.email, fx.adminB.password));
    const res = await http.get('/api/v1/crm/analytics/overview').set('Cookie', bCookie);
    expect(res.status).toBe(200);
    // tenant A created several leads across earlier tests in this file — tenant B must still read 0
    expect(res.body.totals.total).toBe(0);
  });
});
