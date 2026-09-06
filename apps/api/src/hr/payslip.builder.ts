import type { DocumentDefinition } from '../documents/document.types.js';
import { schema } from '@aivoryx/db';
import { sum } from './money.js';

/**
 * Builds a generic {@link DocumentDefinition} for a payslip. It imports only the
 * generic document types — no rendering, no branding — so the HR domain stays
 * extractable. The document engine owns layout, typography and tenant branding.
 */
export function buildPayslipDocument(data: {
  entry: schema.PayrollEntryRow;
  period: schema.PayrollPeriodRow;
  components: schema.PayrollEntryComponentRow[];
  payment: schema.PayrollPaymentRow | null;
}): DocumentDefinition {
  const { entry, period, components, payment } = data;

  const earnings = components.filter(
    (c) => c.kind === 'EARNING' || c.kind === 'INCENTIVE' || c.kind === 'REIMBURSEMENT',
  );
  const deductions = components.filter((c) => c.kind === 'DEDUCTION');

  const rows: Record<string, string>[] = [
    ...earnings.map((c) => ({
      item: c.name,
      earning: money(c.amount, entry.currency),
      deduction: '',
    })),
    ...deductions.map((c) => ({
      item: c.name,
      earning: '',
      deduction: money(c.amount, entry.currency),
    })),
  ];

  const totals = [
    { label: 'Gross earnings', value: money(entry.grossPay, entry.currency) },
    { label: 'Total deductions', value: money(entry.deductionsTotal, entry.currency) },
    { label: 'Net pay', value: money(entry.netPay, entry.currency), emphasis: true },
  ];

  const meta = [
    { label: 'Payslip no.', value: `${period.name} · ${entry.employeeNumber}` },
    { label: 'Pay period', value: `${period.periodStart} to ${period.periodEnd}` },
    { label: 'Pay date', value: period.payDate ?? '—' },
    { label: 'Currency', value: entry.currency },
    { label: 'Payroll status', value: period.status },
  ];

  const sections = [
    {
      heading: 'Employee',
      lines: [entry.employeeName, `Employee no. ${entry.employeeNumber}`],
    },
  ];
  if (payment) {
    sections.push({
      heading: 'Payment',
      lines: [
        `Method: ${payment.paymentMethod ?? '—'}`,
        `Date: ${payment.paymentDate ?? '—'}`,
        payment.paymentReference ? `Reference: ${payment.paymentReference}` : `Reference: —`,
        `Paid to date: ${money(sum([entry.paidAmount]), entry.currency)}`,
      ],
    });
  }

  return {
    documentTitle: 'PAYSLIP',
    documentNumber: `PS-${entry.employeeNumber}-${period.name.replace(/\s+/g, '-')}`,
    status: entry.paymentStatus,
    meta,
    table: {
      columns: [
        { key: 'item', label: 'Component', width: 3 },
        { key: 'earning', label: 'Earnings', align: 'right', width: 1 },
        { key: 'deduction', label: 'Deductions', align: 'right', width: 1 },
      ],
      rows,
    },
    totals,
    sections,
    notes:
      'This payslip is a system-generated statement of operational payroll. It is not a statutory tax document.',
  };
}

function money(v: string, currency: string): string {
  const n = Number(v);
  const formatted = Number.isFinite(n)
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v;
  return `${currency} ${formatted}`;
}
