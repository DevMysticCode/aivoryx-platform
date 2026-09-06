import type { schema } from '@aivoryx/db';

/**
 * The EPC-execution lifecycles (Phase 7, ADR 0036) — small, fixed transition
 * graphs enforced by pure functions, mirroring `crm/lead-lifecycle.ts`,
 * `field/visit-lifecycle.ts`, `supply/lifecycles.ts` and
 * `commercial/lifecycles.ts`. No workflow engine.
 *
 * The Phase 5 `project_status` enum is deliberately NOT extended here — the
 * detailed execution state lives in these workflow records + milestones.
 */

// ---- installation ---------------------------------------------------

export type InstallationStatus = schema.ProjectInstallationRow['status'];

const INSTALLATION_TRANSITIONS: Record<InstallationStatus, ReadonlySet<InstallationStatus>> = {
  UNASSIGNED: new Set(['ASSIGNED', 'CANCELLED']),
  ASSIGNED: new Set(['UNASSIGNED', 'IN_PROGRESS', 'CANCELLED']),
  IN_PROGRESS: new Set(['COMPLETED', 'CANCELLED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

export function isValidInstallationTransition(
  from: InstallationStatus,
  to: InstallationStatus,
): boolean {
  if (from === to) return false;
  return INSTALLATION_TRANSITIONS[from]!.has(to);
}

export function isTerminalInstallationStatus(status: InstallationStatus): boolean {
  return INSTALLATION_TRANSITIONS[status]!.size === 0;
}

/** Assignment / reassignment is only meaningful before on-site work starts. */
export function installationCanAssign(status: InstallationStatus): boolean {
  return status === 'UNASSIGNED' || status === 'ASSIGNED';
}

// ---- QC inspection ------------------------------------------------

export type QcInspectionStatus = schema.ProjectQcInspectionRow['status'];

const QC_TRANSITIONS: Record<QcInspectionStatus, ReadonlySet<QcInspectionStatus>> = {
  PENDING: new Set(['IN_PROGRESS', 'PASSED', 'FAILED']),
  IN_PROGRESS: new Set(['PASSED', 'FAILED']),
  PASSED: new Set(),
  FAILED: new Set(),
};

export function isValidQcTransition(from: QcInspectionStatus, to: QcInspectionStatus): boolean {
  if (from === to) return false;
  return QC_TRANSITIONS[from]!.has(to);
}

export function isTerminalQcStatus(status: QcInspectionStatus): boolean {
  return QC_TRANSITIONS[status]!.size === 0;
}

// ---- defect -----------------------------------------------------

export type DefectStatus = schema.ProjectDefectRow['status'];

const DEFECT_TRANSITIONS: Record<DefectStatus, ReadonlySet<DefectStatus>> = {
  OPEN: new Set(['IN_PROGRESS', 'RESOLVED']),
  IN_PROGRESS: new Set(['RESOLVED', 'OPEN']),
  RESOLVED: new Set(['VERIFIED', 'OPEN']),
  VERIFIED: new Set(),
};

export function isValidDefectTransition(from: DefectStatus, to: DefectStatus): boolean {
  if (from === to) return false;
  return DEFECT_TRANSITIONS[from]!.has(to);
}

/** A defect still blocks QC from passing until it is resolved or verified. */
export function defectIsBlocking(status: DefectStatus): boolean {
  return status === 'OPEN' || status === 'IN_PROGRESS';
}

// ---- net metering ---------------------------------------------

export type NetMeteringStatus = schema.ProjectNetMeteringRow['status'];

const NET_METERING_TRANSITIONS: Record<NetMeteringStatus, ReadonlySet<NetMeteringStatus>> = {
  NOT_STARTED: new Set(['DOCUMENTS_PENDING', 'SUBMITTED', 'COMPLETED']),
  DOCUMENTS_PENDING: new Set(['SUBMITTED', 'NOT_STARTED']),
  SUBMITTED: new Set(['UNDER_REVIEW', 'APPROVED', 'REJECTED']),
  UNDER_REVIEW: new Set(['APPROVED', 'REJECTED']),
  APPROVED: new Set(['COMPLETED']),
  REJECTED: new Set(['DOCUMENTS_PENDING', 'SUBMITTED']),
  COMPLETED: new Set(),
};

export function isValidNetMeteringTransition(
  from: NetMeteringStatus,
  to: NetMeteringStatus,
): boolean {
  if (from === to) return false;
  return NET_METERING_TRANSITIONS[from]!.has(to);
}

// ---- handover -------------------------------------------------

export type HandoverStatus = schema.ProjectHandoverRow['status'];

const HANDOVER_TRANSITIONS: Record<HandoverStatus, ReadonlySet<HandoverStatus>> = {
  PENDING: new Set(['READY', 'COMPLETED']),
  READY: new Set(['PENDING', 'COMPLETED']),
  COMPLETED: new Set(),
};

export function isValidHandoverTransition(from: HandoverStatus, to: HandoverStatus): boolean {
  if (from === to) return false;
  return HANDOVER_TRANSITIONS[from]!.has(to);
}
