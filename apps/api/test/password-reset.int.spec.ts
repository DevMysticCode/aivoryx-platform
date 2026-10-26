import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Self-service password reset (Production Operations & Customer Launch
 * Readiness milestone) — closes the previously-real account-recovery gap:
 * before this, nothing let a user who forgot their password back in.
 */
describe.skipIf(!INTEGRATION_ENABLED)('password reset', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;
  let fakeEmail: { sent: unknown[]; reset: () => void };

  beforeAll(async () => {
    fx = await makeFixtures();
    app = await bootTestApp();
    http = request(app.getHttpServer());
    const { FakeEmailProvider } = await import('../src/notifications/email/fake-email-provider.js');
    fakeEmail = app.get(FakeEmailProvider);
  });

  afterEach(() => fakeEmail.reset());

  afterAll(async () => {
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  const login = (email: string, password: string) =>
    http.post('/api/v1/auth/login').send({ email, password });
  const requestReset = (email: string) =>
    http.post('/api/v1/auth/password-reset/request').send({ email });
  const confirmReset = (token: string, newPassword: string) =>
    http.post('/api/v1/auth/password-reset/confirm').send({ token, newPassword });
  /** Pull the reset token out of the fake email's body. Asserted separately from the match itself,
   *  rather than via `?.[1]!`, to avoid a non-null assertion directly on an optional chain. */
  const extractResetToken = (text: string): string => {
    const match = /Reset code: ([A-Za-z0-9_-]+)/.exec(text);
    expect(match).toBeTruthy();
    return match![1]!;
  };

  it('requesting a reset for a real account sends exactly one email containing a token, never the password', async () => {
    const res = await requestReset(fx.limited.email);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(fakeEmail.sent).toHaveLength(1);
    const msg = fakeEmail.sent[0] as { to: string; text: string };
    expect(msg.to.toLowerCase()).toBe(fx.limited.email.toLowerCase());
    expect(msg.text).not.toContain(fx.limited.password);
    // a real-looking base64url token is present in the body
    expect(msg.text).toMatch(/[A-Za-z0-9_-]{32,}/);
  });

  it('requesting a reset for an unknown email returns the identical ok response and sends nothing', async () => {
    const res = await requestReset(`nonexistent-${Date.now()}@test.test`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fakeEmail.sent).toHaveLength(0);
  });

  it('completes a reset, logs in with the new password, and revokes the prior session', async () => {
    // obtain a session with the OLD password first, to prove it gets revoked
    const priorLogin = await login(fx.limited.email, fx.limited.password);
    expect(priorLogin.status).toBe(201);
    const priorCookie = sessionCookie(priorLogin);
    expect((await http.get('/api/v1/auth/me').set('Cookie', priorCookie)).status).toBe(200);

    await requestReset(fx.limited.email);
    const token = extractResetToken((fakeEmail.sent[0] as { text: string }).text);

    const newPassword = 'Brand-New-Passw0rd!';
    const confirm = await confirmReset(token, newPassword);
    expect(confirm.status).toBe(200);
    expect(confirm.body).toEqual({ ok: true });

    // the prior session is now rejected
    const afterReset = await http.get('/api/v1/auth/me').set('Cookie', priorCookie);
    expect(afterReset.status).toBe(401);
    expect(afterReset.body.error.code).toBe('AUTH_SESSION_REVOKED');

    // the OLD password no longer works; the NEW one does
    const oldLogin = await login(fx.limited.email, fx.limited.password);
    expect(oldLogin.status).toBe(401);
    const newLogin = await login(fx.limited.email, newPassword);
    expect(newLogin.status).toBe(201);

    // restore the fixture's original password so later tests/files relying on
    // `fx.limited.password` in the same run are unaffected
    await requestReset(fx.limited.email);
    const restoreToken = extractResetToken(
      (fakeEmail.sent[fakeEmail.sent.length - 1] as { text: string }).text,
    );
    await confirmReset(restoreToken, fx.limited.password);
  });

  it('a token is single-use — confirming twice fails the second time', async () => {
    await requestReset(fx.limited.email);
    const token = extractResetToken((fakeEmail.sent[0] as { text: string }).text);

    const first = await confirmReset(token, 'First-New-Passw0rd!');
    expect(first.status).toBe(200);

    const second = await confirmReset(token, 'Second-New-Passw0rd!');
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('PASSWORD_RESET_INVALID');

    // restore
    await requestReset(fx.limited.email);
    const restoreToken = extractResetToken(
      (fakeEmail.sent[fakeEmail.sent.length - 1] as { text: string }).text,
    );
    await confirmReset(restoreToken, fx.limited.password);
  });

  it('an unknown or malformed token is rejected with one generic code — no probing', async () => {
    const res = await confirmReset('not-a-real-token-at-all', 'Whatever-Passw0rd!');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PASSWORD_RESET_INVALID');
  });

  it('does not expose the reset token or any password in the HTTP response bodies', async () => {
    const res = await requestReset(fx.limited.email);
    expect(JSON.stringify(res.body)).toBe('{"ok":true}');

    const token = extractResetToken((fakeEmail.sent[0] as { text: string }).text);
    const confirm = await confirmReset(token, 'Yet-Another-Passw0rd!');
    expect(JSON.stringify(confirm.body)).toBe('{"ok":true}');

    // restore
    await requestReset(fx.limited.email);
    const restoreToken = extractResetToken(
      (fakeEmail.sent[fakeEmail.sent.length - 1] as { text: string }).text,
    );
    await confirmReset(restoreToken, fx.limited.password);
  });
});

/**
 * Rate limiting on the request endpoint — same DI-override pattern as
 * `auth.int.spec.ts`'s login-throttling tests, isolated from the shared
 * generous test default via a tiny, dedicated bucket on its own app instance.
 */
describe.skipIf(!INTEGRATION_ENABLED)('password reset — request throttling', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await makeFixtures();
    const { PASSWORD_RESET_RATE_LIMITER } = await import('../src/auth/password-reset.service.js');
    const { TokenBucketRateLimiter } = await import('../src/integrations/rate-limiter.js');
    app = await bootTestApp((builder) =>
      builder
        .overrideProvider(PASSWORD_RESET_RATE_LIMITER)
        .useValue(new TokenBucketRateLimiter({ capacity: 2, windowSeconds: 60 })),
    );
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  it('throttles repeated reset requests for the same email', async () => {
    const target = fx.limited.email;
    for (let i = 0; i < 2; i++) {
      expect(
        (await http.post('/api/v1/auth/password-reset/request').send({ email: target })).status,
      ).toBe(200);
    }
    const throttled = await http
      .post('/api/v1/auth/password-reset/request')
      .send({ email: target });
    expect(throttled.status).toBe(429);
    expect(throttled.body.error.code).toBe('RATE_LIMITED');
  });
});
