import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkDatabaseHealth = vi.fn();
vi.mock('@aivoryx/db', () => ({
  getDb: () => ({ db: {} }),
  checkDatabaseHealth: (...args: unknown[]) => checkDatabaseHealth(...args),
}));

const { HealthService } = await import('./health.service.js');

type FakeRedis = { ping: () => Promise<string> };

function make(redis: FakeRedis | null, dbResult: unknown) {
  checkDatabaseHealth.mockResolvedValue(dbResult);
  return new HealthService(redis as unknown as never);
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
});
