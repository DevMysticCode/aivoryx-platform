import { Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb, schema, withOutboxDispatcherContext } from '@aivoryx/db';
import { NotificationEngineService } from './notification-engine.service.js';

const { outboxEvents } = schema;

/**
 * Drains the existing transactional `outbox_events` table into the notification
 * engine (ADR 0037). This is the notification engine's outbox consumer — NOT a
 * second event bus.
 *
 * Worker DB security: the drain runs as the non-privileged `aivoryx_app` role
 * with `app.outbox_dispatcher='on'` (migration 0010), which grants ONLY a
 * cross-tenant SELECT of undelivered rows + the `dispatched_at` UPDATE on this
 * one table. All engine work then happens under `app.tenant_id` taken from the
 * committed event row — never from a client. Reprocessing is safe: the engine's
 * upserts are idempotent, so an event that fails mid-handling is simply retried
 * on the next poll.
 *
 * The notification engine is currently the sole outbox consumer, so it owns
 * `dispatched_at`. When a general integration dispatcher is built it will need a
 * per-consumer offset; adding that now would be speculative.
 */
@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger('OutboxDispatcher');

  constructor(private readonly engine: NotificationEngineService) {}

  async drain(limit = 50): Promise<number> {
    const events = await withOutboxDispatcherContext(getDb(), (tx) =>
      tx
        .select({
          id: outboxEvents.id,
          type: outboxEvents.type,
          tenantId: outboxEvents.tenantId,
          payload: outboxEvents.payload,
          actorMembershipId: outboxEvents.actorMembershipId,
        })
        .from(outboxEvents)
        .where(isNull(outboxEvents.dispatchedAt))
        .orderBy(asc(outboxEvents.occurredAt))
        .limit(limit),
    );

    let processed = 0;
    for (const event of events) {
      try {
        await this.engine.handleEvent({
          id: event.id,
          type: event.type,
          tenantId: event.tenantId,
          payload: (event.payload ?? {}) as Record<string, unknown>,
          actorMembershipId: event.actorMembershipId,
        });
      } catch (err) {
        // leave the row undispatched; the next poll retries (idempotent engine)
        this.logger.error(
          `notification handling failed for event ${event.id} (${event.type}): ${String(err)}`,
        );
        continue;
      }
      await withOutboxDispatcherContext(getDb(), (tx) =>
        tx
          .update(outboxEvents)
          .set({ dispatchedAt: new Date() })
          .where(and(eq(outboxEvents.id, event.id), isNull(outboxEvents.dispatchedAt))),
      );
      processed += 1;
    }
    return processed;
  }
}
