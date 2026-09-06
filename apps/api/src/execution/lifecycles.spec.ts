import { describe, expect, it } from 'vitest';
import {
  defectIsBlocking,
  installationCanAssign,
  isTerminalInstallationStatus,
  isTerminalQcStatus,
  isValidDefectTransition,
  isValidHandoverTransition,
  isValidInstallationTransition,
  isValidNetMeteringTransition,
  isValidQcTransition,
} from './lifecycles.js';

describe('installation lifecycle', () => {
  it('follows UNASSIGNED -> ASSIGNED -> IN_PROGRESS -> COMPLETED', () => {
    expect(isValidInstallationTransition('UNASSIGNED', 'ASSIGNED')).toBe(true);
    expect(isValidInstallationTransition('ASSIGNED', 'IN_PROGRESS')).toBe(true);
    expect(isValidInstallationTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(isValidInstallationTransition('ASSIGNED', 'UNASSIGNED')).toBe(true); // unassign
  });
  it('rejects skipping and terminal exits', () => {
    expect(isValidInstallationTransition('UNASSIGNED', 'IN_PROGRESS')).toBe(false);
    expect(isValidInstallationTransition('UNASSIGNED', 'COMPLETED')).toBe(false);
    expect(isValidInstallationTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(isValidInstallationTransition('ASSIGNED', 'ASSIGNED')).toBe(false);
  });
  it('only allows assignment before work starts', () => {
    expect(installationCanAssign('UNASSIGNED')).toBe(true);
    expect(installationCanAssign('ASSIGNED')).toBe(true);
    expect(installationCanAssign('IN_PROGRESS')).toBe(false);
    expect(installationCanAssign('COMPLETED')).toBe(false);
  });
  it('identifies terminal states', () => {
    expect(isTerminalInstallationStatus('COMPLETED')).toBe(true);
    expect(isTerminalInstallationStatus('CANCELLED')).toBe(true);
    expect(isTerminalInstallationStatus('ASSIGNED')).toBe(false);
  });
});

describe('QC lifecycle', () => {
  it('PENDING/IN_PROGRESS can pass or fail; results are terminal', () => {
    expect(isValidQcTransition('PENDING', 'IN_PROGRESS')).toBe(true);
    expect(isValidQcTransition('PENDING', 'PASSED')).toBe(true);
    expect(isValidQcTransition('IN_PROGRESS', 'FAILED')).toBe(true);
    expect(isValidQcTransition('PASSED', 'FAILED')).toBe(false);
    expect(isValidQcTransition('FAILED', 'PASSED')).toBe(false);
    expect(isTerminalQcStatus('PASSED')).toBe(true);
    expect(isTerminalQcStatus('FAILED')).toBe(true);
  });
});

describe('defect lifecycle', () => {
  it('OPEN -> IN_PROGRESS -> RESOLVED -> VERIFIED, reopenable before verified', () => {
    expect(isValidDefectTransition('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(isValidDefectTransition('IN_PROGRESS', 'RESOLVED')).toBe(true);
    expect(isValidDefectTransition('RESOLVED', 'VERIFIED')).toBe(true);
    expect(isValidDefectTransition('RESOLVED', 'OPEN')).toBe(true);
    expect(isValidDefectTransition('VERIFIED', 'OPEN')).toBe(false);
  });
  it('OPEN and IN_PROGRESS defects block QC', () => {
    expect(defectIsBlocking('OPEN')).toBe(true);
    expect(defectIsBlocking('IN_PROGRESS')).toBe(true);
    expect(defectIsBlocking('RESOLVED')).toBe(false);
    expect(defectIsBlocking('VERIFIED')).toBe(false);
  });
});

describe('net metering lifecycle', () => {
  it('follows the documented graph', () => {
    expect(isValidNetMeteringTransition('NOT_STARTED', 'DOCUMENTS_PENDING')).toBe(true);
    expect(isValidNetMeteringTransition('DOCUMENTS_PENDING', 'SUBMITTED')).toBe(true);
    expect(isValidNetMeteringTransition('SUBMITTED', 'UNDER_REVIEW')).toBe(true);
    expect(isValidNetMeteringTransition('UNDER_REVIEW', 'APPROVED')).toBe(true);
    expect(isValidNetMeteringTransition('APPROVED', 'COMPLETED')).toBe(true);
    expect(isValidNetMeteringTransition('REJECTED', 'SUBMITTED')).toBe(true);
    expect(isValidNetMeteringTransition('COMPLETED', 'SUBMITTED')).toBe(false);
    expect(isValidNetMeteringTransition('NOT_STARTED', 'APPROVED')).toBe(false);
  });
});

describe('handover lifecycle', () => {
  it('PENDING/READY -> COMPLETED; COMPLETED terminal', () => {
    expect(isValidHandoverTransition('PENDING', 'READY')).toBe(true);
    expect(isValidHandoverTransition('READY', 'COMPLETED')).toBe(true);
    expect(isValidHandoverTransition('PENDING', 'COMPLETED')).toBe(true);
    expect(isValidHandoverTransition('COMPLETED', 'PENDING')).toBe(false);
  });
});
