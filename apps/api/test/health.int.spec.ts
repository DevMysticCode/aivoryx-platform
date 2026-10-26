import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { bootTestApp } from './support/app.js';

/**
 * Health endpoints end to end (Production Monitoring and Alerting Readiness
 * milestone) — previously only unit-tested with every dependency mocked.
 * This is the first test that actually boots the real `AppModule` (real DI
 * graph, including `HealthModule`'s new import of `NotificationsModule` for
 * queue visibility) and hits the real routes.
 */
describe.skipIf(!INTEGRATION_ENABLED)('health endpoints', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    app = await bootTestApp();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  it('liveness never requires authentication and never checks a dependency', async () => {
    const res = await http.get('/api/v1/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(res.body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('readiness reports real database/redis checks and a real, non-gating queue diagnostic', async () => {
    const res = await http.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database.status).toBe('ok');
    expect(res.body.checks.redis.status).toBe('ok');
    expect(res.body.correlationId).toMatch(/^AIV-/);

    // the queue diagnostic is real (not a stub) — either real counts or an explicit
    // "disabled" state, never silently absent
    expect(['ok', 'disabled', 'error']).toContain(res.body.queue.status);
    if (res.body.queue.status === 'ok') {
      expect(res.body.queue.counts).toMatchObject({
        waiting: expect.any(Number),
        active: expect.any(Number),
        failed: expect.any(Number),
        delayed: expect.any(Number),
      });
    } else {
      expect(res.body.queue.counts).toBeNull();
    }
  });

  it('neither health route requires a session', async () => {
    const live = await http.get('/api/v1/health/live');
    const ready = await http.get('/api/v1/health');
    expect(live.status).toBe(200);
    expect(ready.status).toBe(200);
  });
});
