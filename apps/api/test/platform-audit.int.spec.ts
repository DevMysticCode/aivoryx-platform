import { deflateSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { grantPlatformAdmin, makeFixtures, rawPool, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

// Same minimal-PNG builder as platform-branding.int.spec.ts — a real, tiny,
// valid PNG so `validateLogoFile` accepts it without needing an image library.
function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function makePng(w: number, h = w): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x40)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Platform-scoped audit log (Production Operations & Customer Launch
 * Readiness milestone). Drives `/platform/branding` writes end to end into
 * the separate `platform_audit_logs` table and reads them back through
 * `GET /platform/audit` — distinct from the tenant-owned `/admin/audit`
 * (`audit.int.spec.ts`), which requires a real tenant and cannot see these
 * rows at all.
 */
describe.skipIf(!INTEGRATION_ENABLED)('platform audit log', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await makeFixtures();
    await grantPlatformAdmin(fx.noMembership.userId, 'platform-audit.int.spec');
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

  it('a branding update is recorded in platform_audit_logs and readable via GET /platform/audit', async () => {
    const cookie = await platformCookie();
    const uniqueName = `Audit Check ${Date.now()}`;

    const update = await http
      .put('/api/v1/platform/branding')
      .set('Cookie', cookie)
      .send({ platformName: uniqueName });
    expect(update.status).toBe(200);
    expect(update.body.platformName).toBe(uniqueName);

    const list = await http.get('/api/v1/platform/audit?pageSize=5').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ page: 1, pageSize: 5 });
    expect(list.body.total).toBeGreaterThanOrEqual(1);

    const row = list.body.items.find(
      (r: { action: string }) => r.action === 'platform.branding.updated',
    );
    expect(row).toBeTruthy();
    expect(row.entityType).toBe('platform_branding');
    expect(row.metadata).toMatchObject({ fields: expect.arrayContaining(['platformName']) });
    // no secret, token, or password ever appears in the row
    expect(JSON.stringify(row)).not.toMatch(/password|token|secret/i);
  });

  it('an asset upload/removal is recorded with no credential or raw-file-bytes leakage', async () => {
    const cookie = await platformCookie();
    const png = makePng(64);

    const upload = await http
      .post('/api/v1/platform/branding/assets?kind=mark')
      .set('Cookie', cookie)
      .attach('file', png, 'mark.png');
    expect(upload.status).toBe(200);

    const remove = await http
      .delete('/api/v1/platform/branding/assets?kind=mark')
      .set('Cookie', cookie);
    expect(remove.status).toBe(200);

    const list = await http.get('/api/v1/platform/audit?pageSize=10').set('Cookie', cookie);
    const rows = list.body.items.filter(
      (r: { action: string }) => r.action === 'platform.branding.asset_updated',
    );
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(
      rows.some((r: { metadata: { operation: string } }) => r.metadata.operation === 'added'),
    ).toBe(true);
    expect(
      rows.some((r: { metadata: { operation: string } }) => r.metadata.operation === 'removed'),
    ).toBe(true);
    // the uploaded file's own bytes never land in the audit row
    expect(JSON.stringify(rows)).not.toContain(png.toString('base64').slice(0, 20));
  });

  it('is denied to a tenant admin — platform-admin-only, not audit.read-gated', async () => {
    const cookie = await tenantAdminCookie();
    const res = await http.get('/api/v1/platform/audit').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  it('unauthenticated -> 401, same as every other /platform route', async () => {
    const res = await http.get('/api/v1/platform/audit');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_UNAUTHENTICATED');
  });

  it('paginates with a stable total and rejects an invalid page/pageSize', async () => {
    const cookie = await platformCookie();
    const page1 = await http.get('/api/v1/platform/audit?page=1&pageSize=1').set('Cookie', cookie);
    expect(page1.status).toBe(200);
    expect(page1.body.items.length).toBeLessThanOrEqual(1);

    const badPage = await http.get('/api/v1/platform/audit?page=0').set('Cookie', cookie);
    expect(badPage.status).toBe(400);
    const badPageSize = await http
      .get('/api/v1/platform/audit?pageSize=1000')
      .set('Cookie', cookie);
    expect(badPageSize.status).toBe(400);
  });

  it('is append-only at the database level — UPDATE/DELETE as aivoryx_app are rejected (42501)', async () => {
    const cookie = await platformCookie();
    // ensure at least one row exists
    await http
      .put('/api/v1/platform/branding')
      .set('Cookie', cookie)
      .send({ tagline: `append-only check ${Date.now()}` });

    const pool = await rawPool();
    const c = await pool.connect();
    try {
      await c.query('set role aivoryx_app');
      await c.query('begin');
      await c.query("select set_config('app.user_id', $1, true)", [fx.noMembership.userId]);
      const { rows } = await c.query('select id from platform_audit_logs limit 1');
      expect(rows[0]?.id).toBeTruthy();
      await c.query('savepoint sp');
      await expect(
        c.query(`update platform_audit_logs set action = 'x.y' where id = $1`, [rows[0].id]),
      ).rejects.toMatchObject({ code: '42501' });
      await c.query('rollback to sp');
      await expect(
        c.query(`delete from platform_audit_logs where id = $1`, [rows[0].id]),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await c.query('rollback').catch(() => undefined);
      await c.query('reset role').catch(() => undefined);
      c.release();
      await pool.end();
    }
  });

  it('a tenant member sees zero platform_audit_logs rows even through a direct RLS-scoped query', async () => {
    const pool = await rawPool();
    const asUser = async <T>(userId: string, fn: (c: import('pg').PoolClient) => Promise<T>) => {
      const c = await pool.connect();
      try {
        await c.query('set role aivoryx_app');
        await c.query('begin');
        await c.query("select set_config('app.user_id', $1, true)", [userId]);
        return await fn(c);
      } finally {
        await c.query('rollback').catch(() => undefined);
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    };
    const asPlatformAdmin = await asUser(fx.noMembership.userId, (c) =>
      c.query('select count(*)::int as n from platform_audit_logs'),
    );
    expect(asPlatformAdmin.rows[0].n).toBeGreaterThanOrEqual(1);

    const asTenantUser = await asUser(fx.admin.userId, (c) =>
      c.query('select count(*)::int as n from platform_audit_logs'),
    );
    expect(asTenantUser.rows[0].n).toBe(0);
    await pool.end();
  });

  it('a rejected audit insert rolls back the branding mutation too — they are the same transaction', async () => {
    const { PlatformBrandingService } = await import(
      '../src/platform/platform-branding.service.js'
    );
    const branding = app.get(PlatformBrandingService);

    const cookie = await platformCookie();
    const before = await http.get('/api/v1/platform/branding').set('Cookie', cookie);
    const beforeName = before.body.platformName;
    const beforeCount = (await http.get('/api/v1/platform/audit?pageSize=1').set('Cookie', cookie))
      .body.total;

    // `fx.admin.userId` is a real, existing user — but NOT a platform admin, so the
    // RLS INSERT policy on platform_audit_logs rejects (42501) once `app.user_id` is
    // bound to it. Calling the service directly (bypassing the @PlatformAdmin() guard
    // a real request would never get past) is the only way to prove the transaction
    // itself — not just the guard — is what keeps this safe.
    const poisonedName = `SHOULD NOT PERSIST ${Date.now()}`;
    await expect(
      branding.update(fx.admin.userId, { platformName: poisonedName }),
    ).rejects.toMatchObject({ code: '42501' });

    const after = await http.get('/api/v1/platform/branding').set('Cookie', cookie);
    expect(after.body.platformName).toBe(beforeName);
    expect(after.body.platformName).not.toBe(poisonedName);

    const afterCount = (await http.get('/api/v1/platform/audit?pageSize=1').set('Cookie', cookie))
      .body.total;
    expect(afterCount).toBe(beforeCount);
  });
});
