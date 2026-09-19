import { deflateSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 19 — public, tenant-aware login branding. The slug is resolved with no
 * tenant context through the SELECT-only `tenants_by_public_slug` policy and
 * the tenant id is then widened server-side. Proves the response is minimal,
 * every failure is the same generic 404, and the RLS boundary itself holds.
 */

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
/** A valid solid PNG of the given size (distinct sizes -> distinct bytes). */
function makePng(size: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x40)]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe.skipIf(!INTEGRATION_ENABLED)('Public login branding (Phase 19)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;
  let pool: Pool;
  let slugA: string;
  let slugB: string;
  let slugSuspended: string;

  beforeAll(async () => {
    fx = await makeFixtures();
    app = await bootTestApp();
    http = request(app.getHttpServer());
    pool = await rawPool();
    const rows = await pool.query<{ id: string; slug: string; name: string }>(
      'select id, slug, name from tenants',
    );
    slugA = rows.rows.find((r) => r.id === fx.tenantA)!.slug;
    slugB = rows.rows.find((r) => r.id === fx.tenantB)!.slug;
    slugSuspended = rows.rows.find((r) => r.name === 'Suspended Tenant')!.slug;
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  const adminCookie = async () => {
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email: fx.admin.email, password: fx.admin.password });
    const cookie = sessionCookie(res);
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: fx.admin.membershipId });
    return cookie;
  };
  const binary = (r: request.Test) =>
    r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  const branding = (slug: string) => http.get(`/api/v1/public/workspaces/${slug}/login-branding`);
  const logo = (slug: string) => binary(http.get(`/api/v1/public/workspaces/${slug}/login-logo`));
  const errShape = (res: request.Response) => {
    const body = Buffer.isBuffer(res.body) ? JSON.parse(res.body.toString('utf8')) : res.body;
    return {
      status: res.status,
      code: body.error?.code ?? body.code,
      message: body.error?.message ?? body.message,
    };
  };

  // ---- HTTP --------------------------------------------------------

  it('returns exactly the safe field set, with tenant-name fallback, and needs no auth', async () => {
    const res = await branding(slugA);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        'accentColor',
        'description',
        'displayName',
        'hasLogo',
        'primaryColor',
        'secondaryColor',
        'showPoweredBy',
        'slug',
        'themePreset',
        'welcomeMessage',
      ].sort(),
    );
    expect(res.body).toMatchObject({
      slug: slugA,
      displayName: 'Tenant A',
      showPoweredBy: true,
      hasLogo: false,
      welcomeMessage: null,
    });
  });

  it('round-trips and clears the login copy through settings, and reflects it publicly', async () => {
    const cookie = await adminCookie();
    const put = await http.put('/api/v1/settings/company').set('Cookie', cookie).send({
      displayName: '  Aurora  ',
      loginWelcome: '  Welcome back  ',
      loginDescription: 'Sign in to your workspace',
      loginShowPoweredBy: false,
      themePreset: 'emerald',
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      loginWelcome: 'Welcome back',
      loginDescription: 'Sign in to your workspace',
      loginShowPoweredBy: false,
    });
    const pub = await branding(slugA);
    expect(pub.body).toMatchObject({
      displayName: 'Aurora',
      welcomeMessage: 'Welcome back',
      description: 'Sign in to your workspace',
      showPoweredBy: false,
      themePreset: 'emerald',
    });
    const clear = await http
      .put('/api/v1/settings/company')
      .set('Cookie', cookie)
      .send({ loginWelcome: '', loginDescription: '   ', loginShowPoweredBy: true });
    expect(clear.body).toMatchObject({
      loginWelcome: null,
      loginDescription: null,
      loginShowPoweredBy: true,
    });
    const audit = await http
      .get('/api/v1/admin/audit?action=settings.branding.updated&pageSize=10')
      .set('Cookie', cookie);
    const detail = await http
      .get(`/api/v1/admin/audit/${audit.body.items[0].id}`)
      .set('Cookie', cookie);
    expect(JSON.stringify(detail.body)).toContain('loginWelcome');
  });

  it('rejects over-long login copy', async () => {
    const cookie = await adminCookie();
    for (const body of [{ loginWelcome: 'x'.repeat(81) }, { loginDescription: 'x'.repeat(241) }]) {
      const res = await http.put('/api/v1/settings/company').set('Cookie', cookie).send(body);
      expect(res.status).toBe(400);
    }
  });

  it('answers unknown, malformed and non-active slugs with the identical generic 404', async () => {
    const results = [
      await branding('does-not-exist'),
      await branding('Bad_Slug'),
      await branding('-leading-dash'),
      await branding('x'.repeat(80)),
      await branding(slugSuspended),
    ].map(errShape);
    for (const r of results) {
      expect(r.status).toBe(404);
      expect(r.code).toBe('WORKSPACE_NOT_FOUND');
    }
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
    const logoRes = errShape(await logo(slugSuspended));
    expect(logoRes).toEqual(results[0]);
  });

  it('login-logo 404s with no logo, falls back to the primary logo, then prefers logo_login', async () => {
    const cookie = await adminCookie();
    // B has no logo at all
    expect(errShape(await logo(slugB)).code).toBe('WORKSPACE_NOT_FOUND');
    expect((await branding(slugB)).body.hasLogo).toBe(false);

    const primary = makePng(24);
    const login = makePng(40);
    const up = (kind: string, buf: Buffer) =>
      http
        .post(`/api/v1/settings/company/logo?kind=${kind}`)
        .set('Cookie', cookie)
        .attach('file', buf, { filename: 'l.png', contentType: 'image/png' });

    expect((await up('logo', primary)).status).toBe(200);
    const fallback = await logo(slugA);
    expect(fallback.status).toBe(200);
    expect(fallback.headers['content-type']).toContain('image/png');
    expect(fallback.headers['cache-control']).toBe('public, max-age=300');
    expect((fallback.body as Buffer).equals(primary)).toBe(true);
    expect((await branding(slugA)).body.hasLogo).toBe(true);

    expect((await up('logo_login', login)).status).toBe(200);
    const preferred = await logo(slugA);
    expect((preferred.body as Buffer).equals(login)).toBe(true);
    // no storage key anywhere in the public JSON
    expect(JSON.stringify((await branding(slugA)).body)).not.toContain('tenants/');

    // tenant B still sees nothing of A's
    expect(errShape(await logo(slugB)).code).toBe('WORKSPACE_NOT_FOUND');

    await http.delete('/api/v1/settings/company/logo?kind=logo_login').set('Cookie', cookie);
    const back = await logo(slugA);
    expect((back.body as Buffer).equals(primary)).toBe(true);
    await http.delete('/api/v1/settings/company/logo?kind=logo').set('Cookie', cookie);
    expect(errShape(await logo(slugA)).code).toBe('WORKSPACE_NOT_FOUND');
  });

  // ---- RLS ---------------------------------------------------------

  async function asSlugOnly<T>(slug: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('set role aivoryx_app');
      await c.query('begin');
      await c.query("select set_config('app.workspace_slug', $1, true)", [slug]);
      return await fn(c);
    } finally {
      await c.query('rollback').catch(() => undefined);
      await c.query('reset role').catch(() => undefined);
      c.release();
    }
  }

  it('RLS: a slug-only context reads exactly that active tenant row and no other', async () => {
    await asSlugOnly(slugA, async (c) => {
      const all = await c.query<{ id: string }>('select id from tenants');
      expect(all.rows.map((r) => r.id)).toEqual([fx.tenantA]);
      const other = await c.query('select id from tenants where id = $1', [fx.tenantB]);
      expect(other.rowCount).toBe(0);
    });
  });

  it('RLS: a slug-only context sees no row for a non-active tenant', async () => {
    await asSlugOnly(slugSuspended, async (c) => {
      expect((await c.query('select id from tenants')).rowCount).toBe(0);
    });
  });

  it('RLS: without a slug (or tenant) nothing is visible via the slug policy', async () => {
    await asSlugOnly('', async (c) => {
      expect((await c.query('select id from tenants')).rowCount).toBe(0);
    });
  });

  it('RLS: slug-only cannot read profile/assets until the tenant id is widened', async () => {
    const cookie = await adminCookie();
    await http.put('/api/v1/settings/company').set('Cookie', cookie).send({ displayName: 'Vis' });
    await http
      .post('/api/v1/settings/company/logo?kind=logo')
      .set('Cookie', cookie)
      .attach('file', makePng(24), { filename: 'l.png', contentType: 'image/png' });

    await asSlugOnly(slugA, async (c) => {
      expect((await c.query('select 1 from tenant_company_profiles')).rowCount).toBe(0);
      expect((await c.query('select 1 from tenant_assets')).rowCount).toBe(0);
      await c.query("select set_config('app.tenant_id', $1, true)", [fx.tenantA]);
      expect((await c.query('select 1 from tenant_company_profiles')).rowCount).toBe(1);
      expect((await c.query('select 1 from tenant_assets')).rowCount).toBeGreaterThan(0);
      // widening to A does not reveal B's rows
      expect(
        (await c.query('select 1 from tenant_assets where tenant_id = $1', [fx.tenantB])).rowCount,
      ).toBe(0);
    });
    await http.delete('/api/v1/settings/company/logo?kind=logo').set('Cookie', cookie);
  });

  it('RLS: a slug-only context cannot write tenants', async () => {
    await asSlugOnly(slugA, async (c) => {
      const upd = await c.query("update tenants set name = 'hijacked' where id = $1", [fx.tenantA]);
      expect(upd.rowCount).toBe(0);
      await c.query('savepoint s');
      await expect(
        c.query("insert into tenants (id, slug, name) values (gen_random_uuid(), 'zz-new', 'x')"),
      ).rejects.toThrow();
      await c.query('rollback to savepoint s');
      const del = await c.query('delete from tenants where id = $1', [fx.tenantA]);
      expect(del.rowCount).toBe(0);
    });
    const still = await pool.query('select name from tenants where id = $1', [fx.tenantA]);
    expect(still.rows[0].name).not.toBe('hijacked');
  });
});
