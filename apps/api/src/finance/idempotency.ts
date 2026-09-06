import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';

const { financeIdempotency } = schema;

/**
 * Explicit request idempotency for mutating finance operations (Phase 9,
 * ADR 0038). The client supplies an `Idempotency-Key`; the first request for
 * `(tenant, key)` runs `work()` and records the resulting entity id; a retry
 * with the same key returns the recorded id without acting again. A key reused
 * for a *different* operation is rejected (`FINANCE_IDEMPOTENCY_MISMATCH`).
 * Not a timestamp-based scheme.
 *
 * Callers pass the whole thing inside their own tenant-context transaction, so
 * the idempotency row and the entity commit together.
 */
export async function withIdempotency<T extends { id: string }>(
  tx: Tx,
  tenantId: string,
  key: string | undefined,
  operation: string,
  work: () => Promise<T>,
  load: (id: string) => Promise<T>,
): Promise<T> {
  if (!key) return work();

  const [claimed] = await tx
    .insert(financeIdempotency)
    .values({ tenantId, key, operation })
    .onConflictDoNothing({ target: [financeIdempotency.tenantId, financeIdempotency.key] })
    .returning({ id: financeIdempotency.id });

  if (!claimed) {
    const [existing] = await tx
      .select({ operation: financeIdempotency.operation, resultRef: financeIdempotency.resultRef })
      .from(financeIdempotency)
      .where(and(eq(financeIdempotency.tenantId, tenantId), eq(financeIdempotency.key, key)))
      .limit(1);
    if (existing && existing.operation !== operation) {
      throw new AppError('FINANCE_IDEMPOTENCY_MISMATCH', { details: { key, operation } });
    }
    if (existing?.resultRef) return load(existing.resultRef);
    // rare: the first request is still in flight / crashed before stamping the
    // result. Re-run the work (operations are written to be safe to retry).
    return work();
  }

  const result = await work();
  await tx
    .update(financeIdempotency)
    .set({ resultRef: result.id })
    .where(and(eq(financeIdempotency.tenantId, tenantId), eq(financeIdempotency.key, key)));
  return result;
}
