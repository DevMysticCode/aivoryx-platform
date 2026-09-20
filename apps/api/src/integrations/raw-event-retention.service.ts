import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { getDb, withRawEventPurgeContext } from '@aivoryx/db';
import type { ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';
import { startPoller } from '../notifications/drain-schedule.js';
import { isOpenApiGeneration } from '../runtime.js';

export interface PurgeResult {
  /** rows deleted in this run */
  deleted: number;
  /** batches executed */
  batches: number;
  /** true when the run stopped at `maxBatches` while more expired rows may remain */
  hasMore: boolean;
}

/**
 * Raw-event retention (UC-1). Deletes raw inbound payloads whose `expires_at` has passed.
 *
 *  - Bounded: each batch is its own short transaction of at most `batchSize` rows, and one run does
 *    at most `maxBatches` batches, so a backlog never holds a long lock or monopolises the pool.
 *  - Safe to repeat and to run concurrently: two instances targeting the same rows cannot
 *    double-delete them (the second DELETE waits for the first, then finds the rows gone and
 *    deletes nothing), and an already-deleted row is simply not selected. No explicit row lock is
 *    taken: `FOR UPDATE` would additionally require an UPDATE policy on raw_events, and the purge
 *    context deliberately grants only SELECT + DELETE.
 *  - Only expired rows: enforced twice — by the WHERE clause here and by the purge RLS policies
 *    (migration 0026), which grant nothing on a non-expired row.
 *  - Cascade: deleting a raw event removes its canonical event and stage log (existing FK cascade).
 *    CRM leads have no foreign key to them and are never touched — the raw ingestion record and the
 *    business entity have separate lifecycles. Consequence: after expiry the event's idempotency
 *    record is gone, so a provider re-sending an old record id is re-processed; lead-level dedupe
 *    (phone/email) still collapses it into the existing lead.
 *
 * Scheduled in-process (no separate worker), like the notification outbox poll.
 */
@Injectable()
export class RawEventRetentionService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RawEventRetentionService.name);
  private poller: ReturnType<typeof startPoller> | null = null;

  constructor(@Inject(SERVER_ENV) private readonly env: ServerEnv) {}

  onModuleInit(): void {
    if (!this.env.RAW_EVENT_PURGE_ENABLED || isOpenApiGeneration()) return;
    this.poller = startPoller(
      () => this.purgeExpired(),
      this.env.RAW_EVENT_PURGE_INTERVAL_MINUTES * 60_000,
      (err) =>
        this.logger.error(
          { module: 'integrations', operation: 'raw_event.purge', errorClass: errClass(err) },
          'raw event purge failed',
        ),
    );
    this.logger.log(
      `raw event purge scheduled (every ${this.env.RAW_EVENT_PURGE_INTERVAL_MINUTES}m, batch ${this.env.RAW_EVENT_PURGE_BATCH_SIZE}, retention ${this.env.RAW_EVENT_RETENTION_DAYS}d)`,
    );
  }

  onApplicationShutdown(): void {
    this.poller?.stop();
    this.poller = null;
  }

  async purgeExpired(
    options: { batchSize?: number; maxBatches?: number } = {},
  ): Promise<PurgeResult> {
    const batchSize = options.batchSize ?? this.env.RAW_EVENT_PURGE_BATCH_SIZE;
    const maxBatches = options.maxBatches ?? 20;
    const startedAt = Date.now();
    let deleted = 0;
    let batches = 0;
    let hasMore = false;

    while (batches < maxBatches) {
      const n = await this.purgeBatch(batchSize);
      batches += 1;
      deleted += n;
      if (n < batchSize) break;
      if (batches === maxBatches) hasMore = true;
    }

    if (deleted > 0) {
      this.logger.log(
        {
          module: 'integrations',
          operation: 'raw_event.purge',
          status: 'ok',
          deleted,
          batches,
          hasMore,
          durationMs: Date.now() - startedAt,
        },
        'expired raw events purged',
      );
    }
    return { deleted, batches, hasMore };
  }

  private async purgeBatch(batchSize: number): Promise<number> {
    return withRawEventPurgeContext(getDb(), async (tx) => {
      const result = await tx.execute(sql`
        delete from raw_events
        where id in (
          select id from raw_events
          where expires_at < now()
          order by expires_at
          limit ${batchSize}
        )
      `);
      return result.rowCount ?? 0;
    });
  }
}

function errClass(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}
