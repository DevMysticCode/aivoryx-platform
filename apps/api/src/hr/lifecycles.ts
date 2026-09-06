/**
 * Explicit HR lifecycle transition graphs (Phase 12, ADR 0041). Every
 * state-changing HR operation validates against one of these — invalid states
 * are impossible, not merely discouraged.
 */

export type EmployeeStatus =
  | 'ACTIVE'
  | 'ON_LEAVE'
  | 'SUSPENDED'
  | 'TERMINATED'
  | 'RESIGNED'
  | 'INACTIVE';

const EMPLOYEE_TRANSITIONS: Record<EmployeeStatus, EmployeeStatus[]> = {
  ACTIVE: ['ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED', 'INACTIVE'],
  ON_LEAVE: ['ACTIVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED'],
  SUSPENDED: ['ACTIVE', 'TERMINATED', 'RESIGNED', 'INACTIVE'],
  INACTIVE: ['ACTIVE'],
  // terminal — historical records remain, no reactivation
  TERMINATED: [],
  RESIGNED: [],
};

export function canTransitionEmployee(from: EmployeeStatus, to: EmployeeStatus): boolean {
  return from === to || (EMPLOYEE_TRANSITIONS[from]?.includes(to) ?? false);
}
export function isTerminalEmployeeStatus(s: EmployeeStatus): boolean {
  return s === 'TERMINATED' || s === 'RESIGNED';
}

export type LeaveRequestStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

const LEAVE_TRANSITIONS: Record<LeaveRequestStatus, LeaveRequestStatus[]> = {
  DRAFT: ['PENDING', 'CANCELLED'],
  PENDING: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['CANCELLED'], // an approved future leave may be cancelled (balance restored)
  REJECTED: [],
  CANCELLED: [],
};

export function canTransitionLeave(from: LeaveRequestStatus, to: LeaveRequestStatus): boolean {
  return LEAVE_TRANSITIONS[from]?.includes(to) ?? false;
}

export type ExpenseClaimStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'REIMBURSEMENT_PENDING'
  | 'REIMBURSED'
  | 'REIMBURSEMENT_FAILED'
  | 'CANCELLED';

const EXPENSE_TRANSITIONS: Record<ExpenseClaimStatus, ExpenseClaimStatus[]> = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['REIMBURSEMENT_PENDING', 'REIMBURSED', 'CANCELLED'],
  REIMBURSEMENT_PENDING: ['REIMBURSED', 'REIMBURSEMENT_FAILED'],
  REIMBURSEMENT_FAILED: ['REIMBURSEMENT_PENDING', 'REIMBURSED', 'CANCELLED'],
  REJECTED: [],
  REIMBURSED: [],
  CANCELLED: [],
};

export function canTransitionExpense(from: ExpenseClaimStatus, to: ExpenseClaimStatus): boolean {
  return EXPENSE_TRANSITIONS[from]?.includes(to) ?? false;
}
/** Once an approved amount is set it is immutable — corrections are new rows. */
export function isExpenseAmountLocked(status: ExpenseClaimStatus): boolean {
  return status !== 'DRAFT' && status !== 'SUBMITTED';
}

export type PayrollPeriodStatus =
  | 'DRAFT'
  | 'PROCESSING'
  | 'FINALIZED'
  | 'PAYMENT_PROCESSING'
  | 'PARTIALLY_PAID'
  | 'PAID'
  | 'CANCELLED';

const PAYROLL_TRANSITIONS: Record<PayrollPeriodStatus, PayrollPeriodStatus[]> = {
  DRAFT: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['DRAFT', 'FINALIZED', 'CANCELLED'],
  FINALIZED: ['PAYMENT_PROCESSING', 'CANCELLED'],
  PAYMENT_PROCESSING: ['PARTIALLY_PAID', 'PAID'],
  PARTIALLY_PAID: ['PAYMENT_PROCESSING', 'PAID'],
  PAID: [],
  CANCELLED: [],
};

export function canTransitionPayroll(from: PayrollPeriodStatus, to: PayrollPeriodStatus): boolean {
  return PAYROLL_TRANSITIONS[from]?.includes(to) ?? false;
}
/** Finalized (and later) payroll is immutable — its entries are frozen snapshots. */
export function isPayrollLocked(status: PayrollPeriodStatus): boolean {
  return status !== 'DRAFT' && status !== 'PROCESSING';
}

export type PerformanceReviewStatus = 'DRAFT' | 'SUBMITTED' | 'ACKNOWLEDGED' | 'CLOSED';

const REVIEW_TRANSITIONS: Record<PerformanceReviewStatus, PerformanceReviewStatus[]> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['ACKNOWLEDGED', 'CLOSED'],
  ACKNOWLEDGED: ['CLOSED'],
  CLOSED: [],
};

export function canTransitionReview(
  from: PerformanceReviewStatus,
  to: PerformanceReviewStatus,
): boolean {
  return REVIEW_TRANSITIONS[from]?.includes(to) ?? false;
}
