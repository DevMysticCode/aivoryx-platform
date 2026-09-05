import type { schema } from '@aivoryx/db';

/**
 * The deliberately small lead lifecycle (ADR 0031, phase brief §2). Not a
 * general workflow engine — a fixed, documented transition graph.
 *
 *   NEW -> ASSIGNED | CONTACTED | QUALIFIED | DISQUALIFIED
 *   ASSIGNED -> CONTACTED | QUALIFIED | DISQUALIFIED
 *   CONTACTED -> QUALIFIED | DISQUALIFIED
 *   QUALIFIED -> CONVERTED | DISQUALIFIED
 *   DISQUALIFIED -> (terminal)
 *   CONVERTED -> (terminal)
 *
 * QUALIFIED/DISQUALIFIED are reachable from any non-terminal status (a
 * telecaller may qualify or disqualify as soon as they've spoken to the
 * lead, without a separate "mark contacted" step first) — everything else is
 * strict to prevent nonsense like re-opening a CONVERTED or DISQUALIFIED lead.
 */
export type LeadStatus = schema.LeadRow['status'];

const TRANSITIONS: Record<LeadStatus, ReadonlySet<LeadStatus>> = {
  NEW: new Set(['ASSIGNED', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED']),
  ASSIGNED: new Set(['CONTACTED', 'QUALIFIED', 'DISQUALIFIED']),
  CONTACTED: new Set(['QUALIFIED', 'DISQUALIFIED']),
  QUALIFIED: new Set(['CONVERTED', 'DISQUALIFIED']),
  DISQUALIFIED: new Set(),
  CONVERTED: new Set(),
};

export function isValidLeadTransition(from: LeadStatus, to: LeadStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from]!.has(to);
}

export function isTerminalLeadStatus(status: LeadStatus): boolean {
  return TRANSITIONS[status]!.size === 0;
}
