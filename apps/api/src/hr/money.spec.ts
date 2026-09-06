import { describe, expect, it } from 'vitest';
import { computePayrollTotals, mileageAmount, sum } from './money.js';

describe('HR payroll money math (Phase 12)', () => {
  it('sums 2dp money strings without floating-point error', () => {
    expect(sum(['0.10', '0.20'])).toBe('0.30');
    expect(sum(['50000.00', '5000.50', '250.25'])).toBe('55250.75');
    expect(sum([])).toBe('0.00');
  });

  it('gross = base + allowances + incentives + reimbursements; net = gross - deductions', () => {
    const t = computePayrollTotals('50000.00', [
      { kind: 'EARNING', amount: '5000.00' }, // HRA
      { kind: 'EARNING', amount: '2000.00' }, // transport
      { kind: 'INCENTIVE', amount: '3000.00' },
      { kind: 'REIMBURSEMENT', amount: '850.00' },
      { kind: 'DEDUCTION', amount: '1200.00' },
    ]);
    expect(t.baseEarnings).toBe('50000.00');
    expect(t.allowancesTotal).toBe('7000.00');
    expect(t.incentivesTotal).toBe('3000.00');
    expect(t.reimbursementsTotal).toBe('850.00');
    expect(t.deductionsTotal).toBe('1200.00');
    expect(t.grossPay).toBe('60850.00');
    expect(t.netPay).toBe('59650.00');
    // the identity holds exactly
    expect(sum([t.baseEarnings, t.allowancesTotal, t.incentivesTotal, t.reimbursementsTotal])).toBe(
      t.grossPay,
    );
  });

  it('a zero-component payroll is just the base salary', () => {
    const t = computePayrollTotals('42000.00', []);
    expect(t.grossPay).toBe('42000.00');
    expect(t.netPay).toBe('42000.00');
  });

  it('mileage reimbursement is distance x rate, rounded to 2dp', () => {
    expect(mileageAmount('74', '12.5')).toBe('925.00');
    expect(mileageAmount('72.4', '9.75')).toBe('705.90');
    expect(mileageAmount('0', '12.5')).toBe('0.00');
  });
});
