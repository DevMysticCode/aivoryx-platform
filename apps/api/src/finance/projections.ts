import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';
import { dec, formatDec, invoiceOutstanding, parseDec, paymentUnallocated } from './money.js';
import { derivedInvoiceStatus, type InvoiceStatus } from './lifecycles.js';

const { invoices, payments, paymentAllocations, creditNotes } = schema;

/**
 * Transactional projections (Phase 9, ADR 0038). The authoritative records are
 * `payment_allocations` (active) and `credit_notes` (issued). These helpers
 * recompute the denormalised `invoices.amount_paid` / `amount_credited` /
 * `status` and `payments.allocated_amount` from those rows inside the caller's
 * transaction, after locking the target row `FOR UPDATE`. Never call them
 * outside a write path, and always after mutating an allocation or a credit
 * note. `invoices.amount_paid + amount_credited <= grand_total` is also a DB
 * CHECK, so a projection bug fails loud rather than silently going negative.
 */

export interface InvoiceMoney {
  grandTotal: string;
  amountPaid: string;
  amountCredited: string;
  outstanding: string;
  status: InvoiceStatus;
}

/** Lock + recompute one invoice's paid/credited/status. Returns the fresh money. */
export async function recalcInvoice(
  tx: Tx,
  tenantId: string,
  invoiceId: string,
): Promise<InvoiceMoney> {
  const [inv] = await tx
    .select({ grandTotal: invoices.grandTotal, status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
    .for('update')
    .limit(1);
  if (!inv) throw new Error(`invoice ${invoiceId} not found for projection`);

  const [paidRow] = await tx
    .select({ total: sql<string>`coalesce(sum(${paymentAllocations.amount}), 0)::text` })
    .from(paymentAllocations)
    .where(
      and(
        eq(paymentAllocations.tenantId, tenantId),
        eq(paymentAllocations.invoiceId, invoiceId),
        isNull(paymentAllocations.reversedAt),
      ),
    );
  const [creditRow] = await tx
    .select({ total: sql<string>`coalesce(sum(${creditNotes.amount}), 0)::text` })
    .from(creditNotes)
    .where(
      and(
        eq(creditNotes.tenantId, tenantId),
        eq(creditNotes.invoiceId, invoiceId),
        eq(creditNotes.status, 'ISSUED'),
      ),
    );

  const amountPaid = round2(paidRow?.total ?? '0');
  const amountCredited = round2(creditRow?.total ?? '0');
  const outstanding = invoiceOutstanding(inv.grandTotal, amountPaid, amountCredited);

  let status: InvoiceStatus = inv.status;
  if (status === 'ISSUED' || status === 'PARTIALLY_PAID' || status === 'PAID') {
    status = derivedInvoiceStatus(inv.grandTotal, amountPaid, amountCredited, dec.cmp, outstanding);
  }

  await tx
    .update(invoices)
    .set({ amountPaid, amountCredited, status, updatedAt: new Date() })
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));

  return { grandTotal: inv.grandTotal, amountPaid, amountCredited, outstanding, status };
}

/** Lock + recompute one payment's allocated amount from its active allocations. */
export async function recalcPayment(
  tx: Tx,
  tenantId: string,
  paymentId: string,
): Promise<{ amount: string; allocated: string; unallocated: string }> {
  const [pay] = await tx
    .select({ amount: payments.amount })
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.id, paymentId)))
    .for('update')
    .limit(1);
  if (!pay) throw new Error(`payment ${paymentId} not found for projection`);

  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${paymentAllocations.amount}), 0)::text` })
    .from(paymentAllocations)
    .where(
      and(
        eq(paymentAllocations.tenantId, tenantId),
        eq(paymentAllocations.paymentId, paymentId),
        isNull(paymentAllocations.reversedAt),
      ),
    );
  const allocated = round2(row?.total ?? '0');
  await tx
    .update(payments)
    .set({ allocatedAmount: allocated, updatedAt: new Date() })
    .where(and(eq(payments.tenantId, tenantId), eq(payments.id, paymentId)));

  return {
    amount: pay.amount,
    allocated,
    unallocated: paymentUnallocated(pay.amount, allocated),
  };
}

/** Normalise a NUMERIC-text value to a fixed-point 2dp money string. */
function round2(value: string): string {
  return formatDec(parseDec(value), 2);
}
