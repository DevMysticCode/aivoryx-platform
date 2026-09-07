import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import {
  createTenantWithModules,
  disableModule,
  enableModule,
  grantPlatformAdmin,
  makeFixtures,
  rawPool,
  setTenantModules,
  type Fixtures,
} from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 13 (ADR 0042) — Platform administration & module entitlement lifecycle.
 *
 * Drives `/platform/*` end to end: the platform-admin boundary, the entitlement
 * lifecycle (enable / disable / re-enable), dependency validation with exact
 * error codes, the "disable immediately denies at the API" property, audit, the
 * platform-admin `:tenantId` route-parameter contract, and concurrency.
 *
 * The direct PostgreSQL RLS proof for `platform_admins` /
 * `tenant_module_entitlements` lives in `rls.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)('platform administration & entitlements', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await makeFixtures();
    // The platform admin is a user with NO tenant membership anywhere — it must
    // still be able to operate every `/platform/*` route.
    await grantPlatformAdmin(fx.noMembership.userId, 'platform.int.spec');
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

  /** Session cookie for the tenant-less platform admin. */
  const platformCookie = async (): Promise<string> =>
    sessionCookie(await login(fx.noMembership.email, fx.noMembership.password));

  /** Cookie for `fx.admin` with tenant A active (TENANT_ADMIN, full catalogue). */
  const tenantAdminCookie = async (): Promise<string> => {
    const res = await login(fx.admin.email, fx.admin.password);
    const cookie = sessionCookie(res);
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: fx.admin.membershipId });
    return cookie;
  };

  // ── the platform-admin boundary ────────────────────────────────────

  describe('the @PlatformAdmin() boundary', () => {
    it('a tenant-less platform admin can read the platform overview', async () => {
      const cookie = await platformCookie();
      const res = await http.get('/api/v1/platform/overview').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.moduleCount).toBe(7);
      expect(res.body.tenantCount).toBeGreaterThanOrEqual(2);
      expect(res.body.modules).toHaveLength(7);
    });

    it('the platform admin never gains a tenant — /auth/me still has no active workspace', async () => {
      const cookie = await platformCookie();
      await http.get('/api/v1/platform/tenants').set('Cookie', cookie).expect(200);
      const me = await http.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.status).toBe(200);
      expect(me.body.isPlatformAdmin).toBe(true);
      expect(me.body.active).toBeNull();
      expect(me.body.memberships).toEqual([]);
    });

    it('an ordinary tenant user is denied every platform route with PLATFORM_ADMIN_REQUIRED', async () => {
      const cookie = await tenantAdminCookie();
      for (const path of [
        '/api/v1/platform/overview',
        '/api/v1/platform/modules',
        '/api/v1/platform/tenants',
        `/api/v1/platform/tenants/${fx.tenantA}`,
      ]) {
        const res = await http.get(path).set('Cookie', cookie);
        expect(res.status, path).toBe(403);
        expect(res.body.error.code, path).toBe('PLATFORM_ADMIN_REQUIRED');
      }
    });

    it('a tenant admin cannot provision modules (PUT) — PLATFORM_ADMIN_REQUIRED, not AUTH_FORBIDDEN', async () => {
      const cookie = await tenantAdminCookie();
      const res = await http
        .put(`/api/v1/platform/tenants/${fx.tenantA}/modules/HR`)
        .set('Cookie', cookie)
        .send({ state: 'DISABLED' });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
    });

    it('unauthenticated → 401 AUTH_UNAUTHENTICATED', async () => {
      const res = await http.get('/api/v1/platform/tenants');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_UNAUTHENTICATED');
    });

    it('the platform-admin identity cannot be forged from the request', async () => {
      const cookie = await tenantAdminCookie();
      // header, query and body tenant/admin hints are all ignored
      const res = await http
        .get('/api/v1/platform/tenants?platformAdmin=true&isPlatformAdmin=1')
        .set('Cookie', cookie)
        .set('X-Tenant-Id', fx.tenantB)
        .set('X-Platform-Admin', 'true');
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
    });
  });

  // ── tenant listing & detail ───────────────────────────────────────

  describe('workspace listing & detail', () => {
    it('lists every workspace and one workspace with its 7-module catalogue', async () => {
      const cookie = await platformCookie();
      const list = await http.get('/api/v1/platform/tenants').set('Cookie', cookie);
      expect(list.status).toBe(200);
      const a = list.body.find((t: { id: string }) => t.id === fx.tenantA);
      expect(a).toBeTruthy();
      expect(a.enabledModuleCount).toBe(7);
      expect(a.memberCount).toBeGreaterThanOrEqual(5);

      const detail = await http.get(`/api/v1/platform/tenants/${fx.tenantA}`).set('Cookie', cookie);
      expect(detail.status).toBe(200);
      expect(detail.body.modules).toHaveLength(7);
      expect(detail.body.modules.every((m: { state: string }) => m.state === 'ENABLED')).toBe(true);
    });

    it('a non-existent workspace → 404 PLATFORM_TENANT_NOT_FOUND', async () => {
      const cookie = await platformCookie();
      const res = await http
        .get('/api/v1/platform/tenants/00000000-0000-0000-0000-000000000000')
        .set('Cookie', cookie);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PLATFORM_TENANT_NOT_FOUND');
    });
  });

  // ── entitlement lifecycle ─────────────────────────────────────────

  describe('entitlement lifecycle', () => {
    it('enable → disable → re-enable a standalone module, with timestamps', async () => {
      const cookie = await platformCookie();
      const { tenantId } = await createTenantWithModules({
        name: 'Lifecycle Co',
        moduleKeys: ['CRM'],
      });
      const put = (state: 'ENABLED' | 'DISABLED') =>
        http
          .put(`/api/v1/platform/tenants/${tenantId}/modules/FINANCE`)
          .set('Cookie', cookie)
          .send({ state });

      const on1 = await put('ENABLED');
      expect(on1.status).toBe(200);
      expect(on1.body.modules.find((m: { key: string }) => m.key === 'FINANCE')).toMatchObject({
        state: 'ENABLED',
      });

      const off = await put('DISABLED');
      expect(off.body.modules.find((m: { key: string }) => m.key === 'FINANCE')).toMatchObject({
        state: 'DISABLED',
      });

      const on2 = await put('ENABLED');
      const fin = on2.body.modules.find((m: { key: string }) => m.key === 'FINANCE');
      expect(fin.state).toBe('ENABLED');
      expect(fin.enabledAt).toBeTruthy();
    });

    it('an unknown module key → 404 ENTITLEMENT_UNKNOWN_MODULE', async () => {
      const cookie = await platformCookie();
      const res = await http
        .put(`/api/v1/platform/tenants/${fx.tenantA}/modules/NOT_A_MODULE`)
        .set('Cookie', cookie)
        .send({ state: 'ENABLED' });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ENTITLEMENT_UNKNOWN_MODULE');
    });

    it('enabling a module with unmet dependencies → 422 ENTITLEMENT_DEPENDENCY_UNMET', async () => {
      const cookie = await platformCookie();
      const { tenantId } = await createTenantWithModules({
        name: 'Deps Co',
        moduleKeys: ['CRM', 'SUPPLY'],
      });
      // EPC needs COMMERCIAL + SUPPLY + FIELD
      const epc = await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/EPC`)
        .set('Cookie', cookie)
        .send({ state: 'ENABLED' });
      expect(epc.status).toBe(422);
      expect(epc.body.error.code).toBe('ENTITLEMENT_DEPENDENCY_UNMET');
      expect(epc.body.error.details.missing.sort()).toEqual(['COMMERCIAL', 'FIELD']);

      // enable the chain, then EPC succeeds
      await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/FIELD`)
        .set('Cookie', cookie)
        .send({ state: 'ENABLED' })
        .expect(200);
      await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/COMMERCIAL`)
        .set('Cookie', cookie)
        .send({ state: 'ENABLED' })
        .expect(200);
      const ok = await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/EPC`)
        .set('Cookie', cookie)
        .send({ state: 'ENABLED' });
      expect(ok.status).toBe(200);
      expect(ok.body.modules.find((m: { key: string }) => m.key === 'EPC').state).toBe('ENABLED');
    });

    it('disabling a depended-on module → 422 ENTITLEMENT_DEPENDANT_ENABLED with the exact dependants', async () => {
      const cookie = await platformCookie();
      const { tenantId } = await createTenantWithModules({
        name: 'Dependants Co',
        moduleKeys: ['CRM', 'SUPPLY', 'FIELD', 'COMMERCIAL', 'EPC'],
      });

      const supply = await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/SUPPLY`)
        .set('Cookie', cookie)
        .send({ state: 'DISABLED' });
      expect(supply.status).toBe(422);
      expect(supply.body.error.code).toBe('ENTITLEMENT_DEPENDANT_ENABLED');
      expect(supply.body.error.details.dependants.sort()).toEqual(['COMMERCIAL', 'EPC']);

      const crm = await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/CRM`)
        .set('Cookie', cookie)
        .send({ state: 'DISABLED' });
      expect(crm.status).toBe(422);
      expect(crm.body.error.details.dependants).toEqual(['COMMERCIAL']);

      const field = await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/FIELD`)
        .set('Cookie', cookie)
        .send({ state: 'DISABLED' });
      expect(field.status).toBe(422);
      expect(field.body.error.details.dependants).toEqual(['EPC']);

      // top-down disable is allowed
      await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/EPC`)
        .set('Cookie', cookie)
        .send({ state: 'DISABLED' })
        .expect(200);
      await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/COMMERCIAL`)
        .set('Cookie', cookie)
        .send({ state: 'DISABLED' })
        .expect(200);
      await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/SUPPLY`)
        .set('Cookie', cookie)
        .send({ state: 'DISABLED' })
        .expect(200);
    });
  });

  // ── disable immediately denies at the API boundary ────────────────

  describe('disabling a module immediately changes authorization', () => {
    it('HR endpoint: 200 → disable HR → 403 ENTITLEMENT_MODULE_NOT_ENABLED → re-enable → 200', async () => {
      const platform = await platformCookie();
      const admin = await tenantAdminCookie(); // TENANT_ADMIN of tenant A, holds hr.* perms

      const before = await http.get('/api/v1/hr/employees').set('Cookie', admin);
      expect(before.status).toBe(200);

      const off = await http
        .put(`/api/v1/platform/tenants/${fx.tenantA}/modules/HR`)
        .set('Cookie', platform)
        .send({ state: 'DISABLED' });
      expect(off.status).toBe(200);

      const denied = await http.get('/api/v1/hr/employees').set('Cookie', admin);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('ENTITLEMENT_MODULE_NOT_ENABLED');
      expect(denied.body.error.details.module).toBe('HR');

      // a CRM endpoint is unaffected
      const crm = await http.get('/api/v1/crm/leads').set('Cookie', admin);
      expect(crm.status).toBe(200);

      const on = await http
        .put(`/api/v1/platform/tenants/${fx.tenantA}/modules/HR`)
        .set('Cookie', platform)
        .send({ state: 'ENABLED' });
      expect(on.status).toBe(200);

      const after = await http.get('/api/v1/hr/employees').set('Cookie', admin);
      expect(after.status).toBe(200);
    });

    it('the entitlement check precedes the permission check (has-perm + not-entitled → ENTITLEMENT, not FORBIDDEN)', async () => {
      const platform = await platformCookie();
      const admin = await tenantAdminCookie();
      await http
        .put(`/api/v1/platform/tenants/${fx.tenantA}/modules/FINANCE`)
        .set('Cookie', platform)
        .send({ state: 'DISABLED' })
        .expect(200);
      try {
        const res = await http.get('/api/v1/finance/overview').set('Cookie', admin);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ENTITLEMENT_MODULE_NOT_ENABLED');
      } finally {
        await http
          .put(`/api/v1/platform/tenants/${fx.tenantA}/modules/FINANCE`)
          .set('Cookie', platform)
          .send({ state: 'ENABLED' })
          .expect(200);
      }
    });
  });

  // ── platform-admin :tenantId route parameter ─────────────────────

  describe('the :tenantId route parameter is a selection, never an identity', () => {
    it('a PUT against tenant B does not make the platform admin a member of tenant B', async () => {
      const cookie = await platformCookie();
      await http
        .put(`/api/v1/platform/tenants/${fx.tenantB}/modules/HR`)
        .set('Cookie', cookie)
        .send({ state: 'DISABLED' })
        .expect(200);
      await http
        .put(`/api/v1/platform/tenants/${fx.tenantB}/modules/HR`)
        .set('Cookie', cookie)
        .send({ state: 'ENABLED' })
        .expect(200);
      const me = await http.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.body.memberships).toEqual([]);
      expect(me.body.active).toBeNull();
    });

    it('writes land in the target tenant only (tenant A entitlements unchanged by a tenant-B change)', async () => {
      const cookie = await platformCookie();
      const { tenantId: other } = await createTenantWithModules({
        name: 'Isolation Co',
        moduleKeys: ['CRM'],
      });
      await http
        .put(`/api/v1/platform/tenants/${other}/modules/HR`)
        .set('Cookie', cookie)
        .send({ state: 'ENABLED' })
        .expect(200);
      const a = await http.get(`/api/v1/platform/tenants/${fx.tenantA}`).set('Cookie', cookie);
      expect(a.body.modules.find((m: { key: string }) => m.key === 'HR').state).toBe('ENABLED');
      const o = await http.get(`/api/v1/platform/tenants/${other}`).set('Cookie', cookie);
      expect(o.body.enabledModuleCount).toBe(2);
    });
  });

  // ── audit ────────────────────────────────────────────────────────

  describe('audit', () => {
    it('enable / disable write platform.module.* rows under the target tenant with a SYSTEM actor', async () => {
      const cookie = await platformCookie();
      const { tenantId } = await createTenantWithModules({
        name: 'Audited Co',
        moduleKeys: ['CRM'],
      });
      await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/FINANCE`)
        .set('Cookie', cookie)
        .send({ state: 'ENABLED' })
        .expect(200);
      await http
        .put(`/api/v1/platform/tenants/${tenantId}/modules/FINANCE`)
        .set('Cookie', cookie)
        .send({ state: 'DISABLED' })
        .expect(200);

      const pool = await rawPool();
      try {
        const { rows } = await pool.query(
          `select action, actor_type, module, metadata->>'module' as meta_module
             from audit_logs where tenant_id = $1 and action like 'platform.module.%'
             order by occurred_at`,
          [tenantId],
        );
        expect(rows.map((r) => r.action)).toEqual([
          'platform.module.enabled',
          'platform.module.disabled',
        ]);
        expect(rows.every((r) => r.actor_type === 'SYSTEM')).toBe(true);
        expect(rows.every((r) => r.module === 'platform')).toBe(true);
        expect(rows.every((r) => r.meta_module === 'FINANCE')).toBe(true);
      } finally {
        await pool.end();
      }
    });
  });

  // ── concurrency ──────────────────────────────────────────────────

  describe('concurrency', () => {
    it('N simultaneous enables of the same module → one row, ENABLED, no 5xx', async () => {
      const cookie = await platformCookie();
      const { tenantId } = await createTenantWithModules({
        name: 'Race Co',
        moduleKeys: ['CRM'],
      });
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          http
            .put(`/api/v1/platform/tenants/${tenantId}/modules/FINANCE`)
            .set('Cookie', cookie)
            .send({ state: 'ENABLED' }),
        ),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);

      const pool = await rawPool();
      try {
        const { rows } = await pool.query(
          `select count(*)::int n, bool_and(state = 'ENABLED') all_enabled
             from tenant_module_entitlements where tenant_id = $1 and module_key = 'FINANCE'`,
          [tenantId],
        );
        expect(rows[0].n).toBe(1);
        expect(rows[0].all_enabled).toBe(true);
      } finally {
        await pool.end();
      }
    });

    it('simultaneous enable + disable of the same module → single row, consistent state', async () => {
      const cookie = await platformCookie();
      const { tenantId } = await createTenantWithModules({
        name: 'Race Co 2',
        moduleKeys: ['CRM'],
      });
      const [a, b] = await Promise.all([
        http
          .put(`/api/v1/platform/tenants/${tenantId}/modules/HR`)
          .set('Cookie', cookie)
          .send({ state: 'ENABLED' }),
        http
          .put(`/api/v1/platform/tenants/${tenantId}/modules/HR`)
          .set('Cookie', cookie)
          .send({ state: 'DISABLED' }),
      ]);
      expect([a.status, b.status].every((s) => s === 200)).toBe(true);

      const pool = await rawPool();
      try {
        const { rows } = await pool.query(
          `select count(*)::int n, max(state) state
             from tenant_module_entitlements where tenant_id = $1 and module_key = 'HR'`,
          [tenantId],
        );
        expect(rows[0].n).toBe(1);
        expect(['ENABLED', 'DISABLED']).toContain(rows[0].state);
        // the read-back API agrees with the stored row
        const detail = await http.get(`/api/v1/platform/tenants/${tenantId}`).set('Cookie', cookie);
        expect(detail.body.modules.find((m: { key: string }) => m.key === 'HR').state).toBe(
          rows[0].state,
        );
      } finally {
        await pool.end();
      }
    });
  });

  // keep the linter happy about unused imports in some configurations
  it('fixture helpers are wired', () => {
    expect(typeof enableModule).toBe('function');
    expect(typeof disableModule).toBe('function');
    expect(typeof setTenantModules).toBe('function');
  });
});
