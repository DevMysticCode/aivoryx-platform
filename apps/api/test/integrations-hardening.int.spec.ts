import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import {
  startConnectorHarness,
  WEBHOOK_ROUTES,
  type ConnectorHarness,
} from './support/connector.js';
import {
  TokenBucketRateLimiter,
  WEBHOOK_RATE_LIMITER,
  type RateLimiter,
} from '../src/integrations/rate-limiter.js';
import { RawEventRetentionService } from '../src/integrations/raw-event-retention.service.js';

/**
 * Universal Connector UC-1 — webhook hardening: body limit, rate limit, raw-event lifecycle,
 * failure handling, retention/purge, permissions and log hygiene. Built on the UC-0 harness; all
 * assertions go through HTTP or SQL on the physical tables.
 */

// configuration under test (read when the app boots, so set before the harness starts)
const BODY_LIMIT = 2048;
process.env.WEBHOOK_MAX_BODY_BYTES = String(BODY_LIMIT);
process.env.RAW_EVENT_RETENTION_DAYS = '7';
process.env.LOG_LEVEL = 'info';

describe.skipIf(!INTEGRATION_ENABLED)('inbound connector — hardening (UC-1)', () => {
  const route = WEBHOOK_ROUTES[0];
  let h: ConnectorHarness;

  // The limiter is swapped per test through this indirection (DI override of an interface).
  let activeLimiter: RateLimiter = new TokenBucketRateLimiter({
    capacity: 10_000,
    windowSeconds: 60,
  });
  const stdout: string[] = [];
  let stdoutSpy: { mockRestore(): void } | undefined;

  beforeAll(async () => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      stdout.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    h = await startConnectorHarness((b) =>
      b
        .overrideProvider(WEBHOOK_RATE_LIMITER)
        .useValue({ consume: (k: string) => activeLimiter.consume(k) }),
    );
  });
  afterAll(async () => {
    await h?.sql('drop trigger if exists uc1_fail_lead_insert on leads');
    await h?.sql('drop function if exists uc1_fail_lead_insert()');
    await h?.close();
    stdoutSpy?.mockRestore();
  });

  const phone = () => `7${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const setup = async (label: string) => {
    const cookie = await h.adminCookie();
    return { cookie, ...(await h.createSource(cookie, h.uniqueKey(label))) };
  };
  const n = async (table: string, sourceId: string) =>
    Number(
      (
        await h.sql<{ n: string }>(`select count(*) n from ${table} where source_id = $1`, [
          sourceId,
        ])
      )[0]!.n,
    );
  const outbox = async (sourceId: string) =>
    (await h.sql("select 1 from outbox_events where payload->>'sourceId' = $1", [sourceId])).length;
  const rawStatuses = async (sourceId: string) =>
    (
      await h.sql<{ status: string }>(
        'select status from raw_events where source_id = $1 order by created_at',
        [sourceId],
      )
    ).map((r) => r.status);

  /** JSON body of exactly `bytes` bytes carrying a valid phone number */
  const bodyOfSize = (bytes: number) => {
    const head = `{"phone":"${phone()}","pad":"`;
    const tail = '"}';
    return head + 'x'.repeat(bytes - head.length - tail.length) + tail;
  };
  const postRaw = (key: string, secret: string | null, body: string) => {
    const req = h.http.post(route.path(key)).set('Content-Type', 'application/json');
    if (secret) req.set('Authorization', `Bearer ${secret}`);
    return req.send(body);
  };

  // ============================ 1. body size limit ============================

  describe('body size limit', () => {
    it('accepts a body below the limit', async () => {
      const { key, secret } = await setup('body-below');
      const res = await postRaw(key, secret, bodyOfSize(BODY_LIMIT - 500));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('DONE');
    });

    it('accepts a body of EXACTLY the limit and rejects one byte more', async () => {
      const { key, secret, sourceId } = await setup('body-edge');
      const exact = bodyOfSize(BODY_LIMIT);
      expect(Buffer.byteLength(exact)).toBe(BODY_LIMIT);
      expect((await postRaw(key, secret, exact)).status).toBe(200);

      const over = bodyOfSize(BODY_LIMIT + 1);
      expect(Buffer.byteLength(over)).toBe(BODY_LIMIT + 1);
      const res = await postRaw(key, secret, over);
      expect(res.status).toBe(413);
      expect(await n('raw_events', sourceId)).toBe(1); // only the accepted one
    });

    it('an oversized request creates nothing: no raw event, canonical event, lead or outbox work', async () => {
      const { key, secret, sourceId } = await setup('body-over');
      const res = await postRaw(key, secret, bodyOfSize(BODY_LIMIT * 20));
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(Object.keys(res.body.error).sort()).toEqual(['code', 'correlationId', 'message']);
      expect(JSON.stringify(res.body)).not.toContain('xxxx'); // the body is never echoed back
      expect(await n('raw_events', sourceId)).toBe(0);
      expect(await n('canonical_lead_events', sourceId)).toBe(0);
      expect(await n('leads', sourceId)).toBe(0);
      expect(await outbox(sourceId)).toBe(0);
    });

    it('an oversized body is rejected before credentials are even checked (nothing is parsed for strangers)', async () => {
      const res = await postRaw('no-such-source', 'not-a-secret', bodyOfSize(BODY_LIMIT * 5));
      expect(res.status).toBe(413);
    });

    it('applies to the webhook only: other routes keep the framework default', async () => {
      // 50 KB > the 2 KB webhook limit but < the 100 KB default -> validation error, NOT 413
      const res = await h.http
        .post('/api/v1/auth/login')
        .send({ email: 'a@b.test', password: 'x', pad: 'y'.repeat(50_000) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // ============================== 2. rate limiting ==============================

  describe('rate limiting', () => {
    const clock = () => {
      let t = 5_000_000;
      return { now: () => t, advance: (ms: number) => void (t += ms) };
    };
    const useLimiter = (capacity: number, windowSeconds = 60) => {
      const c = clock();
      activeLimiter = new TokenBucketRateLimiter({ capacity, windowSeconds, now: c.now });
      return c;
    };
    const restore = () => {
      activeLimiter = new TokenBucketRateLimiter({ capacity: 10_000, windowSeconds: 60 });
    };

    it('allows up to the limit, then answers 429 RATE_LIMITED with Retry-After; nothing is ingested', async () => {
      useLimiter(3);
      try {
        const { key, secret, sourceId } = await setup('rl-basic');
        for (let i = 0; i < 3; i++) {
          expect((await h.webhook(route, key, secret, { phone: phone() })).status).toBe(200);
        }
        const rawBefore = await n('raw_events', sourceId);
        const res = await h.webhook(route, key, secret, { phone: phone() });
        expect(res.status).toBe(429);
        expect(res.body.error.code).toBe('RATE_LIMITED');
        expect(Object.keys(res.body.error).sort()).toEqual([
          'code',
          'correlationId',
          'details',
          'message',
        ]);
        expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(res.body.error.details.retryAfterSeconds).toBe(Number(res.headers['retry-after']));
        expect(JSON.stringify(res.body)).not.toContain(secret);
        // rejected: no raw event, canonical event, lead or outbox row for it
        expect(await n('raw_events', sourceId)).toBe(rawBefore);
        expect(await n('canonical_lead_events', sourceId)).toBe(3);
        expect(await n('leads', sourceId)).toBe(3);
        expect(await outbox(sourceId)).toBe(3);
      } finally {
        restore();
      }
    });

    it('separate sources do not share a bucket', async () => {
      useLimiter(1);
      try {
        const a = await setup('rl-a');
        const b = await setup('rl-b');
        expect((await h.webhook(route, a.key, a.secret, { phone: phone() })).status).toBe(200);
        expect((await h.webhook(route, a.key, a.secret, { phone: phone() })).status).toBe(429);
        expect((await h.webhook(route, b.key, b.secret, { phone: phone() })).status).toBe(200);
      } finally {
        restore();
      }
    });

    it('traffic resumes once the window has elapsed', async () => {
      const c = useLimiter(2, 20); // one token per 10s
      try {
        const { key, secret } = await setup('rl-resume');
        await h.webhook(route, key, secret, { phone: phone() });
        await h.webhook(route, key, secret, { phone: phone() });
        expect((await h.webhook(route, key, secret, { phone: phone() })).status).toBe(429);
        c.advance(10_000);
        expect((await h.webhook(route, key, secret, { phone: phone() })).status).toBe(200);
      } finally {
        restore();
      }
    });

    it('unauthenticated / wrong-secret traffic cannot drain a real source’s bucket', async () => {
      useLimiter(2);
      try {
        const { key, secret } = await setup('rl-strangers');
        for (let i = 0; i < 10; i++) {
          expect((await h.webhook(route, key, 'guessed-secret', { phone: phone() })).status).toBe(
            401,
          );
        }
        expect((await h.webhook(route, key, secret, { phone: phone() })).status).toBe(200);
        expect((await h.webhook(route, key, secret, { phone: phone() })).status).toBe(200);
      } finally {
        restore();
      }
    });

    it('does not interfere with unrelated authenticated API routes', async () => {
      useLimiter(1);
      try {
        const { key, secret, cookie } = await setup('rl-unrelated');
        await h.webhook(route, key, secret, { phone: phone() });
        expect((await h.webhook(route, key, secret, { phone: phone() })).status).toBe(429);
        expect(
          (await h.http.get('/api/v1/admin/integrations/sources').set('Cookie', cookie)).status,
        ).toBe(200);
        expect((await h.http.get('/api/v1/auth/me').set('Cookie', cookie)).status).toBe(200);
      } finally {
        restore();
      }
    });
  });

  // ============== 1b + 2b. universal route: same hardening, same shared behavior ==============
  // UC-3 security review follow-up: the body-size limit and rate limiter above were only ever
  // exercised against the Pabbly alias. Both are enforced by shared code (the body-parser mount in
  // configure-app.ts is a path PREFIX covering every route under /integrations/webhooks; `run()`'s
  // rate-limit check is the same call site for every route) -- this proves it, rather than relying
  // on "the code path is shared" as an assumption. No second limiter, no duplicated middleware: this
  // only adds coverage of the universal route using the EXACT SAME WEBHOOK_RATE_LIMITER override and
  // WEBHOOK_MAX_BODY_BYTES config as the Pabbly-alias tests above.

  describe('universal route — body size limit (same shared limit as the Pabbly alias)', () => {
    const universalRoute = WEBHOOK_ROUTES[1]!;
    const postViaUniversal = (key: string, secret: string | null, body: string) => {
      const req = h.http.post(universalRoute.path(key)).set('Content-Type', 'application/json');
      if (secret) req.set('Authorization', `Bearer ${secret}`);
      return req.send(body);
    };

    it('rejects a body over WEBHOOK_MAX_BODY_BYTES with 413, same as the Pabbly alias', async () => {
      const { key, secret, sourceId } = await setup('universal-body-over');
      const res = await postViaUniversal(key, secret, bodyOfSize(BODY_LIMIT * 20));
      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(await n('raw_events', sourceId)).toBe(0);
      expect(await n('canonical_lead_events', sourceId)).toBe(0);
      expect(await n('leads', sourceId)).toBe(0);
    });

    it('accepts a body at or below the limit via the universal route', async () => {
      const { key, secret } = await setup('universal-body-ok');
      const res = await postViaUniversal(key, secret, bodyOfSize(BODY_LIMIT));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('DONE');
    });
  });

  describe('universal route — rate limiting (same source-scoped limiter as the Pabbly alias)', () => {
    const universalRoute = WEBHOOK_ROUTES[1]!;
    const useLimiter = (capacity: number, windowSeconds = 60) => {
      activeLimiter = new TokenBucketRateLimiter({ capacity, windowSeconds });
    };
    const restore = () => {
      activeLimiter = new TokenBucketRateLimiter({ capacity: 10_000, windowSeconds: 60 });
    };

    it('enforces the limit and sends Retry-After via the universal route too', async () => {
      useLimiter(2);
      try {
        const { key, secret, sourceId } = await setup('universal-rl-basic');
        expect((await h.webhook(universalRoute, key, secret, { phone: phone() })).status).toBe(200);
        expect((await h.webhook(universalRoute, key, secret, { phone: phone() })).status).toBe(200);
        const res = await h.webhook(universalRoute, key, secret, { phone: phone() });
        expect(res.status).toBe(429);
        expect(res.body.error.code).toBe('RATE_LIMITED');
        expect(Number(res.headers['retry-after'])).toBeGreaterThanOrEqual(1);
        expect(await n('raw_events', sourceId)).toBe(2); // the 3rd (limited) request created nothing
      } finally {
        restore();
      }
    });

    it('is source-scoped: a source hit via the universal route and the SAME source hit via the Pabbly alias share one bucket (one connector, one secret, one source — not two)', async () => {
      useLimiter(1);
      try {
        const { key, secret } = await setup('universal-rl-shared-source');
        expect((await h.webhook(universalRoute, key, secret, { phone: phone() })).status).toBe(200);
        // same source, same secret, via the OTHER route -- the bucket key is `source:<id>`, not
        // route-specific, so this must already be limited
        expect((await h.webhook(route, key, secret, { phone: phone() })).status).toBe(429);
      } finally {
        restore();
      }
    });

    it('does not regress the Pabbly alias: a limit on one source does not affect a different one reached via the universal route', async () => {
      useLimiter(1);
      try {
        const pabblySource = await setup('universal-rl-isolation-pabbly');
        const universalSource = await setup('universal-rl-isolation-universal');
        expect(
          (await h.webhook(route, pabblySource.key, pabblySource.secret, { phone: phone() }))
            .status,
        ).toBe(200);
        expect(
          (await h.webhook(route, pabblySource.key, pabblySource.secret, { phone: phone() }))
            .status,
        ).toBe(429);
        expect(
          (
            await h.webhook(universalRoute, universalSource.key, universalSource.secret, {
              phone: phone(),
            })
          ).status,
        ).toBe(200);
      } finally {
        restore();
      }
    });
  });

  // ====================== 3 + 4. raw-event lifecycle and failures ======================

  describe('raw event lifecycle', () => {
    it('DONE -> PROCESSED; validation failure -> FAILED; duplicate event delivery -> PROCESSED', async () => {
      const { key, secret, sourceId } = await setup('life');
      await h.webhook(route, key, secret, { id: 'L-1', phone: phone() });
      await h.webhook(route, key, secret, { full_name: 'no identity' });
      await h.webhook(route, key, secret, { id: 'L-1', phone: phone(), name: 'changed' }); // DUPLICATE_EVENT
      expect(await rawStatuses(sourceId)).toEqual(['PROCESSED', 'FAILED', 'PROCESSED']);
    });

    it('an exact redelivery (DUPLICATE_RAW) leaves the original raw event untouched', async () => {
      const { key, secret, sourceId } = await setup('life-dup');
      const body = { id: 'L-2', phone: phone() };
      await h.webhook(route, key, secret, body);
      await h.webhook(route, key, secret, body);
      expect(await rawStatuses(sourceId)).toEqual(['PROCESSED']);
    });

    it('a business failure that stays broken remains FAILED after replay; nothing new is created', async () => {
      const { key, secret, sourceId, cookie } = await setup('life-replay');
      const res = await h.webhook(route, key, secret, { name: 'nobody' });
      const replay = await h.http
        .post(`/api/v1/admin/integrations/events/${res.body.canonicalEventId}/replay`)
        .set('Cookie', cookie);
      expect(replay.status).toBe(200);
      expect(replay.body.status).toBe('VALIDATION_FAILED');
      expect(await rawStatuses(sourceId)).toEqual(['FAILED']);
      expect(await n('leads', sourceId)).toBe(0);
    });
  });

  describe('unexpected processing failure', () => {
    const injectFailure = () =>
      h.sql(`
        create or replace function uc1_fail_lead_insert() returns trigger language plpgsql as $f$
        begin
          if new.name like 'BOOM-%' then raise exception 'uc1 injected failure'; end if;
          return new;
        end $f$;
        drop trigger if exists uc1_fail_lead_insert on leads;
        create trigger uc1_fail_lead_insert before insert on leads
          for each row execute function uc1_fail_lead_insert();
      `);
    const clearFailure = () => h.sql('drop trigger if exists uc1_fail_lead_insert on leads');

    it('records FAILED (never success), keeps diagnostics, creates no lead, and answers a generic 500', async () => {
      const { key, secret, sourceId } = await setup('fail');
      await injectFailure();
      try {
        const res = await h.webhook(route, key, secret, {
          id: 'F-1',
          name: 'BOOM-secret-lead-name',
          phone: phone(),
        });
        expect(res.status).toBe(500);
        expect(res.body.error.code).toBe('INTERNAL_ERROR');
        expect(res.body.error.correlationId).toMatch(/^AIV-/);
        expect(JSON.stringify(res.body)).not.toMatch(/injected|BOOM|trigger/i);

        expect(await rawStatuses(sourceId)).toEqual(['FAILED']);
        const [c] = await h.sql<Record<string, unknown>>(
          'select status, last_error_code, processing_attempts, idempotency_key, lead_id from canonical_lead_events where source_id = $1',
          [sourceId],
        );
        expect(c).toMatchObject({
          status: 'FAILED',
          last_error_code: 'PROCESSING_ERROR',
          processing_attempts: 0,
          idempotency_key: 'record:F-1',
          lead_id: null,
        });
        expect(await n('leads', sourceId)).toBe(0);
        expect(await outbox(sourceId)).toBe(0);

        // correlation id preserved for diagnosis: the stage log carries the raw event's id
        const [raw] = await h.sql<{ id: string; correlation_id: string }>(
          'select id, correlation_id from raw_events where source_id = $1',
          [sourceId],
        );
        const log = await h.sql<{
          to_status: string;
          error_code: string | null;
          correlation_id: string;
        }>(
          'select to_status, error_code, correlation_id from integration_event_log where raw_event_id = $1 order by created_at, id',
          [raw!.id],
        );
        expect(log[log.length - 1]).toMatchObject({
          to_status: 'FAILED',
          error_code: 'PROCESSING_ERROR',
          correlation_id: raw!.correlation_id,
        });
      } finally {
        await clearFailure();
      }
    });

    it('a provider retry of the same delivery finishes the job: one lead, attempts counted, no duplicate', async () => {
      const { key, secret, sourceId } = await setup('retry');
      const body = { id: 'F-2', name: 'BOOM-retry', phone: phone() };
      await injectFailure();
      try {
        expect((await h.webhook(route, key, secret, body)).status).toBe(500);
      } finally {
        await clearFailure();
      }
      // the same body again (what a retrying provider sends) — now the fault is gone
      const retried = await h.webhook(route, key, secret, body);
      expect(retried.status).toBe(200);
      expect(retried.body).toMatchObject({ accepted: true, status: 'DONE', dedupeOutcome: 'new' });

      expect(await n('leads', sourceId)).toBe(1);
      expect(await n('raw_events', sourceId)).toBe(1); // no second raw event
      expect(await n('canonical_lead_events', sourceId)).toBe(1);
      expect(await rawStatuses(sourceId)).toEqual(['PROCESSED']);
      const [c] = await h.sql<Record<string, unknown>>(
        'select status, processing_attempts from canonical_lead_events where source_id = $1',
        [sourceId],
      );
      expect(c).toMatchObject({ status: 'DONE', processing_attempts: 1 });
      expect(await outbox(sourceId)).toBe(1);

      // and once it is DONE, further redeliveries are ordinary duplicates
      const again = await h.webhook(route, key, secret, body);
      expect(again.body.status).toBe('DUPLICATE_RAW');
      expect(await n('leads', sourceId)).toBe(1);
    });

    it('admin replay after an unexpected failure works; a failing replay leaves FAILED (not stuck PROCESSING)', async () => {
      const { key, secret, sourceId, cookie } = await setup('replay-fail');
      await injectFailure();
      let canonicalId: string;
      try {
        expect(
          (await h.webhook(route, key, secret, { id: 'F-3', name: 'BOOM-replay', phone: phone() }))
            .status,
        ).toBe(500);
        const found = await h.sql<{ id: string }>(
          'select id from canonical_lead_events where source_id = $1',
          [sourceId],
        );
        canonicalId = found[0]!.id;

        // replay while the fault persists: still FAILED, attempts bumped, and replayable again
        const failing = await h.http
          .post(`/api/v1/admin/integrations/events/${canonicalId}/replay`)
          .set('Cookie', cookie);
        expect(failing.status).toBe(500);
        const [mid] = await h.sql<Record<string, unknown>>(
          'select status, processing_attempts from canonical_lead_events where id = $1',
          [canonicalId],
        );
        expect(mid).toMatchObject({ status: 'FAILED', processing_attempts: 1 });
      } finally {
        await clearFailure();
      }
      const ok = await h.http
        .post(`/api/v1/admin/integrations/events/${canonicalId}/replay`)
        .set('Cookie', cookie);
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe('DONE');
      expect(await n('leads', sourceId)).toBe(1);
      expect(await rawStatuses(sourceId)).toEqual(['PROCESSED']);
      const [end] = await h.sql<Record<string, unknown>>(
        'select status, processing_attempts from canonical_lead_events where id = $1',
        [canonicalId],
      );
      expect(end).toMatchObject({ status: 'DONE', processing_attempts: 2 });
    });

    it('logs only safe diagnostics for a failure: no payload, no secret, no error text', async () => {
      const { key, secret } = await setup('fail-logs');
      await injectFailure();
      const errors = vi.spyOn(Logger.prototype, 'error');
      try {
        await h.webhook(route, key, secret, {
          id: 'F-4',
          name: 'BOOM-logline',
          phone: '7000000123',
        });
        const logged = JSON.stringify(errors.mock.calls);
        expect(logged).toContain('webhook processing failed unexpectedly');
        expect(logged).toContain('PROCESSING_ERROR');
        expect(logged).not.toMatch(/BOOM|7000000123|injected|Bearer/);
        expect(logged).not.toContain(secret);
      } finally {
        errors.mockRestore();
        await clearFailure();
      }
    });
  });

  // ================================ 5 + 6. retention ================================

  describe('retention', () => {
    it('sets expires_at from the configured retention on success AND failure events', async () => {
      const { key, secret, sourceId } = await setup('ret-set');
      await h.webhook(route, key, secret, { phone: phone() });
      await h.webhook(route, key, secret, { name: 'no identity' });
      const rows = await h.sql<{ ok: boolean }>(
        `select (expires_at between received_at + interval '7 days' - interval '1 minute'
                             and received_at + interval '7 days' + interval '1 minute') as ok
           from raw_events where source_id = $1`,
        [sourceId],
      );
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.ok)).toBe(true);
    });

    it('never retains the connector secret or Authorization header in the stored event', async () => {
      const { key, secret, sourceId } = await setup('ret-secret');
      await h.webhook(route, key, secret, { phone: phone() });
      const rows = await h.sql('select * from raw_events where source_id = $1', [sourceId]);
      expect(JSON.stringify(rows)).not.toContain(secret);
    });

    describe('purge', () => {
      const purger = () => h.app.get(RawEventRetentionService);
      const expire = (sourceId: string, count?: number) =>
        h.sql(
          `update raw_events set expires_at = now() - interval '1 hour'
            where id in (select id from raw_events where source_id = $1 order by created_at ${count ? `limit ${count}` : ''})`,
          [sourceId],
        );

      it('deletes expired events (and their canonical event + stage log) but keeps non-expired ones and every lead', async () => {
        const { key, secret, sourceId } = await setup('purge');
        const results = [];
        for (let i = 0; i < 4; i++)
          results.push(await h.webhook(route, key, secret, { phone: phone() }));
        await expire(sourceId, 3);

        const r = await purger().purgeExpired();
        expect(r.deleted).toBeGreaterThanOrEqual(3);

        expect(await n('raw_events', sourceId)).toBe(1);
        expect(await n('canonical_lead_events', sourceId)).toBe(1);
        const logs = await h.sql(
          'select 1 from integration_event_log where raw_event_id = any($1)',
          [results.map((x) => x.body.rawEventId)],
        );
        expect(logs.length).toBeGreaterThan(0); // the surviving event's trace remains
        expect(logs.length).toBeLessThanOrEqual(3);
        // business data is independent of the raw record's lifecycle
        expect(await n('leads', sourceId)).toBe(4);
      });

      it('is bounded and batched: at most maxBatches x batchSize rows per run, reporting hasMore', async () => {
        const { key, secret, sourceId } = await setup('purge-batch');
        for (let i = 0; i < 5; i++) await h.webhook(route, key, secret, { phone: phone() });
        await expire(sourceId);

        const first = await purger().purgeExpired({ batchSize: 2, maxBatches: 2 });
        expect(first).toMatchObject({ batches: 2, hasMore: true });
        expect(first.deleted).toBeGreaterThanOrEqual(4); // other specs' expired rows may also be swept
        const remaining = await n('raw_events', sourceId);
        expect(remaining).toBeLessThanOrEqual(1);

        // drain the rest; repeated runs are safe and eventually find nothing
        let guard = 0;
        while ((await purger().purgeExpired({ batchSize: 50 })).deleted > 0 && guard++ < 10);
        expect(await n('raw_events', sourceId)).toBe(0);
        const idle = await purger().purgeExpired();
        expect(idle).toMatchObject({ deleted: 0, hasMore: false });
      });

      it('tolerates already-purged rows and concurrent runs', async () => {
        const { key, secret, sourceId } = await setup('purge-concurrent');
        for (let i = 0; i < 6; i++) await h.webhook(route, key, secret, { phone: phone() });
        await expire(sourceId);
        const runs = await Promise.all(
          [1, 2, 3].map(() => purger().purgeExpired({ batchSize: 2 })),
        );
        expect(runs.every((r) => r.deleted >= 0)).toBe(true);
        expect(await n('raw_events', sourceId)).toBe(0);
        expect((await purger().purgeExpired()).deleted).toBe(0);
      });

      it('purges across tenants, and only what has expired', async () => {
        const a = await setup('purge-ta');
        const bCookie = await h.adminBCookie();
        const b = await h.createSource(bCookie, h.uniqueKey('purge-tb'));
        await h.webhook(route, a.key, a.secret, { phone: phone() });
        await h.webhook(route, b.key, b.secret, { phone: phone() });
        await expire(b.sourceId); // only tenant B's is expired
        await purger().purgeExpired();
        expect(await n('raw_events', a.sourceId)).toBe(1);
        expect(await n('raw_events', b.sourceId)).toBe(0);
      });

      it('the database itself refuses to purge a non-expired row, even through the purge context', async () => {
        const { key, secret, sourceId } = await setup('purge-guard');
        await h.webhook(route, key, secret, { phone: phone() });
        const db = await import('@aivoryx/db');
        const { sql } = await import('drizzle-orm');
        await db.withRawEventPurgeContext(db.getDb(), async (tx) => {
          await tx.execute(sql`delete from raw_events`); // deliberately unqualified
        });
        expect(await n('raw_events', sourceId)).toBe(1);
      });

      it('without the purge context the application role cannot delete expired rows of any tenant', async () => {
        const { key, secret, sourceId } = await setup('purge-noctx');
        await h.webhook(route, key, secret, { phone: phone() });
        await expire(sourceId);
        const db = await import('@aivoryx/db');
        const { sql } = await import('drizzle-orm');
        await db.getDb().db.transaction(async (tx) => {
          await tx.execute(sql`delete from raw_events`);
        });
        expect(await n('raw_events', sourceId)).toBe(1);
      });
    });
  });

  // ============================== 7. permissions ==============================

  describe('permissions: crm.integrations.manage is the single capability', () => {
    const login = async (email: string, password: string) => {
      const res = await h.login(email, password);
      const raw = res.headers['set-cookie'] as unknown as string[];
      return raw[0]!.split(';')[0]!;
    };

    it('memberships.read alone does NOT grant connector management', async () => {
      const cookie = await login(h.fx.limited.email, h.fx.limited.password);
      const calls = [
        h.http.get('/api/v1/admin/integrations/sources').set('Cookie', cookie),
        h.http.get('/api/v1/admin/integrations/events').set('Cookie', cookie),
        h.http
          .post('/api/v1/admin/integrations/sources')
          .set('Cookie', cookie)
          .send({ key: 'k', name: 'n' }),
        h.http
          .post(`/api/v1/admin/integrations/sources/${randomUUID()}/rotate-secret`)
          .set('Cookie', cookie),
        h.http
          .post(`/api/v1/admin/integrations/events/${randomUUID()}/replay`)
          .set('Cookie', cookie),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
      }
    });

    it('a member holding ONLY crm.integrations.manage (no memberships.read) can manage connectors', async () => {
      const roleId = randomUUID();
      await h.sql('insert into roles (id, tenant_id, key, name) values ($1,$2,$3,$4)', [
        roleId,
        h.fx.tenantA,
        'INTEGRATIONS_ONLY',
        'Integrations only',
      ]);
      const [perm] = await h.sql<{ id: string }>(
        "select id from permissions where key = 'crm.integrations.manage'",
      );
      await h.sql(
        'insert into role_permissions (role_id, tenant_id, permission_id) values ($1,$2,$3)',
        [roleId, h.fx.tenantA, perm!.id],
      );
      await h.sql(
        'insert into membership_roles (membership_id, role_id, tenant_id) values ($1,$2,$3)',
        [h.fx.plainMember.membershipId, roleId, h.fx.tenantA],
      );
      const cookie = await login(h.fx.plainMember.email, h.fx.plainMember.password);
      expect(
        (await h.http.get('/api/v1/admin/integrations/sources').set('Cookie', cookie)).status,
      ).toBe(200);
      expect((await h.http.get('/api/v1/admin/members').set('Cookie', cookie)).status).toBe(403); // no memberships.read
    });

    it('the tenant admin keeps access, and tenant isolation still holds', async () => {
      const cookie = await h.adminCookie();
      expect(
        (await h.http.get('/api/v1/admin/integrations/sources').set('Cookie', cookie)).status,
      ).toBe(200);
      const own = await h.createSource(cookie, h.uniqueKey('perm-own'));
      const bCookie = await h.adminBCookie();
      const listB = await h.http.get('/api/v1/admin/integrations/sources').set('Cookie', bCookie);
      expect(listB.body.some((s: { id: string }) => s.id === own.sourceId)).toBe(false);
    });
  });

  // ============================ 8 + 9. logging / observability ============================

  describe('logging and observability', () => {
    it('emits one structured, secret-free line per delivery with ids, status and duration', async () => {
      const { key, secret, sourceId } = await setup('obs');
      const log = vi.spyOn(Logger.prototype, 'log');
      const marker = `PAYLOADMARK${Date.now()}`;
      try {
        const res = await h.webhook(route, key, secret, {
          id: 'O-1',
          full_name: marker,
          phone: phone(),
        });
        const lines = log.mock.calls.filter(
          (c) =>
            typeof c[0] === 'object' &&
            (c[0] as { operation?: string }).operation === 'webhook.ingest',
        );
        expect(lines).toHaveLength(1);
        expect(lines[0]![0]).toMatchObject({
          module: 'integrations',
          sourceId,
          tenantId: h.fx.tenantA,
          rawEventId: res.body.rawEventId,
          canonicalEventId: res.body.canonicalEventId,
          status: 'DONE',
        });
        const entry = lines[0]![0] as { correlationId: string; durationMs: number };
        expect(entry.correlationId).toMatch(/^AIV-/);
        expect(typeof entry.durationMs).toBe('number');
        const all = JSON.stringify(log.mock.calls);
        expect(all).not.toContain(secret);
        expect(all).not.toContain(marker);
        expect(all).not.toMatch(/bearer/i);
      } finally {
        log.mockRestore();
      }
    });

    it('a rejected delivery is logged with its error code and no credential', async () => {
      const { key } = await setup('obs-rej');
      const warn = vi.spyOn(Logger.prototype, 'warn');
      try {
        await h.webhook(route, key, 'wrong-secret-value', { phone: phone() });
        const entry = warn.mock.calls
          .map((c) => c[0])
          .find((c) => (c as { operation?: string })?.operation === 'webhook.ingest') as
          | { status: string; errorCode: string }
          | undefined;
        expect(entry).toMatchObject({ status: 'REJECTED', errorCode: 'CONNECTOR_INVALID' });
        expect(JSON.stringify(warn.mock.calls)).not.toContain('wrong-secret-value');
      } finally {
        warn.mockRestore();
      }
    });

    it('the HTTP request log never contains the bearer secret, the Authorization header or the payload', async () => {
      const { key, secret } = await setup('obs-http');
      const marker = `HTTPMARK${Date.now()}`;
      stdout.length = 0;
      await h.webhook(route, key, secret, { full_name: marker, phone: phone() });
      const out = stdout.join('');
      expect(out).toContain('request completed'); // logging is actually on, so the checks below mean something
      expect(out).not.toContain(secret);
      expect(out).not.toContain(marker);
      expect(out.toLowerCase()).not.toContain('authorization');
    });
  });
});
