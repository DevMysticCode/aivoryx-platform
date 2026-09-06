import { describe, expect, it } from 'vitest';
import {
  canTransitionEmployee,
  canTransitionExpense,
  canTransitionLeave,
  canTransitionPayroll,
  canTransitionReview,
  isExpenseAmountLocked,
  isPayrollLocked,
  isTerminalEmployeeStatus,
} from './lifecycles.js';

describe('HR lifecycle transitions (Phase 12, ADR 0041)', () => {
  it('employee: active can suspend / resign / terminate; terminal is a dead end', () => {
    expect(canTransitionEmployee('ACTIVE', 'SUSPENDED')).toBe(true);
    expect(canTransitionEmployee('SUSPENDED', 'ACTIVE')).toBe(true);
    expect(canTransitionEmployee('INACTIVE', 'ACTIVE')).toBe(true);
    expect(canTransitionEmployee('TERMINATED', 'ACTIVE')).toBe(false);
    expect(canTransitionEmployee('RESIGNED', 'ACTIVE')).toBe(false);
    expect(isTerminalEmployeeStatus('TERMINATED')).toBe(true);
    expect(isTerminalEmployeeStatus('ACTIVE')).toBe(false);
  });

  it('leave: pending -> approved/rejected/cancelled; rejected is terminal', () => {
    expect(canTransitionLeave('PENDING', 'APPROVED')).toBe(true);
    expect(canTransitionLeave('APPROVED', 'CANCELLED')).toBe(true);
    expect(canTransitionLeave('REJECTED', 'PENDING')).toBe(false);
    expect(canTransitionLeave('APPROVED', 'REJECTED')).toBe(false);
  });

  it('expense: draft/submitted editable; approved amount is locked', () => {
    expect(canTransitionExpense('SUBMITTED', 'APPROVED')).toBe(true);
    expect(canTransitionExpense('APPROVED', 'REIMBURSED')).toBe(true);
    expect(canTransitionExpense('REIMBURSED', 'APPROVED')).toBe(false);
    expect(isExpenseAmountLocked('SUBMITTED')).toBe(false);
    expect(isExpenseAmountLocked('APPROVED')).toBe(true);
    expect(isExpenseAmountLocked('REIMBURSED')).toBe(true);
  });

  it('payroll: finalized is locked; forward-only through payment', () => {
    expect(canTransitionPayroll('DRAFT', 'PROCESSING')).toBe(true);
    expect(canTransitionPayroll('PROCESSING', 'FINALIZED')).toBe(true);
    expect(canTransitionPayroll('FINALIZED', 'PROCESSING')).toBe(false);
    expect(canTransitionPayroll('FINALIZED', 'PAYMENT_PROCESSING')).toBe(true);
    expect(isPayrollLocked('PROCESSING')).toBe(false);
    expect(isPayrollLocked('FINALIZED')).toBe(true);
    expect(isPayrollLocked('PAID')).toBe(true);
  });

  it('performance review: draft -> submitted -> acknowledged -> closed', () => {
    expect(canTransitionReview('DRAFT', 'SUBMITTED')).toBe(true);
    expect(canTransitionReview('SUBMITTED', 'ACKNOWLEDGED')).toBe(true);
    expect(canTransitionReview('ACKNOWLEDGED', 'CLOSED')).toBe(true);
    expect(canTransitionReview('CLOSED', 'DRAFT')).toBe(false);
  });
});
