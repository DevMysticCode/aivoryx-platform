import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkDatabaseHealth = vi.fn();
vi.mock('@aivoryx/db', () => ({
  getDb: () => ({ db: {} }),
  checkDatabaseHealth: (...args: unknown[]) => checkDatabaseHealth(...args),
}));

const { HealthService } = await import('./health.service.js');

type FakeRedis = { ping: () => Promise<string> };
type FakeQueue = { getJobCounts: (...types: string[]) => Promise<Record<string, number>> };

function make(redis: FakeRedis | null, dbResult: unknown, queue: FakeQueue | null = null) {
  checkDatabaseHealth.mockResolvedValue(dbResult);
  return new HealthService(redis as unknown as never, queue as unknown as never);
}

describe('HealthService', () => {
  beforeEach(() => checkDatabaseHealth.mockReset());

  it('reports ok when database and redis are healthy', async () => {
    const svc = make(
      { ping: async () => 'PONG' },
      {
        status: 'ok',
        latencyMs: 3,
        checks: { connectivity: true, uuidv7: true },
      },
    );
    const report = await svc.readiness();
    expect(report.status).toBe('ok');
    expect(report.checks.database.status).toBe('ok');
    expect(report.checks.redis.status).toBe('ok');
    expect(report.correlationId).toBeTruthy();
  });

  it('reports error when the database check fails', async () => {
    const svc = make(
      { ping: async () => 'PONG' },
      {
        status: 'error',
        latencyMs: 1,
        checks: { connectivity: false, uuidv7: false },
        error: 'connection refused',
      },
    );
    const report = await svc.readiness();
    expect(report.status).toBe('error');
    expect(report.checks.database.detail).toContain('connection refused');
  });

  it('reports error when redis is not configured', async () => {
    const svc = make(null, {
      status: 'ok',
      latencyMs: 2,
      checks: { connectivity: true, uuidv7: true },
    });
    const report = await svc.readiness();
    expect(report.status).toBe('error');
    expect(report.checks.redis.detail).toContain('not configured');
  });

  it('liveness returns a non-negative uptime', () => {
    const svc = make({ ping: async () => 'PONG' }, { status: 'ok', latencyMs: 0, checks: {} });
    expect(svc.livenessUptimeSeconds()).toBeGreaterThanOrEqual(0);
  });

  const okDb = { status: 'ok', latencyMs: 1, checks: { connectivity: true, uuidv7: true } };

  it('reports queue status "disabled" (not "error") when no queue is configured, and this never flips overall status', async () => {
    const svc = make({ ping: async () => 'PONG' }, okDb, null);
    const report = await svc.readiness();
    expect(report.queue.status).toBe('disabled');
    expect(report.queue.counts).toBeNull();
    expect(report.status).toBe('ok');
  });

  it('reports real job counts when the queue is configured', async () => {
    const svc = make({ ping: async () => 'PONG' }, okDb, {
      getJobCounts: async () => ({ waiting: 3, active: 1, failed: 2, delayed: 0 }),
    });
    const report = await svc.readiness();
    expect(report.queue.status).toBe('ok');
    expect(report.queue.counts).toEqual({ waiting: 3, active: 1, failed: 2, delayed: 0 });
  });

  it('a queue count-fetch failure is reported as queue.status "error" but never flips the overall status', async () => {
    const svc = make({ ping: async () => 'PONG' }, okDb, {
      getJobCounts: async () => {
        throw new Error('ECONNRESET');
      },
    });
    const report = await svc.readiness();
    expect(report.queue.status).toBe('error');
    expect(report.queue.detail).toContain('ECONNRESET');
    // database + redis are healthy, so overall readiness is still ok — a queue hiccup
    // must never cause a healthy API process to be marked unready/restarted
    expect(report.status).toBe('ok');
  });
});
