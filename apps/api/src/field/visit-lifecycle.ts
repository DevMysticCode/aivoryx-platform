import type { schema } from '@aivoryx/db';

/**
 * The deliberately small visit lifecycle (Phase 4, ADR 0033) — no general
 * workflow engine, a fixed transition graph mirroring `lead-lifecycle.ts`.
 *
 *   SCHEDULED -> ASSIGNED | CANCELLED
 *   ASSIGNED  -> IN_PROGRESS | CANCELLED
 *   IN_PROGRESS -> COMPLETED | CANCELLED
 *   COMPLETED -> (terminal)
 *   CANCELLED -> (terminal)
 *
 * `RESCHEDULED` is deliberately NOT a status: rescheduling updates
 * `scheduled_at` on a visit that stays `SCHEDULED`/`ASSIGNED` and is recorded
 * as a `rescheduled` visit activity instead.
 */
export type VisitStatus = schema.VisitRow['status'];

const TRANSITIONS: Record<VisitStatus, ReadonlySet<VisitStatus>> = {
  SCHEDULED: new Set(['ASSIGNED', 'CANCELLED']),
  ASSIGNED: new Set(['IN_PROGRESS', 'CANCELLED']),
  IN_PROGRESS: new Set(['COMPLETED', 'CANCELLED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

export function isValidVisitTransition(from: VisitStatus, to: VisitStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]!.has(to);
}

export function isTerminalVisitStatus(status: VisitStatus): boolean {
  return TRANSITIONS[status]!.size === 0;
}

/** Assignment/reassignment and rescheduling are only meaningful before the
 *  agent has started work on-site. */
export function canReassignOrReschedule(status: VisitStatus): boolean {
  return status === 'SCHEDULED' || status === 'ASSIGNED';
}
