import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { createTenantWithModules, rawPool, type UserFixture } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 16 §9 — the tenant-facing plan/usage endpoint (`GET /settings/plan`),
 * the tenant-scoped mirror of the platform admin's tenant-detail screen.
 * Proves it's genuinely RLS-scoped to the caller's own tenant (never the
 * platform-admin's cross-tenant code path) and reports real, module-gated
 * usage counts — never a fabricated number for a disabled module.
 */
describe.skipIf(!INTEGRATION_ENABLED)('settings — tenant plan & usage', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let tenantId: string;
  let admin: UserFixture;

  beforeAll(async () => {
    const created = await createTenantWithModules({
      name: 'Plan Endpoint Co',
      moduleKeys: ['CRM'],
    });
    tenantId = created.tenantId;
    admin = created.admin;

    const pool = await rawPool();
    try {
      await pool.query(
        `insert into tenant_subscriptions (id, tenant_id, plan_key, status, started_at)
         values (gen_random_uuid(), $1, 'AIVORYX_BUSINESS', 'active', now())`,
        [tenantId],
      );
    } finally {
      await pool.end();
    }

    app = await bootTestApp();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('reports this tenant’s own solution, plan, subscription status and module-gated usage', async () => {
    const login = await http
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: admin.password });
    expect(login.status).toBe(201);
    const cookie = sessionCookie(login);

    const res = await http.get('/api/v1/settings/plan').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      solutionName: 'Business',
      planName: 'Aivoryx Business',
      subscriptionStatus: 'active',
    });
    expect(res.body.subscriptionStartedAt).toBeTypeOf('string');
    expect(res.body.enabledModules).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'CRM' })]),
    );
    // CRM is enabled -> a real (zero) count, not null; HR is not enabled -> null, never fabricated.
    expect(res.body.usage.leads).toBe(0);
    expect(res.body.usage.employees).toBeNull();
  });

  it('a tenant with no subscription row reports nulls, not an error', async () => {
    const bare = await createTenantWithModules({ name: 'No Subscription Co', moduleKeys: [] });
    const login = await http
      .post('/api/v1/auth/login')
      .send({ email: bare.admin.email, password: bare.admin.password });
    const cookie = sessionCookie(login);

    const res = await http.get('/api/v1/settings/plan').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.solutionName).toBeNull();
    expect(res.body.planName).toBeNull();
    expect(res.body.subscriptionStatus).toBeNull();
    expect(res.body.enabledModules).toEqual([]);
  });
});
