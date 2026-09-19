import { deflateSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { grantPlatformAdmin, makeFixtures, rawPool, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 20 — Platform branding. Global Aivoryx-level identity, writable only by
 * Platform Admins, readable pre-auth through a minimal DTO. Proves the platform
 * / tenant boundary in both directions, validation, and the singleton.
 */

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

const PUBLIC_KEYS = [
  'accentColor',
  'assets',
  'loginHeading',
  'loginText',
  'name',
  'primaryColor',
  'secondaryColor',
  'tagline',
  'themePreset',
  'version',
];
const ASSET_KEYS = [
  'appleTouch',
  'favicon',
  'loginLogo',
  'logoDark',
  'logoLight',
  'mark',
  'pwa192',
  'pwa512',
];

describe.skipIf(!INTEGRATION_ENABLED)('Platform branding (Phase 20)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;
  let pool: Pool;

  beforeAll(async () => {
    fx = await makeFixtures();
    await grantPlatformAdmin(fx.noMembership.userId, 'platform-branding.int.spec');
    app = await bootTestApp();
    http = request(app.getHttpServer());
    pool = await rawPool();
    await pool.query('delete from platform_assets');
    await pool.query('delete from platform_branding');
  });

  afterAll(async () => {
    await pool?.query('delete from platform_assets').catch(() => undefined);
    await pool?.query('delete from platform_branding').catch(() => undefined);
    await pool?.end();
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  const platformCookie = async () =>
    sessionCookie(
      await http
        .post('/api/v1/auth/login')
        .send({ email: fx.noMembership.email, password: fx.noMembership.password }),
    );
  const tenantAdminCookie = async () => {
    const cookie = sessionCookie(
      await http
        .post('/api/v1/auth/login')
        .send({ email: fx.admin.email, password: fx.admin.password }),
    );
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
  const upload = (cookie: string, kind: string, png: Buffer, type = 'image/png') =>
    http
      .post(`/api/v1/platform/branding/assets?kind=${kind}`)
      .set('Cookie', cookie)
      .attach('file', png, { filename: 'x.png', contentType: type });
  const errCode = (res: request.Response) => res.body?.error?.code;
  const reason = (r: request.Response) => r.body?.error?.details?.reason ?? JSON.stringify(r.body);

  // ---- defaults ----------------------------------------------------

  it('public GET returns hard-coded defaults when nothing is configured', async () => {
    const res = await http.get('/api/v1/public/platform/branding');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Aivoryx',
      tagline: null,
      themePreset: null,
      primaryColor: null,
      loginHeading: null,
      version: '0',
    });
    expect(Object.values(res.body.assets).every((v) => v === false)).toBe(true);
  });

  // ---- authorization -----------------------------------------------

  it('unauthenticated callers get 401 on every admin route', async () => {
    expect((await http.get('/api/v1/platform/branding')).status).toBe(401);
    expect((await http.put('/api/v1/platform/branding').send({ tagline: 'x' })).status).toBe(401);
    expect(
      (
        await http
          .post('/api/v1/platform/branding/assets?kind=mark')
          .attach('file', makePng(32), 'a.png')
      ).status,
    ).toBe(401);
    expect((await http.delete('/api/v1/platform/branding/assets?kind=mark')).status).toBe(401);
  });

  it('a TENANT admin with every tenant permission gets 403 on read and every write', async () => {
    const cookie = await tenantAdminCookie();
    const get = await http.get('/api/v1/platform/branding').set('Cookie', cookie);
    expect(get.status).toBe(403);
    expect(errCode(get)).toBe('PLATFORM_ADMIN_REQUIRED');
    const put = await http
      .put('/api/v1/platform/branding')
      .set('Cookie', cookie)
      .send({ platformName: 'Hijack' });
    expect(put.status).toBe(403);
    expect((await upload(cookie, 'mark', makePng(64))).status).toBe(403);
    expect(
      (await http.delete('/api/v1/platform/branding/assets?kind=mark').set('Cookie', cookie))
        .status,
    ).toBe(403);
    // nothing changed
    const { rows } = await pool.query('select count(*)::int as n from platform_branding');
    expect(rows[0].n).toBe(0);
    expect((await pool.query('select 1 from platform_assets')).rowCount).toBe(0);
  });

  // ---- platform admin flows ----------------------------------------

  it('platform admin reads and updates (empty clears); public DTO is minimal', async () => {
    const cookie = await platformCookie();
    const get = await http.get('/api/v1/platform/branding').set('Cookie', cookie);
    expect(get.status).toBe(200);
    expect(get.body.hasMark).toBe(false);

    const put = await http.put('/api/v1/platform/branding').set('Cookie', cookie).send({
      platformName: '  Aivoryx Cloud ',
      tagline: 'Run the business',
      themePreset: 'ocean',
      loginHeading: 'Welcome',
      loginText: 'Sign in to continue',
    });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      platformName: 'Aivoryx Cloud',
      themePreset: 'ocean',
      loginHeading: 'Welcome',
    });

    const pub = await http.get('/api/v1/public/platform/branding');
    expect(Object.keys(pub.body).sort()).toEqual(PUBLIC_KEYS);
    expect(Object.keys(pub.body.assets).sort()).toEqual(ASSET_KEYS);
    expect(pub.body).toMatchObject({ name: 'Aivoryx Cloud', tagline: 'Run the business' });
    expect(pub.body.version).not.toBe('0');

    const cleared = await http
      .put('/api/v1/platform/branding')
      .set('Cookie', cookie)
      .send({ tagline: '', loginText: '' });
    expect(cleared.body.tagline).toBeNull();
    expect(cleared.body.loginText).toBeNull();
    const { rows } = await pool.query('select updated_by_user_id from platform_branding');
    expect(rows[0].updated_by_user_id).toBe(fx.noMembership.userId);
  });

  it('rejects a low-contrast primary with a suggestion, and does not persist it', async () => {
    const cookie = await platformCookie();
    const res = await http
      .put('/api/v1/platform/branding')
      .set('Cookie', cookie)
      .send({ primaryColor: '#ffff66' });
    expect(res.status).toBe(422);
    expect(errCode(res)).toBe('BRANDING_COLOR_LOW_CONTRAST');
    expect(JSON.stringify(res.body)).toContain('suggestedPrimary');
    const stored = await pool.query('select primary_color from platform_branding');
    expect(stored.rows[0].primary_color).toBeNull();

    const ok = await http
      .put('/api/v1/platform/branding')
      .set('Cookie', cookie)
      .send({ primaryColor: '#1E40AF', accentColor: '#0EA5E9' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ themePreset: 'custom', primaryColor: '#1e40af' });
    const bad = await http
      .put('/api/v1/platform/branding')
      .set('Cookie', cookie)
      .send({ primaryColor: 'red' });
    expect(bad.status).toBe(400);
  });

  it('uploads, streams publicly with the sniffed type, and removes an asset', async () => {
    const cookie = await platformCookie();
    const png = makePng(64);
    const up = await upload(cookie, 'mark', png);
    expect(up.status).toBe(200);
    expect(up.body.hasMark).toBe(true);
    expect(JSON.stringify(up.body)).not.toContain('platform/branding/');

    const pub = await http.get('/api/v1/public/platform/branding');
    expect(pub.body.assets.mark).toBe(true);
    expect(pub.body.assets.favicon).toBe(false);

    const asset = await binary(http.get('/api/v1/public/platform/branding/asset?kind=mark'));
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toContain('image/png');
    expect(asset.headers['cache-control']).toBe('public, max-age=300');
    expect(Buffer.compare(asset.body as Buffer, png)).toBe(0);

    const { rows } = await pool.query('select object_key from platform_assets');
    expect(rows[0].object_key).toMatch(/^platform\/branding\/mark\/[0-9a-f-]+\.png$/);
    expect(JSON.stringify(pub.body)).not.toContain(rows[0].object_key);

    const del = await http
      .delete('/api/v1/platform/branding/assets?kind=mark')
      .set('Cookie', cookie);
    expect(del.status).toBe(200);
    expect(del.body.hasMark).toBe(false);
    expect((await http.get('/api/v1/public/platform/branding/asset?kind=mark')).status).toBe(404);
    const again = await http
      .delete('/api/v1/platform/branding/assets?kind=mark')
      .set('Cookie', cookie);
    expect(again.status).toBe(404);
  });

  it('public asset is a generic 404 for unset and invalid kinds', async () => {
    for (const kind of ['favicon', 'nope', '']) {
      const res = await http.get(`/api/v1/public/platform/branding/asset?kind=${kind}`);
      expect(res.status).toBe(404);
      expect(errCode(res)).toBe('PLATFORM_ASSET_NOT_FOUND');
    }
    expect((await http.get('/api/v1/public/platform/branding/asset')).status).toBe(404);
  });

  it('validates PWA / shape rules and file type', async () => {
    const cookie = await platformCookie();
    const notSquare = await upload(cookie, 'pwa_192', makePng(256, 200));
    expect(notSquare.status).toBe(422);
    expect(reason(notSquare)).toBe('not_square');
    expect(reason(await upload(cookie, 'pwa_192', makePng(128)))).toBe('too_small');
    expect(reason(await upload(cookie, 'pwa_512', makePng(256)))).toBe('too_small');
    expect(reason(await upload(cookie, 'favicon', makePng(200, 32)))).toBe('not_square');
    expect(reason(await upload(cookie, 'apple_touch', makePng(120)))).toBe('too_small');
    expect((await upload(cookie, 'pwa_192', makePng(192))).status).toBe(200);
    expect((await upload(cookie, 'pwa_512', makePng(512))).status).toBe(200);
    expect((await upload(cookie, 'logo_light', makePng(300, 80))).status).toBe(200);
    // declared type mismatch / SVG / unknown kind / no file
    expect((await upload(cookie, 'mark', makePng(64), 'image/jpeg')).status).toBe(422);
    const svg = await http
      .post('/api/v1/platform/branding/assets?kind=mark')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), {
        filename: 'a.svg',
        contentType: 'image/svg+xml',
      });
    expect(svg.status).toBe(422);
    expect((await upload(cookie, 'bogus', makePng(64))).status).toBe(400);
    expect(
      (await http.post('/api/v1/platform/branding/assets?kind=mark').set('Cookie', cookie)).status,
    ).toBe(422);
  });

  // ---- tenant / platform isolation ---------------------------------

  it('tenant and platform assets never cross', async () => {
    const platform = await platformCookie();
    const tenant = await tenantAdminCookie();
    await pool.query('delete from platform_assets');

    const tenantPng = makePng(48);
    const platformPng = makePng(80);
    const tUp = await http
      .post('/api/v1/settings/company/logo?kind=favicon')
      .set('Cookie', tenant)
      .attach('file', tenantPng, { filename: 't.png', contentType: 'image/png' });
    expect(tUp.status).toBe(200);
    // a tenant upload did not create a platform asset
    const pub = await http.get('/api/v1/public/platform/branding');
    expect(pub.body.assets.favicon).toBe(false);
    expect((await pool.query('select 1 from platform_assets')).rowCount).toBe(0);

    expect((await upload(platform, 'favicon', platformPng)).status).toBe(200);
    // a platform upload did not touch the tenant's asset
    const tRead = await binary(
      http.get('/api/v1/settings/company/logo?kind=favicon').set('Cookie', tenant),
    );
    expect(Buffer.compare(tRead.body as Buffer, tenantPng)).toBe(0);
    // ...and the public platform stream serves the platform bytes, not the tenant's
    const pRead = await binary(http.get('/api/v1/public/platform/branding/asset?kind=favicon'));
    expect(Buffer.compare(pRead.body as Buffer, platformPng)).toBe(0);

    // a platform-only asset is invisible to the tenant logo endpoint
    expect((await upload(platform, 'login_logo', makePng(64))).status).toBe(200);
    const tLogin = await http
      .get('/api/v1/settings/company/logo?kind=logo_login')
      .set('Cookie', tenant);
    expect(tLogin.status).toBe(404);
    const tDefault = await http.get('/api/v1/settings/company/logo').set('Cookie', tenant);
    expect(tDefault.status).toBe(404);

    // keys are namespaced apart
    const keys = await pool.query('select object_key from platform_assets');
    expect(keys.rows.every((r) => String(r.object_key).startsWith('platform/branding/'))).toBe(
      true,
    );
    const tKeys = await pool.query('select object_key from tenant_assets');
    expect(tKeys.rows.every((r) => String(r.object_key).startsWith('tenants/'))).toBe(true);

    // removing the tenant's asset leaves the platform's untouched
    await http.delete('/api/v1/settings/company/logo?kind=favicon').set('Cookie', tenant);
    expect((await http.get('/api/v1/public/platform/branding')).body.assets.favicon).toBe(true);
  });

  // ---- database ------------------------------------------------------

  it('enforces the singleton and value constraints at the database', async () => {
    await pool.query('delete from platform_branding');
    await pool.query('insert into platform_branding (platform_name) values ($1)', ['A']);
    await expect(
      pool.query('insert into platform_branding (platform_name) values ($1)', ['B']),
    ).rejects.toThrow(/duplicate key|platform_branding_pkey/);
    await expect(
      pool.query('insert into platform_branding (singleton, platform_name) values (false, $1)', [
        'C',
      ]),
    ).rejects.toThrow(/platform_branding_singleton_chk/);
    await expect(pool.query("update platform_branding set primary_color = 'red'")).rejects.toThrow(
      /platform_branding_primary_hex/,
    );
    await expect(pool.query("update platform_branding set theme_preset = 'nope'")).rejects.toThrow(
      /theme_preset_chk/,
    );
    await expect(
      pool.query('update platform_branding set login_heading = $1', ['x'.repeat(81)]),
    ).rejects.toThrow(/login_heading_len/);
    await expect(
      pool.query('update platform_branding set login_text = $1', ['x'.repeat(241)]),
    ).rejects.toThrow(/login_text_len/);
    await pool.query('delete from platform_assets');
    await pool.query(
      "insert into platform_assets (id, kind, object_key, content_type, size_bytes) values (gen_random_uuid(), 'mark', 'platform/branding/mark/a.png', 'image/png', 1)",
    );
    await expect(
      pool.query(
        "insert into platform_assets (id, kind, object_key, content_type, size_bytes) values (gen_random_uuid(), 'mark', 'platform/branding/mark/b.png', 'image/png', 1)",
      ),
    ).rejects.toThrow(/platform_assets_kind_uq/);
  });
});
