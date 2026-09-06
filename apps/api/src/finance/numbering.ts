import { eq, and, sql } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';

const { financeCounters } = schema;

/**
 * Generic tenant-scoped numbering (Phase 9, ADR 0038). One `finance_counters`
 * row per (tenant, kind); the next number is `${prefix}${value padded to
 * `padding`}`. The increment is a single atomic statement
 * (`update ... set value = value + 1 returning value`), executed inside the
 * caller's transaction, so concurrent creates in the same tenant never produce
 * a duplicate human number. Deliberately NOT a numbering-rule engine —
 * `prefix` / `padding` are configurable per tenant/kind and that is enough.
 */

export type CounterKind = 'invoice' | 'payment' | 'credit_note';

const DEFAULTS: Record<CounterKind, { prefix: string; padding: number }> = {
  invoice: { prefix: 'INV-', padding: 6 },
  payment: { prefix: 'PMT-', padding: 6 },
  credit_note: { prefix: 'CN-', padding: 6 },
};

export function formatNumber(prefix: string, padding: number, value: number | bigint): string {
  return `${prefix}${String(value).padStart(padding, '0')}`;
}

/** Reserve and return the next number for `(tenant, kind)`. Must run inside a
 *  tenant-context transaction. */
export async function nextNumber(tx: Tx, tenantId: string, kind: CounterKind): Promise<string> {
  const d = DEFAULTS[kind];
  // ensure the row exists (idempotent), then atomically bump it
  await tx
    .insert(financeCounters)
    .values({ tenantId, kind, prefix: d.prefix, padding: d.padding, value: 0 })
    .onConflictDoNothing({ target: [financeCounters.tenantId, financeCounters.kind] });

  const [row] = await tx
    .update(financeCounters)
    .set({ value: sql`${financeCounters.value} + 1`, updatedAt: new Date() })
    .where(and(eq(financeCounters.tenantId, tenantId), eq(financeCounters.kind, kind)))
    .returning({
      prefix: financeCounters.prefix,
      padding: financeCounters.padding,
      value: financeCounters.value,
    });
  if (!row) throw new Error(`finance counter missing for ${kind}`);
  return formatNumber(row.prefix, row.padding, row.value);
}
