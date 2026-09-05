import { Injectable } from '@nestjs/common';
import { schema, type Tx } from '@aivoryx/db';
import { getCorrelationId } from '../observability/correlation.js';

const { outboxEvents } = schema;

/**
 * Transactional outbox writer (ADR 0013). Events are written in the **same
 * transaction** as the state change that produced them, so state and events
 * never diverge across a crash. A future dispatcher (Integration Engine) reads
 * undelivered rows and marks them `dispatched_at`. There is no second event
 * mechanism.
 */
@Injectable()
export class OutboxService {
  /**
   * Append an event within an existing transaction. The caller must already be
   * in a tenant-context transaction (`withTenantContext`) so RLS `WITH CHECK`
   * passes for `tenant_id`.
   */
  async emit(
    tx: Tx,
    event: { tenantId: string; type: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await tx.insert(outboxEvents).values({
      tenantId: event.tenantId,
      type: event.type,
      payload: event.payload,
      correlationId: getCorrelationId() ?? null,
    });
  }
}
