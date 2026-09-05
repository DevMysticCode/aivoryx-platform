import type { schema } from '@aivoryx/db';

/**
 * The three deliberately small operational lifecycles (Phase 5, ADR 0034).
 * Fixed, documented transition graphs — pure functions, mirroring
 * `crm/lead-lifecycle.ts` and `field/visit-lifecycle.ts`. No workflow engine.
 */

// ---- projects --------------------------------------------------------

export type ProjectStatus = schema.ProjectRow['status'];

const PROJECT_TRANSITIONS: Record<ProjectStatus, ReadonlySet<ProjectStatus>> = {
  DRAFT: new Set(['APPROVED', 'CANCELLED']),
  APPROVED: new Set(['PROCUREMENT', 'READY_FOR_DISPATCH', 'ON_HOLD', 'CANCELLED']),
  PROCUREMENT: new Set(['READY_FOR_DISPATCH', 'ON_HOLD', 'CANCELLED']),
  READY_FOR_DISPATCH: new Set(['IN_PROGRESS', 'ON_HOLD', 'CANCELLED']),
  IN_PROGRESS: new Set(['COMPLETED', 'ON_HOLD', 'CANCELLED']),
  ON_HOLD: new Set(['APPROVED', 'PROCUREMENT', 'READY_FOR_DISPATCH', 'IN_PROGRESS', 'CANCELLED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

export function isValidProjectTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  if (from === to) return false;
  return PROJECT_TRANSITIONS[from]!.has(to);
}

export function isTerminalProjectStatus(status: ProjectStatus): boolean {
  return PROJECT_TRANSITIONS[status]!.size === 0;
}

// ---- purchase orders ----------------------------------------------

export type PurchaseOrderStatus = schema.PurchaseOrderRow['status'];

const PO_TRANSITIONS: Record<PurchaseOrderStatus, ReadonlySet<PurchaseOrderStatus>> = {
  DRAFT: new Set(['SUBMITTED', 'CANCELLED']),
  SUBMITTED: new Set(['APPROVED', 'DRAFT', 'CANCELLED']),
  APPROVED: new Set(['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']),
  PARTIALLY_RECEIVED: new Set(['RECEIVED', 'CLOSED']),
  RECEIVED: new Set(['CLOSED']),
  CLOSED: new Set(),
  CANCELLED: new Set(),
};

export function isValidPoTransition(from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean {
  if (from === to) return false;
  return PO_TRANSITIONS[from]!.has(to);
}

export function isTerminalPoStatus(status: PurchaseOrderStatus): boolean {
  return PO_TRANSITIONS[status]!.size === 0;
}

/** A PO can be edited (lines added/changed) only while still a draft. */
export function poIsEditable(status: PurchaseOrderStatus): boolean {
  return status === 'DRAFT';
}

/** Goods can be received only against an approved / partially-received PO. */
export function poCanReceive(status: PurchaseOrderStatus): boolean {
  return status === 'APPROVED' || status === 'PARTIALLY_RECEIVED';
}

// ---- dispatches -------------------------------------------------

export type DispatchStatus = schema.DispatchRow['status'];

const DISPATCH_TRANSITIONS: Record<DispatchStatus, ReadonlySet<DispatchStatus>> = {
  DRAFT: new Set(['DISPATCHED', 'CANCELLED']),
  DISPATCHED: new Set(['DELIVERED']),
  DELIVERED: new Set(),
  CANCELLED: new Set(),
};

export function isValidDispatchTransition(from: DispatchStatus, to: DispatchStatus): boolean {
  if (from === to) return false;
  return DISPATCH_TRANSITIONS[from]!.has(to);
}

export function isTerminalDispatchStatus(status: DispatchStatus): boolean {
  return DISPATCH_TRANSITIONS[status]!.size === 0;
}

/** A dispatch's lines can be edited only while it is still a draft. */
export function dispatchIsEditable(status: DispatchStatus): boolean {
  return status === 'DRAFT';
}
