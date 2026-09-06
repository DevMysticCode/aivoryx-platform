import type { schema } from '@aivoryx/db';

/**
 * Finance lifecycle graphs (Phase 9, ADR 0038) — small, fixed transition sets
 * enforced by pure functions, mirroring `commercial/lifecycles.ts` and
 * `execution/lifecycles.ts`. No workflow engine.
 *
 * Invoice:      DRAFT → ISSUED → PARTIALLY_PAID ⇄ PAID
 *               DRAFT → CANCELLED
 *               ISSUED / PARTIALLY_PAID → CANCELLED   (only with no active allocations)
 *               ISSUED / PARTIALLY_PAID / PAID → VOID (accounting-style reversal)
 *   PARTIALLY_PAID / PAID are DERIVED from allocations — the service moves the
 *   invoice between them transactionally; they are not user-driven transitions.
 *
 * Payment:      RECORDED → REVERSED
 *               RECORDED → CANCELLED
 *
 * Credit note:  DRAFT → ISSUED
 *               DRAFT → CANCELLED
 *               ISSUED → CANCELLED
 *
 * "Overdue" is NOT a status — it is derived (see `overdue.ts`).
 */

export type InvoiceStatus = schema.InvoiceRow['status'];
export type PaymentStatus = schema.PaymentRow['status'];
export type CreditNoteStatus = schema.CreditNoteRow['status'];

const INVOICE_TRANSITIONS: Record<InvoiceStatus, ReadonlySet<InvoiceStatus>> = {
  DRAFT: new Set(['ISSUED', 'CANCELLED']),
  ISSUED: new Set(['PARTIALLY_PAID', 'PAID', 'CANCELLED', 'VOID']),
  PARTIALLY_PAID: new Set(['ISSUED', 'PAID', 'CANCELLED', 'VOID']),
  PAID: new Set(['PARTIALLY_PAID', 'VOID']),
  CANCELLED: new Set(),
  VOID: new Set(),
};

export function isValidInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return false;
  return INVOICE_TRANSITIONS[from]!.has(to);
}

export function isTerminalInvoiceStatus(status: InvoiceStatus): boolean {
  return INVOICE_TRANSITIONS[status]!.size === 0;
}

/** Header + lines are editable only while the invoice is a draft. */
export function invoiceIsEditable(status: InvoiceStatus): boolean {
  return status === 'DRAFT';
}

/** A financial snapshot (lines/totals/customer/currency/issue date) is frozen
 *  once the invoice leaves DRAFT. */
export function invoiceIsImmutable(status: InvoiceStatus): boolean {
  return status !== 'DRAFT';
}

/** Payments can be allocated only to an issued, not-yet-fully-paid invoice. */
export function invoiceAcceptsAllocation(status: InvoiceStatus): boolean {
  return status === 'ISSUED' || status === 'PARTIALLY_PAID';
}

/**
 * The status an ISSUED/PARTIALLY_PAID/PAID invoice should hold given its money
 * position. Pure: takes 2dp money strings, returns the target status.
 *
 *   outstanding <= 0 and grand_total > 0  → PAID
 *   0 < outstanding < grand_total          → PARTIALLY_PAID
 *   outstanding == grand_total (nothing paid/credited) → ISSUED
 */
export function derivedInvoiceStatus(
  grandTotal: string,
  amountPaid: string,
  amountCredited: string,
  cmp: (a: string, b: string) => -1 | 0 | 1,
  outstanding: string,
): 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' {
  const covered = cmp(outstanding, '0') <= 0;
  if (covered && cmp(grandTotal, '0') > 0) return 'PAID';
  const settled = cmp(amountPaid, '0') <= 0 && cmp(amountCredited, '0') <= 0;
  return settled ? 'ISSUED' : 'PARTIALLY_PAID';
}

const PAYMENT_TRANSITIONS: Record<PaymentStatus, ReadonlySet<PaymentStatus>> = {
  RECORDED: new Set(['REVERSED', 'CANCELLED']),
  REVERSED: new Set(),
  CANCELLED: new Set(),
};

export function isValidPaymentTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return false;
  return PAYMENT_TRANSITIONS[from]!.has(to);
}

export function paymentIsActive(status: PaymentStatus): boolean {
  return status === 'RECORDED';
}

const CREDIT_NOTE_TRANSITIONS: Record<CreditNoteStatus, ReadonlySet<CreditNoteStatus>> = {
  DRAFT: new Set(['ISSUED', 'CANCELLED']),
  ISSUED: new Set(['CANCELLED']),
  CANCELLED: new Set(),
};

export function isValidCreditNoteTransition(from: CreditNoteStatus, to: CreditNoteStatus): boolean {
  if (from === to) return false;
  return CREDIT_NOTE_TRANSITIONS[from]!.has(to);
}

export function creditNoteIsEditable(status: CreditNoteStatus): boolean {
  return status === 'DRAFT';
}

/** An issued credit note reduces the invoice receivable; a draft one does not. */
export function creditNoteIsEffective(status: CreditNoteStatus): boolean {
  return status === 'ISSUED';
}
