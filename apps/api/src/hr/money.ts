import { formatDec, parseDec } from './decimal.js';

/**
 * HR / payroll money math (Phase 12, ADR 0041). Reuses the Phase 5 fixed-point
 * decimal helpers — values are decimal strings, never JS floats — so payroll
 * arithmetic is exact and the numbers a payslip shows always add up:
 *
 *   gross = base_earnings + allowances + incentives + approved_reimbursements
 *   net   = gross − deductions
 */

/** Sum a column of 2dp money strings, returned as a 2dp string. */
export function sum(values: string[]): string {
  return formatDec(
    values.reduce((acc, v) => acc + parseDec(v || '0'), 0n),
    2,
  );
}

export interface PayComponent {
  kind: 'EARNING' | 'DEDUCTION' | 'INCENTIVE' | 'REIMBURSEMENT';
  amount: string;
}

export interface PayrollTotals {
  baseEarnings: string;
  allowancesTotal: string;
  incentivesTotal: string;
  reimbursementsTotal: string;
  deductionsTotal: string;
  grossPay: string;
  netPay: string;
}

/**
 * Compute an employee's payroll totals from a base salary + a flat list of
 * components. `baseEarnings` is the base salary; EARNING components beyond that
 * are "allowances"; DEDUCTION reduces net; INCENTIVE and REIMBURSEMENT add to
 * gross. Every figure is rounded to 2dp at the point it is produced.
 */
export function computePayrollTotals(
  baseSalary: string,
  components: PayComponent[],
): PayrollTotals {
  const base = formatDec(parseDec(baseSalary || '0'), 2);
  const allowances = sum(components.filter((c) => c.kind === 'EARNING').map((c) => c.amount));
  const incentives = sum(components.filter((c) => c.kind === 'INCENTIVE').map((c) => c.amount));
  const reimbursements = sum(
    components.filter((c) => c.kind === 'REIMBURSEMENT').map((c) => c.amount),
  );
  const deductions = sum(components.filter((c) => c.kind === 'DEDUCTION').map((c) => c.amount));
  const gross = sum([base, allowances, incentives, reimbursements]);
  const net = formatDec(parseDec(gross) - parseDec(deductions), 2);
  return {
    baseEarnings: base,
    allowancesTotal: allowances,
    incentivesTotal: incentives,
    reimbursementsTotal: reimbursements,
    deductionsTotal: deductions,
    grossPay: gross,
    netPay: net,
  };
}

/** Mileage reimbursement = distance × rate, rounded to 2dp. */
export function mileageAmount(distanceKm: string, ratePerKm: string): string {
  return formatDec((parseDec(distanceKm || '0') * parseDec(ratePerKm || '0')) / 1_000_000n, 2);
}
