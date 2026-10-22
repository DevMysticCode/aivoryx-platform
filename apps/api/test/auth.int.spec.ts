import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

const COOKIE = 'aivoryx_session';

describe.skipIf(!INTEGRATION_ENABLED)('security boundary — HTTP integration', () => {
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

  // ---- authentication -------------------------------------------------

  describe('authentication', () => {
    it('valid login succeeds, sets an HttpOnly cookie, never returns secret fields', async () => {
      const res = await login(fx.admin.email, fx.admin.password);
      expect(res.status).toBe(201);
      const setCookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite/i);
      expect(setCookie.startsWith(`${COOKIE}=`)).toBe(true);

      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/password_hash|passwordHash|token_hash|tokenHash/);
      expect(body).not.toContain(fx.admin.password);
      // the raw token is in the cookie, not the JSON body
      const token = sessionCookie(res).split('=')[1]!;
      expect(body).not.toContain(token);
      expect(res.body.user.email).toBe(fx.admin.email);
      expect(res.body.tenantAutoSelected).toBe(false); // admin has 2 memberships
    });

    it('a session row is created, storing only a SHA-256 hash of the token', async () => {
      const res = await login(fx.adminB.email, fx.adminB.password);
      const token = sessionCookie(res).split('=')[1]!;
      const pool = await rawPool();
      try {
        const byRaw = await pool.query('select id from sessions where token_hash = $1', [token]);
        expect(byRaw.rowCount).toBe(0); // raw token is never stored
        const { createHash } = await import('node:crypto');
        const hash = createHash('sha256').update(token).digest('hex');
        const byHash = await pool.query('select user_id from sessions where token_hash = $1', [
          hash,
        ]);
        expect(byHash.rowCount).toBe(1);
        expect(byHash.rows[0].user_id).toBe(fx.adminB.userId);
      } finally {
        await pool.end();
      }
    });

    it('wrong password and unknown user both fail with 401 AUTH_INVALID_CREDENTIALS', async () => {
      const wrong = await login(fx.admin.email, 'not-the-password');
      expect(wrong.status).toBe(401);
      expect(wrong.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');

      const unknown = await login('nobody@example.test', 'whatever-password');
      expect(unknown.status).toBe(401);
      expect(unknown.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
      // identical response — no account enumeration
      expect(unknown.body.error.message).toBe(wrong.body.error.message);
    });

    it('rejects an unauthenticated request to a protected route with 401', async () => {
      const res = await http.get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_UNAUTHENTICATED');
    });

    it('logout revokes the session; the cookie is then unusable', async () => {
      const res = await login(fx.adminB.email, fx.adminB.password);
      const cookie = sessionCookie(res);

      const me1 = await http.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me1.status).toBe(200);

      const out = await http.post('/api/v1/auth/logout').set('Cookie', cookie);
      expect(out.status).toBe(201);
      expect(out.body).toEqual({ ok: true });

      const me2 = await http.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me2.status).toBe(401);
      expect(me2.body.error.code).toBe('AUTH_SESSION_REVOKED');
    });

    it('an expired session is rejected with AUTH_SESSION_EXPIRED', async () => {
      const res = await login(fx.adminB.email, fx.adminB.password);
      const cookie = sessionCookie(res);
      const token = cookie.split('=')[1]!;
      const { createHash } = await import('node:crypto');
      const hash = createHash('sha256').update(token).digest('hex');

      const pool = await rawPool();
      try {
        await pool.query(
          "update sessions set expires_at = now() - interval '1 minute' where token_hash = $1",
          [hash],
        );
      } finally {
        await pool.end();
      }

      const me = await http.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.status).toBe(401);
      expect(me.body.error.code).toBe('AUTH_SESSION_EXPIRED');
    });
  });

  // ---- tenant membership + switching ---------------------------------

  describe('active tenant membership', () => {
    it('a single-membership user is auto-selected into that tenant on login', async () => {
      const res = await login(fx.adminB.email, fx.adminB.password);
      expect(res.body.tenantAutoSelected).toBe(true);
      expect(res.body.active).not.toBeNull();
      expect(res.body.active.membership.tenantId).toBe(fx.tenantB);
    });

    it('a multi-membership user starts with no active tenant and lists both', async () => {
      const res = await login(fx.admin.email, fx.admin.password);
      expect(res.body.active).toBeNull();
      const tenantIds = res.body.memberships.map((m: { tenantId: string }) => m.tenantId).sort();
      expect(tenantIds).toEqual([fx.tenantA, fx.tenantB].sort());

      const cookie = sessionCookie(res);
      const tenantRoute = await http.get('/api/v1/admin/permissions').set('Cookie', cookie);
      expect(tenantRoute.status).toBe(403);
      expect(tenantRoute.body.error.code).toBe('AUTH_NO_ACTIVE_TENANT');
    });

    it('switches only to one of the user’s own memberships', async () => {
      const res = await login(fx.admin.email, fx.admin.password);
      const cookie = sessionCookie(res);

      const ok = await http
        .post('/api/v1/auth/switch-tenant')
        .set('Cookie', cookie)
        .send({ membershipId: fx.admin.membershipId });
      expect(ok.status).toBe(201);
      expect(ok.body.active.membership.tenantId).toBe(fx.tenantA);

      const me = await http.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.body.active.membership.id).toBe(fx.admin.membershipId);
    });

    it('cannot switch to another user’s membership (403 AUTH_MEMBERSHIP_INVALID)', async () => {
      const res = await login(fx.admin.email, fx.admin.password);
      const cookie = sessionCookie(res);
      const attempt = await http
        .post('/api/v1/auth/switch-tenant')
        .set('Cookie', cookie)
        .send({ membershipId: fx.adminB.membershipId }); // belongs to adminB
      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('AUTH_MEMBERSHIP_INVALID');
    });

    it('cannot activate a suspended membership (403 AUTH_MEMBERSHIP_SUSPENDED)', async () => {
      const res = await login(fx.suspended.email, fx.suspended.password);
      // one membership but suspended -> not auto-selected
      expect(res.body.tenantAutoSelected).toBe(false);
      const cookie = sessionCookie(res);
      const attempt = await http
        .post('/api/v1/auth/switch-tenant')
        .set('Cookie', cookie)
        .send({ membershipId: fx.suspended.membershipId });
      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('AUTH_MEMBERSHIP_SUSPENDED');
    });

    it('cannot activate a membership in a suspended tenant (403 TENANT_SUSPENDED)', async () => {
      const res = await login(fx.inSuspendedTenant.email, fx.inSuspendedTenant.password);
      expect(res.body.tenantAutoSelected).toBe(false);
      const cookie = sessionCookie(res);
      const attempt = await http
        .post('/api/v1/auth/switch-tenant')
        .set('Cookie', cookie)
        .send({ membershipId: fx.inSuspendedTenant.membershipId });
      expect(attempt.status).toBe(403);
      expect(attempt.body.error.code).toBe('TENANT_SUSPENDED');
    });

    it('a user with zero memberships authenticates but cannot reach tenant-scoped routes', async () => {
      const res = await login(fx.noMembership.email, fx.noMembership.password);
      expect(res.status).toBe(201);
      const cookie = sessionCookie(res);
      const me = await http.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.status).toBe(200);
      expect(me.body.memberships).toEqual([]);
      const tenantRoute = await http.get('/api/v1/admin/members').set('Cookie', cookie);
      expect(tenantRoute.status).toBe(403);
      expect(tenantRoute.body.error.code).toBe('AUTH_NO_ACTIVE_TENANT');
    });
  });

  // ---- RBAC ----------------------------------------------------------

  describe('RBAC', () => {
    const activeAdminCookie = async (): Promise<string> => {
      const res = await login(fx.admin.email, fx.admin.password);
      const cookie = sessionCookie(res);
      await http
        .post('/api/v1/auth/switch-tenant')
        .set('Cookie', cookie)
        .send({ membershipId: fx.admin.membershipId });
      return cookie;
    };

    it('TENANT_ADMIN (has the permission) → 200', async () => {
      const cookie = await activeAdminCookie();
      const res = await http.get('/api/v1/admin/roles').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.some((r: { key: string }) => r.key === 'TENANT_ADMIN')).toBe(true);
    });

    it('limited role can read memberships but not roles (403 AUTH_FORBIDDEN)', async () => {
      const res = await login(fx.limited.email, fx.limited.password);
      const cookie = sessionCookie(res); // single active membership -> auto tenant

      const ok = await http.get('/api/v1/admin/members').set('Cookie', cookie);
      expect(ok.status).toBe(200);

      const denied = await http.get('/api/v1/admin/roles').set('Cookie', cookie);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('AUTH_FORBIDDEN');
      expect(denied.body.error.details?.requiredPermission).toBe('roles.read');
    });

    it('unauthenticated → 401 (never 403) on a permission route', async () => {
      const res = await http.get('/api/v1/admin/roles');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_UNAUTHENTICATED');
    });

    it('a permission held in tenant A does not authorize in tenant B', async () => {
      // admin is TENANT_ADMIN in A, but only a role-less member of B
      const res = await login(fx.admin.email, fx.admin.password);
      const cookie = sessionCookie(res);
      await http
        .post('/api/v1/auth/switch-tenant')
        .set('Cookie', cookie)
        .send({ membershipId: fx.admin.membershipIdInB });

      const inB = await http.get('/api/v1/admin/roles').set('Cookie', cookie);
      expect(inB.status).toBe(403);
      expect(inB.body.error.code).toBe('AUTH_FORBIDDEN');

      const meInB = await http.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(meInB.body.active.permissions).toEqual([]);
    });

    it('the catalogue endpoint returns exactly the seeded permission keys', async () => {
      const cookie = await activeAdminCookie();
      const res = await http.get('/api/v1/admin/permissions').set('Cookie', cookie);
      expect(res.status).toBe(200);
      const { PERMISSION_KEYS } = await import('@aivoryx/shared');
      expect(res.body.map((p: { key: string }) => p.key).sort()).toEqual(
        [...PERMISSION_KEYS].sort(),
      );
    });
  });

  // ---- session security --------------------------------------------

  describe('session security', () => {
    it('deleting the active membership cascades the session — request then 401', async () => {
      const res = await login(fx.adminB.email, fx.adminB.password);
      const cookie = sessionCookie(res);
      expect((await http.get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(200);

      const pool = await rawPool();
      try {
        await pool.query('delete from user_tenant_memberships where id = $1', [
          fx.adminB.membershipId,
        ]);
      } finally {
        await pool.end();
      }

      const after = await http.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(after.status).toBe(401);
    });

    it('a Redis outage does not invalidate a valid PostgreSQL session', async () => {
      const res = await login(fx.limited.email, fx.limited.password);
      const cookie = sessionCookie(res);

      const redis = app.get<{ disconnect: () => void; status: string }>(
        (await import('../src/redis/redis.module.js')).REDIS_CLIENT,
      );
      redis.disconnect();

      const me = await http.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.status).toBe(200);
      const adminList = await http.get('/api/v1/admin/members').set('Cookie', cookie);
      expect(adminList.status).toBe(200);
    });
  });
});

/**
 * Login brute-force throttling. A separate app instance with the real login
 * rate limiter replaced (DI override, not an env hack) by a deliberately tiny
 * bucket, so this test proves the mechanism itself — independent of the
 * generous shared default (`support/env.ts`) every other spec relies on to
 * avoid tripping over its own repeated-login helpers.
 */
describe.skipIf(!INTEGRATION_ENABLED)('login brute-force throttling', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await makeFixtures();
    const { AUTH_LOGIN_RATE_LIMITER } = await import('../src/auth/auth.service.js');
    const { TokenBucketRateLimiter } = await import('../src/integrations/rate-limiter.js');
    app = await bootTestApp((builder) =>
      builder
        .overrideProvider(AUTH_LOGIN_RATE_LIMITER)
        .useValue(new TokenBucketRateLimiter({ capacity: 3, windowSeconds: 60 })),
    );
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  const login = (email: string, password: string) =>
    http.post('/api/v1/auth/login').send({ email, password });

  // Each test below uses its own distinct, never-reused email so one test's bucket
  // (capacity 3, shared process-wide for the life of this `app`) can never leak into
  // the next — a bucket emptied by an earlier test would silently make a later test's
  // assertions pass for the wrong reason instead of exercising what they claim to.
  const freshEmail = (tag: string) =>
    `throttle-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}@test.test`;

  it('allows up to the limit, then answers 429 RATE_LIMITED with a retry delay — for both wrong and right passwords', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await login(fx.admin.email, 'definitely-the-wrong-password');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    }
    // the bucket is now empty — even the CORRECT password is throttled, because the limiter
    // runs before credential verification (it protects the account, not just wrong guesses)
    const throttled = await login(fx.admin.email, fx.admin.password);
    expect(throttled.status).toBe(429);
    expect(throttled.body.error.code).toBe('RATE_LIMITED');
    expect(throttled.body.error.details?.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('is keyed per email — throttling one (nonexistent) account never blocks another', async () => {
    const target = freshEmail('keyed');
    for (let i = 0; i < 3; i++) {
      await login(target, 'wrong-password');
    }
    expect((await login(target, 'still-wrong')).status).toBe(429);
    // a real, different account's bucket is untouched
    const other = await login(fx.limited.email, fx.limited.password);
    expect(other.status).toBe(201);
  });

  it('throttles a nonexistent email identically — the limiter runs before any DB lookup', async () => {
    const target = freshEmail('unknown');
    for (let i = 0; i < 3; i++) {
      const res = await login(target, 'whatever');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    }
    const throttled = await login(target, 'whatever');
    expect(throttled.status).toBe(429);
    expect(throttled.body.error.code).toBe('RATE_LIMITED');
  });

  it('rejects a malformed email at validation, before it ever reaches the limiter', async () => {
    // not a real email at all — @IsEmail() on LoginRequestDto rejects it with 400
    // before the controller/service (and therefore the limiter) ever runs
    for (let i = 0; i < 5; i++) {
      const res = await login('not-an-email-at-all', 'whatever');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    // proof the limiter was never touched: a real, *valid* address that happens to
    // share a prefix gets the normal 3-attempt allowance, not an already-exhausted one
    const real = freshEmail('unaffected');
    for (let i = 0; i < 3; i++) {
      expect((await login(real, 'wrong-password')).status).toBe(401);
    }
    expect((await login(real, 'wrong-password')).status).toBe(429);
  });
});
