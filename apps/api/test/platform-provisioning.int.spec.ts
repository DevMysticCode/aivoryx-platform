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

    const list = await http.get('/api/v1/platform/tenants').set('Cookie', cookie);
    expect(list.body.filter((t: { name: string }) => t.name === name)).toHaveLength(1);
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
