import type { HandoverStatus, InstallationStatus, QcInspectionStatus } from './lifecycles.js';

/**
 * Project-completion invariants (Phase 7, ADR 0036 §15). The server — never the
 * UI — decides whether a project may be completed, and returns a specific list
 * of what is missing.
 */

export interface CompletionState {
  installationStatus: InstallationStatus | null;
  /** the status of the most recent QC inspection, if any */
  latestQcStatus: QcInspectionStatus | null;
  netMeteringDone: boolean; // status COMPLETED
  netMeteringNotRequired: boolean;
  handoverStatus: HandoverStatus | null;
  /** defects still OPEN or IN_PROGRESS */
  openDefects: number;
}

export interface CompletionResult {
  ok: boolean;
  missing: string[];
}

export function checkProjectCompletion(state: CompletionState): CompletionResult {
  const missing: string[] = [];

  if (state.installationStatus !== 'COMPLETED') {
    missing.push('Installation not completed');
  }
  if (state.latestQcStatus !== 'PASSED') {
    missing.push('QC not passed');
  }
  if (!state.netMeteringNotRequired && !state.netMeteringDone) {
    missing.push('Net metering not completed');
  }
  if (state.handoverStatus !== 'COMPLETED') {
    missing.push('Handover not completed');
  }
  if (state.openDefects > 0) {
    missing.push(`${state.openDefects} unresolved defect${state.openDefects === 1 ? '' : 's'}`);
  }

  return { ok: missing.length === 0, missing };
}
