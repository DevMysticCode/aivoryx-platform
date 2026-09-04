import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { checkDatabaseHealth, getDb } from '@aivoryx/db';
import { getCorrelationId } from '../observability/correlation.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';

export interface DependencyHealth {
  status: 'ok' | 'error';
  latencyMs: number;
  detail?: string | null;
}

export interface HealthReport {
  status: 'ok' | 'error';
  correlationId: string;
  checks: {
    database: DependencyHealth;
    redis: DependencyHealth;
  };
}

@Injectable()
export class HealthService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

  livenessUptimeSeconds(): number {
    return Math.round(process.uptime());
  }

  async readiness(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);
    const status = database.status === 'ok' && redis.status === 'ok' ? 'ok' : 'error';
    return {
      status,
      correlationId: getCorrelationId() ?? 'AIV-UNKNOWN',
      checks: { database, redis },
    };
  }

  private async checkDatabase(): Promise<DependencyHealth> {
    const result = await checkDatabaseHealth(getDb().db);
    return {
      status: result.status,
      latencyMs: result.latencyMs,
      detail:
        result.status === 'ok'
          ? `connectivity+uuidv7 ok`
          : (result.error ?? 'database check failed'),
    };
  }

  private async checkRedis(): Promise<DependencyHealth> {
    if (!this.redis) {
      return { status: 'error', latencyMs: 0, detail: 'redis client not configured' };
    }
    const startedAt = performance.now();
    try {
      const pong = await this.redis.ping();
      return {
        status: pong === 'PONG' ? 'ok' : 'error',
        latencyMs: Math.round(performance.now() - startedAt),
        detail: pong === 'PONG' ? null : `unexpected ping reply: ${pong}`,
      };
    } catch (err) {
      return {
        status: 'error',
        latencyMs: Math.round(performance.now() - startedAt),
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
