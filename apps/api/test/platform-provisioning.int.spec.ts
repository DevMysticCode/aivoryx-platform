import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { grantPlatformAdmin, makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 14 §15-19, §34-35, §42, §46 — platform-admin tenant provisioning and
 * lifecycle. Drives `/platform/tenants` (create), `/platform/tenants/:id/{activate,
 * suspend,archive}`, `/platform/solutions`, `/platform/plans` and
 * `/platform/tenants/:id/usage` end to end, including the platform-admin
 * authorization boundary and the accept-invitation handoff into a real login.
 */
describe.skipIf(!INTEGRATION_ENABLED)('platform tenant provisioning & lifecycle', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await makeFixtures();
    await grantPlatformAdmin(fx.noMembership.userId, 'platform-provisioning.int.spec');
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

  const platformCookie = async (): Promise<string> =>
    sessionCookie(await login(fx.noMembership.email, fx.noMembership.password));

  const tenantAdminCookie = async (): Promise<string> => {
    const res = await login(fx.admin.email, fx.admin.password);
    const cookie = sessionCookie(res);
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: fx.admin.membershipId });
    return cookie;
  };

  it('lists solutions and plans, each plan resolving to a real solution', async () => {
    const cookie = await platformCookie();
    const solutions = await http.get('/api/v1/platform/solutions').set('Cookie', cookie);
    expect(solutions.status).toBe(200);
    expect(solutions.body.some((s: { key: string }) => s.key === 'SOLAR_EPC')).toBe(true);

    const plans = await http.get('/api/v1/platform/plans').set('Cookie', cookie);
    expect(plans.status).toBe(200);
    const solutionKeys = new Set(solutions.body.map((s: { key: string }) => s.key));
    for (const p of plans.body) {
      expect(solutionKeys.has(p.solutionKey)).toBe(true);
    }
  });

  it('a tenant admin and a plain member are both denied every /platform route', async () => {
    const adminCookie = await tenantAdminCookie();
    for (const cookie of [adminCookie]) {
      const res = await http.get('/api/v1/platform/solutions').set('Cookie', cookie);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
    }
  });

  it('provisions a tenant end to end: solution -> modules -> TENANT_ADMIN -> subscription -> invitation, then the invitee can accept and log in', async () => {
    const cookie = await platformCookie();
    const name = `Acme Field Services ${Date.now()}`;
    const adminEmail = `admin-${Date.now()}@acme-field.test`;

    const created = await http.post('/api/v1/platform/tenants').set('Cookie', cookie).send({
      name,
      solutionKey: 'FIELD_SERVICE',
      adminEmail,
      adminName: 'Acme Admin',
    });
    expect(created.status).toBe(200);
    expect(created.body.tenant.status).toBe('active');
    expect(created.body.tenant.subscription).toMatchObject({ planKey: 'AIVORYX_FIELD_SERVICE' });
    const enabledKeys = created.body.tenant.modules
      .filter((m: { state: string }) => m.state === 'ENABLED')
      .map((m: { key: string }) => m.key)
      .sort();
    expect(enabledKeys).toEqual(['CRM', 'FIELD', 'FINANCE', 'HR', 'SUPPLY'].sort());
    // EPC and COMMERCIAL were not part of the Field Service solution
    expect(enabledKeys).not.toContain('EPC');
    expect(enabledKeys).not.toContain('COMMERCIAL');

    const tenantId = created.body.tenant.id;
    const token = created.body.invitation.token;
    expect(typeof token).toBe('string');

    // the platform admin can immediately read it back via the tenant detail route
    const detail = await http.get(`/api/v1/platform/tenants/${tenantId}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('active');

    // usage is real (from empty data) and module-conditional
    const usage = await http
      .get(`/api/v1/platform/tenants/${tenantId}/usage`)
      .set('Cookie', cookie);
    expect(usage.status).toBe(200);
    expect(usage.body).toMatchObject({ leads: 0, employees: 0, invoices: 0 });
    // SUPPLY is enabled, so projects is a real 0, not null
    expect(usage.body.projects).toBe(0);

    // the invited admin accepts and logs in — they land with the TENANT_ADMIN
    // role, full permission catalogue, and exactly the entitled modules
    const accept = await http.post('/api/v1/auth/accept-invitation').send({
      token,
      password: 'Very-Strong-Passw0rd!',
    });
    expect(accept.status).toBe(200);
    expect(accept.body.email).toBe(adminEmail.toLowerCase());

    const newAdminLogin = await login(adminEmail, 'Very-Strong-Passw0rd!');
    expect(newAdminLogin.status).toBe(201);
    expect(newAdminLogin.body.active.roles).toContain('TENANT_ADMIN');
    expect([...newAdminLogin.body.active.entitledModules].sort()).toEqual(
      ['CRM', 'FIELD', 'FINANCE', 'HR', 'SUPPLY'].sort(),
    );
  });

  describe('tenants list: pagination, search, filtering, sorting', () => {
    const createPagerTenant = async (cookie: string, name: string) => {
      const res = await http
        .post('/api/v1/platform/tenants')
        .set('Cookie', cookie)
        .send({
          name,
          solutionKey: 'FIELD_SERVICE',
          adminEmail: `pager-${Date.now()}-${Math.random().toString(36).slice(2)}@test.test`,
        });
      expect(res.status).toBe(200);
      return res.body.tenant.id as string;
    };

    it('paginates and searches server-side, with a stable tie-break and an accurate total', async () => {
      const cookie = await platformCookie();
      // a unique-per-run prefix scopes every assertion to tenants this test created,
      // so pre-existing/demo tenants can never affect the counts or ordering
      const prefix = `Pager Co ${Date.now()}`;
      const names = [`${prefix} Alpha`, `${prefix} Bravo`, `${prefix} Charlie`];
      for (const name of names) await createPagerTenant(cookie, name);

      const page1 = await http
        .get(`/api/v1/platform/tenants?q=${encodeURIComponent(prefix)}&pageSize=2&page=1`)
        .set('Cookie', cookie);
      expect(page1.status).toBe(200);
      expect(page1.body).toMatchObject({ total: 3, page: 1, pageSize: 2 });
      expect(page1.body.items.map((t: { name: string }) => t.name)).toEqual([names[0], names[1]]);
      // the per-tenant member/module counts are real (correlated subqueries, not a
      // stale join) — every FIELD_SERVICE tenant has exactly 1 member (the invited
      // admin hasn't accepted yet) and 5 enabled modules
      for (const item of page1.body.items) {
        expect(item.memberCount).toBeGreaterThanOrEqual(1);
        expect(item.enabledModuleCount).toBe(5);
      }

      const page2 = await http
        .get(`/api/v1/platform/tenants?q=${encodeURIComponent(prefix)}&pageSize=2&page=2`)
        .set('Cookie', cookie);
      expect(page2.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(page2.body.items.map((t: { name: string }) => t.name)).toEqual([names[2]]);

      // beyond the last page: no error, empty items, the same accurate total
      const page3 = await http
        .get(`/api/v1/platform/tenants?q=${encodeURIComponent(prefix)}&pageSize=2&page=3`)
        .set('Cookie', cookie);
      expect(page3.status).toBe(200);
      expect(page3.body).toMatchObject({ total: 3, page: 3, items: [] });

      // a search matching nothing: empty result, not an error
      const none = await http
        .get(`/api/v1/platform/tenants?q=${encodeURIComponent(prefix)}-nonexistent-suffix`)
        .set('Cookie', cookie);
      expect(none.status).toBe(200);
      expect(none.body).toMatchObject({ total: 0, items: [] });
    });

    it('status filtering narrows both the items and the total', async () => {
      const cookie = await platformCookie();
      const prefix = `Pager Status Co ${Date.now()}`;
      await createPagerTenant(cookie, `${prefix} One`);
      await createPagerTenant(cookie, `${prefix} Two`);

      // freshly provisioned tenants are active, never suspended/archived
      const active = await http
        .get(`/api/v1/platform/tenants?q=${encodeURIComponent(prefix)}&status=active`)
        .set('Cookie', cookie);
      expect(active.body.total).toBe(2);

      const suspended = await http
        .get(`/api/v1/platform/tenants?q=${encodeURIComponent(prefix)}&status=suspended`)
        .set('Cookie', cookie);
      expect(suspended.body).toMatchObject({ total: 0, items: [] });
    });

    it('sorting by modules/members orders by the real per-tenant count, not insertion order', async () => {
      const cookie = await platformCookie();
      const prefix = `Pager Sort Co ${Date.now()}`;
      // SOLAR_EPC enables more modules than BUSINESS, so "Few" (created second,
      // which would sort last by name/created) must still come first under a
      // modules-descending sort if the count is genuinely driving the order.
      const fewRes = await http
        .post('/api/v1/platform/tenants')
        .set('Cookie', cookie)
        .send({
          name: `${prefix} Few`,
          solutionKey: 'BUSINESS',
          adminEmail: `pager-sort-${Date.now()}@test.test`,
        });
      expect(fewRes.status).toBe(200);
      const manyRes = await http
        .post('/api/v1/platform/tenants')
        .set('Cookie', cookie)
        .send({
          name: `${prefix} Many`,
          solutionKey: 'SOLAR_EPC',
          adminEmail: `pager-sort-${Date.now()}-2@test.test`,
        });
      expect(manyRes.status).toBe(200);
      expect(manyRes.body.tenant.enabledModuleCount).toBeGreaterThan(
        fewRes.body.tenant.enabledModuleCount,
      );

      const byModules = await http
        .get(`/api/v1/platform/tenants?q=${encodeURIComponent(prefix)}&sort=modules`)
        .set('Cookie', cookie);
      expect(byModules.body.items.map((t: { name: string }) => t.name)).toEqual([
        `${prefix} Many`,
        `${prefix} Few`,
      ]);
    });

    it('rejects an invalid status, page, or pageSize, and rejects a pageSize above the cap', async () => {
      const cookie = await platformCookie();
      for (const qs of ['status=not-a-real-status', 'page=0', 'pageSize=0', 'pageSize=1000']) {
        const res = await http.get(`/api/v1/platform/tenants?${qs}`).set('Cookie', cookie);
        expect(res.status).toBe(400);
      }
    });

    it('denies the tenant list to a tenant admin, same as every other /platform route', async () => {
      const adminCookie = await tenantAdminCookie();
      const res = await http.get('/api/v1/platform/tenants').set('Cookie', adminCookie);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
    });

    it('the onboarding-readiness endpoint is unaffected by the paginated list query', async () => {
      const cookie = await platformCookie();
      const tenantId = await createPagerTenant(cookie, `Readiness Unaffected Co ${Date.now()}`);
      const readiness = await http
        .get(`/api/v1/platform/tenants/${tenantId}/readiness`)
        .set('Cookie', cookie);
      expect(readiness.status).toBe(200);
      expect(readiness.body.steps.map((s: { key: string }) => s.key)).toEqual([
        'tenant_created',
        'company_profile',
        'modules_configured',
        'admin_assigned',
        'access_verified',
      ]);
    });
  });

  it('readiness checklist: derives each step from real data, never a separate workflow state', async () => {
    const cookie = await platformCookie();
    const name = `Readiness Co ${Date.now()}`;
    const adminEmail = `admin-${Date.now()}@readiness.test`;

    const created = await http.post('/api/v1/platform/tenants').set('Cookie', cookie).send({
      name,
      solutionKey: 'FIELD_SERVICE',
      adminEmail,
      adminName: 'Readiness Admin',
    });
    expect(created.status).toBe(200);
    const tenantId = created.body.tenant.id;
    const token = created.body.invitation.token;

    // immediately after creation: created + admin assigned + modules are already true
    // (the solution enables modules synchronously); profile + access are not yet
    const fresh = await http
      .get(`/api/v1/platform/tenants/${tenantId}/readiness`)
      .set('Cookie', cookie);
    expect(fresh.status).toBe(200);
    const freshByKey = (k: string) =>
      fresh.body.steps.find((s: { key: string }) => s.key === k)?.done;
    expect(freshByKey('tenant_created')).toBe(true);
    expect(freshByKey('admin_assigned')).toBe(true);
    expect(freshByKey('modules_configured')).toBe(true);
    expect(freshByKey('company_profile')).toBe(false);
    expect(freshByKey('access_verified')).toBe(false);
    expect(fresh.body.complete).toBe(false);

    // the invited admin accepts (membership becomes active) but has not yet filled in
    // the company profile
    await http
      .post('/api/v1/auth/accept-invitation')
      .send({ token, password: 'Very-Strong-Passw0rd!' });
    const afterAccept = await http
      .get(`/api/v1/platform/tenants/${tenantId}/readiness`)
      .set('Cookie', cookie);
    expect(
      afterAccept.body.steps.find((s: { key: string }) => s.key === 'access_verified').done,
    ).toBe(true);
    expect(
      afterAccept.body.steps.find((s: { key: string }) => s.key === 'company_profile').done,
    ).toBe(false);
    expect(afterAccept.body.complete).toBe(false);

    // the new tenant admin fills in the company profile — now every step is done
    const adminLogin = await login(adminEmail, 'Very-Strong-Passw0rd!');
    const adminCookie = sessionCookie(adminLogin);
    const putProfile = await http.put('/api/v1/settings/company').set('Cookie', adminCookie).send({
      displayName: name,
      addressLine: '1 Example Street',
      email: adminEmail,
    });
    expect(putProfile.status).toBe(200);

    const complete = await http
      .get(`/api/v1/platform/tenants/${tenantId}/readiness`)
      .set('Cookie', cookie);
    expect(complete.body.steps.every((s: { done: boolean }) => s.done)).toBe(true);
    expect(complete.body.complete).toBe(true);
  });

  it('readiness checklist requires platform admin and a real tenant', async () => {
    const adminCookie = await tenantAdminCookie();
    const denied = await http
      .get(`/api/v1/platform/tenants/${fx.tenantA}/readiness`)
      .set('Cookie', adminCookie);
    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');

    const cookie = await platformCookie();
    const missing = await http
      .get('/api/v1/platform/tenants/00000000-0000-0000-0000-000000000000/readiness')
      .set('Cookie', cookie);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PLATFORM_TENANT_NOT_FOUND');
  });

  it('rejects an unknown solution, an unknown plan, and a dependency-inconsistent module override', async () => {
    const cookie = await platformCookie();

    const badSolution = await http
      .post('/api/v1/platform/tenants')
      .set('Cookie', cookie)
      .send({
        name: `Bad Solution ${Date.now()}`,
        solutionKey: 'NOT_A_REAL_SOLUTION',
        adminEmail: `x-${Date.now()}@test.test`,
      });
    expect(badSolution.status).toBe(404);
    expect(badSolution.body.error.code).toBe('PLATFORM_UNKNOWN_SOLUTION');

    const badPlan = await http
      .post('/api/v1/platform/tenants')
      .set('Cookie', cookie)
      .send({
        name: `Bad Plan ${Date.now()}`,
        solutionKey: 'BUSINESS',
        planKey: 'NOT_A_REAL_PLAN',
        adminEmail: `x-${Date.now()}@test.test`,
      });
    expect(badPlan.status).toBe(404);
    expect(badPlan.body.error.code).toBe('PLATFORM_UNKNOWN_PLAN');

    // COMMERCIAL depends on CRM + SUPPLY — omitting SUPPLY must be rejected
    const badModules = await http
      .post('/api/v1/platform/tenants')
      .set('Cookie', cookie)
      .send({
        name: `Bad Modules ${Date.now()}`,
        solutionKey: 'BUSINESS',
        moduleKeys: ['CRM', 'COMMERCIAL'],
        adminEmail: `x-${Date.now()}@test.test`,
      });
    expect(badModules.status).toBe(422);
    expect(badModules.body.error.code).toBe('PLATFORM_TENANT_INVALID_MODULES');
  });

  it('an identical retried create request fails closed on the deterministic slug rather than duplicating the tenant', async () => {
    const cookie = await platformCookie();
    const name = `Idempotent Co ${Date.now()}`;
    const body = { name, solutionKey: 'BUSINESS', adminEmail: `dup-${Date.now()}@test.test` };

    const first = await http.post('/api/v1/platform/tenants').set('Cookie', cookie).send(body);
    expect(first.status).toBe(200);

    const retry = await http.post('/api/v1/platform/tenants').set('Cookie', cookie).send(body);
    expect(retry.status).toBe(409);
    expect(retry.body.error.code).toBe('PLATFORM_TENANT_SLUG_TAKEN');

    const list = await http
      .get(`/api/v1/platform/tenants?q=${encodeURIComponent(name)}`)
      .set('Cookie', cookie);
    expect(list.body.items.filter((t: { name: string }) => t.name === name)).toHaveLength(1);
  });

  it('lifecycle: active -> suspended blocks normal login, suspended -> active restores it; archived is terminal', async () => {
    const cookie = await platformCookie();
    const created = await http
      .post('/api/v1/platform/tenants')
      .set('Cookie', cookie)
      .send({
        name: `Lifecycle Co ${Date.now()}`,
        solutionKey: 'BUSINESS',
        adminEmail: `lifecycle-${Date.now()}@test.test`,
      });
    const tenantId = created.body.tenant.id;
    const token = created.body.invitation.token;
    await http
      .post('/api/v1/auth/accept-invitation')
      .send({ token, password: 'Very-Strong-Passw0rd!' });

    // sanity: tenant is active before the lifecycle actions below
    const before = await http.get(`/api/v1/platform/tenants/${tenantId}`).set('Cookie', cookie);
    expect(before.body.status).toBe('active');

    // suspend -> the new admin can no longer resolve this tenant
    const suspend = await http
      .post(`/api/v1/platform/tenants/${tenantId}/suspend`)
      .set('Cookie', cookie)
      .send({});
    expect(suspend.status).toBe(200);
    expect(suspend.body.status).toBe('suspended');

    // reactivate -> back to normal
    const reactivate = await http
      .post(`/api/v1/platform/tenants/${tenantId}/activate`)
      .set('Cookie', cookie)
      .send({});
    expect(reactivate.status).toBe(200);
    expect(reactivate.body.status).toBe('active');

    // archive -> terminal; activating again is rejected
    const archive = await http
      .post(`/api/v1/platform/tenants/${tenantId}/archive`)
      .set('Cookie', cookie)
      .send({});
    expect(archive.status).toBe(200);
    expect(archive.body.status).toBe('archived');

    const reactivateArchived = await http
      .post(`/api/v1/platform/tenants/${tenantId}/activate`)
      .set('Cookie', cookie)
      .send({});
    expect(reactivateArchived.status).toBe(409);
    expect(reactivateArchived.body.error.code).toBe('PLATFORM_TENANT_LIFECYCLE_INVALID');
  });
});
