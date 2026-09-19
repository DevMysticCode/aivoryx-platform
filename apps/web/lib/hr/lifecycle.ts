/**
 * Employee lifecycle, as the UI offers it (Phase 17). A UX mirror of the server's
 * transition graph (`apps/api/src/hr/lifecycles.ts`) so a user is only ever shown
 * moves that can succeed. The server remains authoritative and rejects anything
 * else with HR_INVALID_STATE — this is convenience, never enforcement.
 */

export const EMPLOYEE_STATUSES = [
  'ONBOARDING',
  'ACTIVE',
  'ON_LEAVE',
  'SUSPENDED',
  'INACTIVE',
  'RESIGNED',
  'TERMINATED',
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

const TRANSITIONS: Record<EmployeeStatus, EmployeeStatus[]> = {
  ONBOARDING: ['ACTIVE', 'RESIGNED', 'TERMINATED'],
  ACTIVE: ['ON_LEAVE', 'SUSPENDED', 'INACTIVE', 'RESIGNED', 'TERMINATED'],
  ON_LEAVE: ['ACTIVE', 'SUSPENDED', 'RESIGNED', 'TERMINATED'],
  SUSPENDED: ['ACTIVE', 'INACTIVE', 'RESIGNED', 'TERMINATED'],
  INACTIVE: ['ACTIVE'],
  RESIGNED: [],
  TERMINATED: [],
};

export function isEmployeeStatus(value: string): value is EmployeeStatus {
  return (EMPLOYEE_STATUSES as readonly string[]).includes(value);
}

/** The statuses an employee currently in `from` can be moved to. */
export function nextEmployeeStatuses(from: string): EmployeeStatus[] {
  return isEmployeeStatus(from) ? TRANSITIONS[from] : [];
}

/** Ending employment is recorded with a reason and cannot be undone here. */
export function isEndingStatus(status: string): boolean {
  return status === 'RESIGNED' || status === 'TERMINATED';
}

export function employeeStatusLabel(status: string): string {
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}
