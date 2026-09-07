import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import {
  createTenantWithModules,
  grantPlatformAdmin,
  makeFixtures,
  setTenantModules,
  type Fixtures,
} from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 13 (ADR 0042) — the authorization matrix, tenant-side access
 * configuration, effective access and data scope.
 *
 *   TENANT MODULE ENTITLEMENT → PROFILE / PERMISSION SET → DATA SCOPE → ALLOW/DENY
 *
 * The full §50 matrix is proved through real HTTP requests: entitlement is
 * always evaluated before the permission, so a workspace that lacks a module
 * denies with `ENTITLEMENT_MODULE_NOT_ENABLED` even when the user's profile
 * carries the permission.
 */
describe.skipIf(!INTEGRATION_ENABLED)(
  'platform access — authorization matrix & configuration',
  () => {
    let app: INestApplication;
    let http: ReturnType<typeof request>;
    let fx: Fixtures;

    beforeAll(async () => {
      fx = await makeFixtures();
      await grantPlatformAdmin(fx.noMembership.userId, 'access.int.spec');
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
    const cookieFor = async (u: { email: string; password: string }): Promise<string> =>
      sessionCookie(await login(u.email, u.password));
    const platformCookie = async (): Promise<string> => cookieFor(fx.noMembership);

    const switchTo = async (cookie: string, membershipId: string) =>
      http.post('/api/v1/auth/switch-tenant').set('Cookie', cookie).send({ membershipId });

    // ── §50 authorization matrix ──────────────────────────────────────

    describe('§50 matrix — entitlement is evaluated before permission', () => {
      it('CASE A: module entitled + permission held → ALLOW (200)', async () => {
        const t = await createTenantWithModules({ name: 'Matrix A', moduleKeys: ['CRM'] });
        const admin = await cookieFor(t.admin);

        const prof = await http
          .post('/api/v1/admin/profiles')
          .set('Cookie', admin)
          .send({ name: 'CRM Reader', permissionKeys: ['crm.leads.read'] });
        expect(prof.status).toBe(200);
        await http
          .post(`/api/v1/admin/access/${t.member.membershipId}/profile`)
          .set('Cookie', admin)
          .send({ roleId: prof.body.id, dataScope: 'OWN' })
          .expect(200);

        const member = await cookieFor(t.member);
        const res = await http.get('/api/v1/crm/leads').set('Cookie', member);
        expect(res.status).toBe(200);
      });

      it('CASE B: module entitled + permission NOT held → AUTH_FORBIDDEN (403)', async () => {
        const t = await createTenantWithModules({ name: 'Matrix B', moduleKeys: ['CRM'] });
        const member = await cookieFor(t.member); // no profile at all
        const res = await http.get('/api/v1/crm/leads').set('Cookie', member);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
      });

      it('CASE C: module NOT entitled + permission held → ENTITLEMENT_MODULE_NOT_ENABLED (403)', async () => {
        const t = await createTenantWithModules({ name: 'Matrix C', moduleKeys: [] });
        const admin = await cookieFor(t.admin); // TENANT_ADMIN → holds crm.leads.read
        const res = await http.get('/api/v1/crm/leads').set('Cookie', admin);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ENTITLEMENT_MODULE_NOT_ENABLED');
        expect(res.body.error.details.module).toBe('CRM');
      });

      it('CASE D: module NOT entitled + permission NOT held → ENTITLEMENT_MODULE_NOT_ENABLED (403)', async () => {
        const t = await createTenantWithModules({ name: 'Matrix D', moduleKeys: [] });
        const member = await cookieFor(t.member); // no roles
        const res = await http.get('/api/v1/crm/leads').set('Cookie', member);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ENTITLEMENT_MODULE_NOT_ENABLED');
      });

      it('platform / identity permissions are never module-gated (roles.read works with zero modules)', async () => {
        const t = await createTenantWithModules({ name: 'Platform Perms', moduleKeys: [] });
        const admin = await cookieFor(t.admin);
        const res = await http.get('/api/v1/admin/roles').set('Cookie', admin);
        expect(res.status).toBe(200);
      });
    });

    // ── multi-membership: everything follows the ACTIVE membership ─────

    describe('a user with two memberships — access follows the active tenant, never a header', () => {
      it('effective permissions AND entitled modules change on switch-tenant', async () => {
        // tenant B trimmed to CRM + SUPPLY for this test, then restored.
        await setTenantModules(fx.tenantB, ['CRM', 'SUPPLY']);
        try {
          const cookie = await cookieFor(fx.admin); // TENANT_ADMIN in A, role-less member of B

          await switchTo(cookie, fx.admin.membershipId);
          const inA = await http.get('/api/v1/auth/me').set('Cookie', cookie);
          expect(inA.body.active.entitledModules).toHaveLength(7);
          expect(inA.body.active.permissions.length).toBeGreaterThan(50);

          await switchTo(cookie, fx.admin.membershipIdInB);
          const inB = await http.get('/api/v1/auth/me').set('Cookie', cookie);
          expect(inB.body.active.entitledModules.sort()).toEqual(['CRM', 'SUPPLY']);
          expect(inB.body.active.permissions).toEqual([]); // role-less in B

          // an X-Tenant-Id header cannot resurrect tenant-A access while B is active
          const spoof = await http
            .get('/api/v1/crm/leads')
            .set('Cookie', cookie)
            .set('X-Tenant-Id', fx.tenantA);
          expect(spoof.status).toBe(403); // role-less in the ACTIVE tenant B
        } finally {
          await setTenantModules(fx.tenantB, [
            'CRM',
            'FIELD',
            'SUPPLY',
            'COMMERCIAL',
            'EPC',
            'FINANCE',
            'HR',
          ]);
        }
      });
    });

    // ── tenant-side access configuration ─────────────────────────────

    describe('profiles & permission sets — only entitled-module permissions', () => {
      it('a profile rejects a permission of a non-entitled module → ACCESS_PERMISSION_NOT_AVAILABLE', async () => {
        const t = await createTenantWithModules({ name: 'Config CRM only', moduleKeys: ['CRM'] });
        const admin = await cookieFor(t.admin);

        const bad = await http
          .post('/api/v1/admin/profiles')
          .set('Cookie', admin)
          .send({ name: 'HR Exec', permissionKeys: ['hr.employee.read'] });
        expect(bad.status).toBe(422);
        expect(bad.body.error.code).toBe('ACCESS_PERMISSION_NOT_AVAILABLE');
        expect(bad.body.error.details.module).toBe('HR');

        const badSet = await http
          .post('/api/v1/admin/permission-sets')
          .set('Cookie', admin)
          .send({ name: 'HR read', permissionKeys: ['hr.attendance.read'] });
        expect(badSet.status).toBe(422);
        expect(badSet.body.error.code).toBe('ACCESS_PERMISSION_NOT_AVAILABLE');

        const good = await http
          .post('/api/v1/admin/profiles')
          .set('Cookie', admin)
          .send({ name: 'CRM Exec', permissionKeys: ['crm.leads.read', 'crm.leads.update'] });
        expect(good.status).toBe(200);
        expect(good.body.kind).toBe('profile');
        expect(good.body.permissionKeys.sort()).toEqual(['crm.leads.read', 'crm.leads.update']);
      });

      it('GET available-permissions is filtered to entitled modules + platform permissions', async () => {
        const t = await createTenantWithModules({ name: 'Available', moduleKeys: ['CRM'] });
        const admin = await cookieFor(t.admin);
        const res = await http
          .get('/api/v1/admin/access/available-permissions')
          .set('Cookie', admin);
        expect(res.status).toBe(200);
        const keys: string[] = res.body.map((p: { key: string }) => p.key);
        expect(keys).toContain('crm.leads.read');
        expect(keys).toContain('roles.read'); // platform permission, module = null
        expect(keys.some((k) => k.startsWith('hr.'))).toBe(false);
        expect(keys.some((k) => k.startsWith('finance.'))).toBe(false);
      });
    });

    // ── effective access & data scope ───────────────────────────────

    describe('effective access', () => {
      it('reports per-module entitlement, granted permissions, data scope; hides disabled-module permissions', async () => {
        const platform = await platformCookie();
        const t = await createTenantWithModules({
          name: 'Effective Co',
          moduleKeys: ['CRM', 'FINANCE'],
        });
        const admin = await cookieFor(t.admin);

        const prof = await http
          .post('/api/v1/admin/profiles')
          .set('Cookie', admin)
          .send({ name: 'CRM+Fin', permissionKeys: ['crm.leads.read', 'finance.read'] });
        await http
          .post(`/api/v1/admin/access/${t.member.membershipId}/profile`)
          .set('Cookie', admin)
          .send({ roleId: prof.body.id, dataScope: 'DEPARTMENT' })
          .expect(200);

        const before = await http
          .get(`/api/v1/admin/access/${t.member.membershipId}`)
          .set('Cookie', admin);
        expect(before.status).toBe(200);
        expect(before.body.profile.dataScope).toBe('DEPARTMENT');
        const crm = before.body.modules.find((m: { moduleKey: string }) => m.moduleKey === 'CRM');
        const hr = before.body.modules.find((m: { moduleKey: string }) => m.moduleKey === 'HR');
        expect(crm.entitled).toBe(true);
        expect(crm.dataScope).toBe('DEPARTMENT');
        expect(
          crm.permissions.find((p: { key: string }) => p.key === 'crm.leads.read').granted,
        ).toBe(true);
        expect(hr.entitled).toBe(false);
        expect(hr.dataScope).toBeNull();
        expect(hr.permissions.every((p: { granted: boolean }) => p.granted === false)).toBe(true);

        // disable FINANCE → its permissions must stop being reported as granted
        await http
          .put(`/api/v1/platform/tenants/${t.tenantId}/modules/FINANCE`)
          .set('Cookie', platform)
          .send({ state: 'DISABLED' })
          .expect(200);
        const after = await http
          .get(`/api/v1/admin/access/${t.member.membershipId}`)
          .set('Cookie', admin);
        const fin = after.body.modules.find(
          (m: { moduleKey: string }) => m.moduleKey === 'FINANCE',
        );
        expect(fin.entitled).toBe(false);
        expect(fin.permissions.every((p: { granted: boolean }) => p.granted === false)).toBe(true);
      });

      it('a permission set adds, and removing it takes the permission away', async () => {
        const t = await createTenantWithModules({ name: 'Set Co', moduleKeys: ['CRM'] });
        const admin = await cookieFor(t.admin);
        const set = await http
          .post('/api/v1/admin/permission-sets')
          .set('Cookie', admin)
          .send({ name: 'Lead writer', permissionKeys: ['crm.leads.create'] });
        const added = await http
          .post(`/api/v1/admin/access/${t.member.membershipId}/permission-sets`)
          .set('Cookie', admin)
          .send({ roleId: set.body.id });
        expect(added.status).toBe(200);
        expect(added.body.permissionSets.map((s: { id: string }) => s.id)).toContain(set.body.id);
        const member = await cookieFor(t.member);
        expect((await http.get('/api/v1/crm/leads').set('Cookie', member)).status).toBe(403); // no read
        expect(
          (
            await http
              .post('/api/v1/crm/leads')
              .set('Cookie', member)
              .send({ name: 'X', phone: '9999999999' })
          ).status,
        ).not.toBe(403); // has create

        const removed = await http
          .delete(`/api/v1/admin/access/${t.member.membershipId}/permission-sets/${set.body.id}`)
          .set('Cookie', admin);
        expect(removed.status).toBe(200);
        expect(removed.body.permissionSets).toEqual([]);
      });

      it('an invalid data scope is rejected (400)', async () => {
        const t = await createTenantWithModules({ name: 'Scope Co', moduleKeys: ['CRM'] });
        const admin = await cookieFor(t.admin);
        const prof = await http
          .post('/api/v1/admin/profiles')
          .set('Cookie', admin)
          .send({ name: 'Any', permissionKeys: ['crm.leads.read'] });
        const res = await http
          .post(`/api/v1/admin/access/${t.member.membershipId}/profile`)
          .set('Cookie', admin)
          .send({ roleId: prof.body.id, dataScope: 'GALAXY' });
        expect(res.status).toBe(400);
      });

      it('every valid data scope round-trips (OWN / TEAM / DEPARTMENT / COMPANY)', async () => {
        const t = await createTenantWithModules({ name: 'Scopes Co', moduleKeys: ['CRM'] });
        const admin = await cookieFor(t.admin);
        const prof = await http
          .post('/api/v1/admin/profiles')
          .set('Cookie', admin)
          .send({ name: 'Scoped', permissionKeys: ['crm.leads.read'] });
        for (const dataScope of ['OWN', 'TEAM', 'DEPARTMENT', 'COMPANY'] as const) {
          const res = await http
            .post(`/api/v1/admin/access/${t.member.membershipId}/profile`)
            .set('Cookie', admin)
            .send({ roleId: prof.body.id, dataScope });
          expect(res.status).toBe(200);
          expect(res.body.profile.dataScope).toBe(dataScope);
        }
      });
    });
  },
);
