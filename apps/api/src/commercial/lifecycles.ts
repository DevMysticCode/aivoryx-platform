import type { schema } from '@aivoryx/db';

/**
 * The quotation commercial lifecycle (Phase 6, ADR 0035) — a deliberately
 * small, fixed transition graph enforced by a pure function, mirroring
 * `crm/lead-lifecycle.ts` and `supply/lifecycles.ts`. No workflow engine.
 *
 *   DRAFT → SENT → ACCEPTED → BOOKED
 *   DRAFT → CANCELLED
 *   SENT  → CANCELLED
 *   SENT  → EXPIRED
 *
 * `revise` is not a status transition (a revised quotation returns to DRAFT
 * with a fresh revision) — it is gated by `quotationCanRevise`.
 */

export type QuotationStatus = schema.QuotationRow['status'];
export type QuotationRevisionStatus = schema.QuotationRevisionRow['status'];

const QUOTATION_TRANSITIONS: Record<QuotationStatus, ReadonlySet<QuotationStatus>> = {
  DRAFT: new Set(['SENT', 'CANCELLED']),
  SENT: new Set(['ACCEPTED', 'CANCELLED', 'EXPIRED']),
  ACCEPTED: new Set(['BOOKED']),
  BOOKED: new Set(),
  CANCELLED: new Set(),
  EXPIRED: new Set(),
};

export function isValidQuotationTransition(from: QuotationStatus, to: QuotationStatus): boolean {
  if (from === to) return false;
  return QUOTATION_TRANSITIONS[from]!.has(to);
}

export function isTerminalQuotationStatus(status: QuotationStatus): boolean {
  return QUOTATION_TRANSITIONS[status]!.size === 0;
}

/** The header + lines of the current revision are editable only while the
 *  quotation is still a draft. */
export function quotationIsEditable(status: QuotationStatus): boolean {
  return status === 'DRAFT';
}

/** A new revision may be created while the quotation is still commercially
 *  open — i.e. a draft or a sent-but-not-yet-accepted quotation. */
export function quotationCanRevise(status: QuotationStatus): boolean {
  return status === 'DRAFT' || status === 'SENT';
}

/** Booking is only possible from an accepted quotation. */
export function quotationCanBook(status: QuotationStatus): boolean {
  return status === 'ACCEPTED';
}
