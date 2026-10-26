import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Queue } from 'bullmq';
import { checkDatabaseHealth, getDb } from '@aivoryx/db';
import { getCorrelationId } from '../observability/correlation.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.queue.js';

export interface DependencyHealth {
  status: 'ok' | 'error';
  latencyMs: number;
  detail?: string | null;
}

export interface QueueHealth {
  /** 'disabled' is a normal, intentional state (NOTIFICATIONS_ENABLED=false) — never a failure. */
  status: 'ok' | 'error' | 'disabled';
  latencyMs: number;
  counts: { waiting: number; active: number; failed: number; delayed: number } | null;
  detail?: string | null;
}

export interface HealthReport {
  status: 'ok' | 'error';
  correlationId: string;
  checks: {
    database: DependencyHealth;
    redis: DependencyHealth;
  };
  /**
   * Informational only — deliberately NOT part of `status`. A backlog or a transient
   * count-fetch failure here does not mean the API can't serve traffic (the overwhelming
   * majority of requests never touch the notification queue), so it must never cause a
   * healthy process to be restarted. See `INCIDENT-RUNBOOKS.md` §5 for how to read it.
   */
  queue: QueueHealth;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    @Inject(NOTIFICATIONS_QUEUE) private readonly notificationsQueue: Queue | null,
  ) {}

  livenessUptimeSeconds(): number {
    return Math.round(process.uptime());
  }

  async readiness(): Promise<HealthReport> {
    const [database, redis, queue] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkQueue(),
    ]);
    const status = database.status === 'ok' && redis.status === 'ok' ? 'ok' : 'error';
    return {
      status,
      correlationId: getCorrelationId() ?? 'AIV-UNKNOWN',
      checks: { database, redis },
      queue,
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

  /**
   * Job counts only — no job data, no tenant/customer identifiers, nothing
   * high-cardinality. `disabled` (NOTIFICATIONS_ENABLED=false, or no Redis) is
   * reported distinctly from `error` (counts should have been available and
   * weren't) so an operator never confuses an intentional config with a fault.
   */
  private async checkQueue(): Promise<QueueHealth> {
    if (!this.notificationsQueue) {
      return { status: 'disabled', latencyMs: 0, counts: null, detail: 'notifications disabled' };
    }
    const startedAt = performance.now();
    try {
      const counts = await this.notificationsQueue.getJobCounts(
        'waiting',
        'active',
        'failed',
        'delayed',
      );
      return {
        status: 'ok',
        latencyMs: Math.round(performance.now() - startedAt),
        counts: {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          failed: counts.failed ?? 0,
          delayed: counts.delayed ?? 0,
        },
        detail: null,
      };
    } catch (err) {
      return {
        status: 'error',
        latencyMs: Math.round(performance.now() - startedAt),
        counts: null,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
