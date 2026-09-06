'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { Table, Select } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import type { HrPayrollEntry } from '@aivoryx/contracts';
import { HrStatusBadge, TextField, DefRow, money, fmtDate } from '@/components/hr/ui';
import * as hrApi from '@/lib/api/hr';
import { usePayrollPeriod, usePayrollActions } from '@/lib/hr/use-hr';

export default function PayrollPeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const perms = usePermissions();
  const canProcess = perms.includes('hr.payroll.process');
  const canFinalize = perms.includes('hr.payroll.finalize');
  const canPay = perms.includes('hr.payroll.payment');

  const q = usePayrollPeriod(id);
  const actions = usePayrollActions(id);
  const p = q.data;

  return (
    <div className="space-y-6">
      <Link href="/hr/payroll" className="text-sm text-muted-foreground hover:underline">
        ← Payroll
      </Link>
      {q.isLoading && <Skeleton rows={4} />}
      {q.error && <ErrorNote error={q.error} />}
      {p && (
        <>
          <PageHeader
            title={p.name}
            description={`${fmtDate(p.periodStart)} – ${fmtDate(p.periodEnd)} · pay ${fmtDate(p.payDate)}`}
          >
            <HrStatusBadge status={p.status} />
          </PageHeader>

          <div className="grid gap-3 md:grid-cols-3">
            <Card>
              <DefRow label="Gross">{money(p.grossTotal, p.currency)}</DefRow>
              <DefRow label="Deductions">{money(p.deductionTotal, p.currency)}</DefRow>
              <DefRow label="Incentives">{money(p.incentiveTotal, p.currency)}</DefRow>
              <DefRow label="Reimbursements">{money(p.reimbursementTotal, p.currency)}</DefRow>
              <DefRow label="Net">{money(p.netTotal, p.currency)}</DefRow>
            </Card>
            <Card>
              <DefRow label="Employees">{p.employeeCount}</DefRow>
              <DefRow label="Paid">{p.paidCount}</DefRow>
              <DefRow label="Pending">{p.pendingCount}</DefRow>
              <DefRow label="Failed">{p.failedCount}</DefRow>
              <DefRow label="Finalized">{p.finalizedAt ? fmtDate(p.finalizedAt) : '—'}</DefRow>
            </Card>
            <Card className="space-y-2">
              <div className="text-sm font-semibold">Workflow</div>
              {canProcess && (p.status === 'DRAFT' || p.status === 'PROCESSING') && (
                <Button
                  size="sm"
                  disabled={actions.process.isPending}
                  onClick={() => actions.process.mutate()}
                >
                  {p.status === 'DRAFT' ? 'Process' : 'Re-process'}
                </Button>
              )}
              {canFinalize && p.status === 'PROCESSING' && (
                <Button
                  size="sm"
                  disabled={actions.finalize.isPending}
                  onClick={() => actions.finalize.mutate()}
                >
                  Finalize (freeze)
                </Button>
              )}
              {['FINALIZED', 'PAYMENT_PROCESSING', 'PARTIALLY_PAID', 'PAID'].includes(p.status) && (
                <p className="text-xs text-muted-foreground">
                  Finalized — entries are immutable snapshots. Later salary / leave / expense
                  changes do not alter them.
                </p>
              )}
              {(actions.process.error || actions.finalize.error) && (
                <ErrorNote error={actions.process.error || actions.finalize.error} />
              )}
            </Card>
          </div>

          <Card>
            <div className="mb-3 text-sm font-semibold">Entries</div>
            <Table
              head={
                <tr>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Base</th>
                  <th className="px-3 py-2">Allowances</th>
                  <th className="px-3 py-2">Incentives</th>
                  <th className="px-3 py-2">Reimb.</th>
                  <th className="px-3 py-2">Deductions</th>
                  <th className="px-3 py-2">Gross</th>
                  <th className="px-3 py-2">Net</th>
                  <th className="px-3 py-2">Paid</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              }
            >
              {p.entries.map((e) => (
                <EntryRow key={e.id} e={e} periodId={id} canPay={canPay} periodStatus={p.status} />
              ))}
              {p.entries.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                    No entries. Process the period to calculate them.
                  </td>
                </tr>
              )}
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}

function EntryRow({
  e,
  periodId,
  canPay,
  periodStatus,
}: {
  e: HrPayrollEntry;
  periodId: string;
  canPay: boolean;
  periodStatus: string;
}) {
  const actions = usePayrollActions(periodId);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    amount: e.netPay,
    paymentMethod: 'BANK_TRANSFER',
    paymentDate: new Date().toISOString().slice(0, 10),
    paymentReference: '',
    transactionRef: '',
    status: 'PAID',
    failureReason: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const payable = ['FINALIZED', 'PAYMENT_PROCESSING', 'PARTIALLY_PAID'].includes(periodStatus);
  const finalized = periodStatus !== 'DRAFT' && periodStatus !== 'PROCESSING';

  return (
    <>
      <tr>
        <td className="px-3 py-2">
          {e.employeeName} <span className="text-xs text-muted-foreground">{e.employeeNumber}</span>
        </td>
        <td className="px-3 py-2 tabular-nums">{money(e.baseEarnings)}</td>
        <td className="px-3 py-2 tabular-nums">{money(e.allowancesTotal)}</td>
        <td className="px-3 py-2 tabular-nums">{money(e.incentivesTotal)}</td>
        <td className="px-3 py-2 tabular-nums">{money(e.reimbursementsTotal)}</td>
        <td className="px-3 py-2 tabular-nums">{money(e.deductionsTotal)}</td>
        <td className="px-3 py-2 tabular-nums">{money(e.grossPay)}</td>
        <td className="px-3 py-2 font-medium tabular-nums">{money(e.netPay)}</td>
        <td className="px-3 py-2 tabular-nums">{money(e.paidAmount)}</td>
        <td className="px-3 py-2">
          <HrStatusBadge status={e.paymentStatus} />
        </td>
        <td className="px-3 py-2 text-right">
          {finalized && (
            <a
              href={hrApi.payslipPdfUrl(e.id)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              Payslip
            </a>
          )}
          {canPay && payable && e.paymentStatus !== 'PAID' && (
            <button
              className="ml-2 text-xs text-primary hover:underline"
              onClick={() => setOpen((v) => !v)}
            >
              Pay
            </button>
          )}
        </td>
      </tr>
      {open && canPay && (
        <tr>
          <td colSpan={11} className="bg-accent/30 px-3 py-3">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <TextField
                label="Amount"
                value={form.amount}
                onChange={(ev) => set('amount', ev.target.value)}
              />
              <TextField
                label="Date"
                type="date"
                value={form.paymentDate}
                onChange={(ev) => set('paymentDate', ev.target.value)}
              />
              <Select
                label="Method"
                value={form.paymentMethod}
                onChange={(ev) => set('paymentMethod', ev.target.value)}
              >
                {['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
              <TextField
                label="Reference"
                value={form.paymentReference}
                onChange={(ev) => set('paymentReference', ev.target.value)}
              />
              <TextField
                label="Transaction id"
                value={form.transactionRef}
                onChange={(ev) => set('transactionRef', ev.target.value)}
              />
              <Select
                label="Outcome"
                value={form.status}
                onChange={(ev) => set('status', ev.target.value)}
              >
                <option value="PAID">Paid</option>
                <option value="FAILED">Failed</option>
              </Select>
              {form.status === 'FAILED' && (
                <TextField
                  label="Failure reason"
                  value={form.failureReason}
                  onChange={(ev) => set('failureReason', ev.target.value)}
                />
              )}
              <div className="flex items-end">
                <Button
                  size="sm"
                  disabled={!form.amount || actions.recordPayment.isPending}
                  onClick={() =>
                    actions.recordPayment.mutate(
                      {
                        payrollEntryId: e.id,
                        amount: form.amount,
                        paymentMethod: form.paymentMethod,
                        paymentDate: form.paymentDate,
                        paymentReference: form.paymentReference || undefined,
                        transactionRef: form.transactionRef || undefined,
                        status: form.status,
                        failureReason:
                          form.status === 'FAILED' ? form.failureReason || undefined : undefined,
                      },
                      { onSuccess: () => setOpen(false) },
                    )
                  }
                >
                  Record payment
                </Button>
              </div>
            </div>
            {actions.recordPayment.error && (
              <div className="mt-2">
                <ErrorNote error={actions.recordPayment.error} />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
