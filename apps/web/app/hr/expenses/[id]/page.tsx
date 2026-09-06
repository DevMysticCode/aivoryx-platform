'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { Select } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { HrStatusBadge, TextField, DefRow, money, fmtDate, fmtDateTime } from '@/components/hr/ui';
import * as hrApi from '@/lib/api/hr';
import { useExpenseClaim, useExpenseActions } from '@/lib/hr/use-hr';

export default function ExpenseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const perms = usePermissions();
  const canApprove = perms.includes('hr.expense.approve');
  const canReimburse = perms.includes('hr.expense.reimburse');
  const canSubmit = perms.includes('hr.expense.submit');

  const claim = useExpenseClaim(id);
  const actions = useExpenseActions(id);

  const [approvedAmount, setApprovedAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reimb, setReimb] = useState({
    reimbursedAmount: '',
    paymentDate: '',
    paymentMethod: 'BANK_TRANSFER',
    paymentReference: '',
    transactionRef: '',
    status: 'PAID',
    failureReason: '',
  });

  const c = claim.data;

  return (
    <div className="space-y-6">
      <Link href="/hr/expenses" className="text-sm text-muted-foreground hover:underline">
        ← Expenses
      </Link>
      {claim.isLoading && <Skeleton rows={4} />}
      {claim.error && <ErrorNote error={claim.error} />}
      {c && (
        <>
          <PageHeader title={c.claimNumber} description={`${c.employeeName} · ${c.categoryName}`}>
            <HrStatusBadge status={c.status} />
          </PageHeader>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <div className="mb-2 text-sm font-semibold">Claim</div>
              <DefRow label="Employee">
                {c.employeeName}{' '}
                <span className="text-xs text-muted-foreground">{c.employeeNumber}</span>
              </DefRow>
              <DefRow label="Category">{c.categoryName}</DefRow>
              <DefRow label="Expense date">{fmtDate(c.expenseDate)}</DefRow>
              <DefRow label="Amount">{money(c.amount, c.currency)}</DefRow>
              <DefRow label="Reimbursable">{money(c.reimbursementAmount, c.currency)}</DefRow>
              <DefRow label="Approved amount">
                {c.approvedAmount ? money(c.approvedAmount, c.currency) : '—'}
              </DefRow>
              <DefRow label="Distance (km)">{c.distanceKm ?? '—'}</DefRow>
              <DefRow label="Merchant">{c.merchant ?? '—'}</DefRow>
              <DefRow label="Description">{c.description ?? '—'}</DefRow>
              <DefRow label="Visit reference">{c.visitRef ?? '—'}</DefRow>
              <DefRow label="Receipt">
                {c.hasReceipt ? (
                  <a
                    href={hrApi.expenseReceiptUrl(c.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    View
                  </a>
                ) : (
                  '—'
                )}
              </DefRow>
              <DefRow label="Decided">{fmtDateTime(c.decidedAt)}</DefRow>
              {c.decisionReason && <DefRow label="Decision note">{c.decisionReason}</DefRow>}
            </Card>

            <Card>
              <div className="mb-2 text-sm font-semibold">Reimbursement</div>
              {c.reimbursement ? (
                <>
                  <DefRow label="Status">
                    <HrStatusBadge status={c.reimbursement.status} />
                  </DefRow>
                  <DefRow label="Amount">
                    {money(c.reimbursement.reimbursedAmount, c.currency)}
                  </DefRow>
                  <DefRow label="Paid on">{fmtDate(c.reimbursement.paymentDate)}</DefRow>
                  <DefRow label="Method">{c.reimbursement.paymentMethod ?? '—'}</DefRow>
                  <DefRow label="Reference">{c.reimbursement.paymentReference ?? '—'}</DefRow>
                  <DefRow label="Transaction">{c.reimbursement.transactionRef ?? '—'}</DefRow>
                  {c.reimbursement.failureReason && (
                    <DefRow label="Failure">{c.reimbursement.failureReason}</DefRow>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Not reimbursed.</p>
              )}
            </Card>
          </div>

          <Card className="space-y-4">
            <div className="text-sm font-semibold">Actions</div>
            <div className="flex flex-wrap gap-2">
              {canSubmit && c.status === 'DRAFT' && (
                <Button
                  size="sm"
                  disabled={actions.submit.isPending}
                  onClick={() => actions.submit.mutate()}
                >
                  Submit for approval
                </Button>
              )}
              {canSubmit && (c.status === 'DRAFT' || c.status === 'SUBMITTED') && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actions.cancel.isPending}
                  onClick={() => actions.cancel.mutate()}
                >
                  Cancel
                </Button>
              )}
              <label className="text-sm">
                <span className="block font-medium">Attach receipt</span>
                <input
                  type="file"
                  className="mt-1 text-sm"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const fd = new FormData();
                    fd.set('file', f);
                    await hrApi.uploadExpenseReceipt(id, fd);
                    await claim.refetch();
                    e.currentTarget.value = '';
                  }}
                />
              </label>
            </div>

            {canApprove && c.status === 'SUBMITTED' && (
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField
                  label="Approve for amount"
                  value={approvedAmount}
                  onChange={(e) => setApprovedAmount(e.target.value)}
                  hint="Blank = full reimbursable"
                />
                <TextField
                  label="Note"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <div className="flex items-end gap-2">
                  <Button
                    size="sm"
                    disabled={actions.approve.isPending}
                    onClick={() =>
                      actions.approve.mutate({
                        approvedAmount: approvedAmount || undefined,
                        reason: reason || undefined,
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actions.reject.isPending}
                    onClick={() => actions.reject.mutate({ reason: reason || undefined })}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            )}

            {canReimburse && (c.status === 'APPROVED' || c.status === 'REIMBURSEMENT_FAILED') && (
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField
                  label="Reimbursed amount"
                  value={reimb.reimbursedAmount}
                  onChange={(e) => setReimb((r) => ({ ...r, reimbursedAmount: e.target.value }))}
                />
                <TextField
                  label="Payment date"
                  type="date"
                  value={reimb.paymentDate}
                  onChange={(e) => setReimb((r) => ({ ...r, paymentDate: e.target.value }))}
                />
                <Select
                  label="Method"
                  value={reimb.paymentMethod}
                  onChange={(e) => setReimb((r) => ({ ...r, paymentMethod: e.target.value }))}
                >
                  {['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
                <TextField
                  label="Reference"
                  value={reimb.paymentReference}
                  onChange={(e) => setReimb((r) => ({ ...r, paymentReference: e.target.value }))}
                />
                <TextField
                  label="Transaction id"
                  value={reimb.transactionRef}
                  onChange={(e) => setReimb((r) => ({ ...r, transactionRef: e.target.value }))}
                />
                <Select
                  label="Outcome"
                  value={reimb.status}
                  onChange={(e) => setReimb((r) => ({ ...r, status: e.target.value }))}
                >
                  <option value="PAID">Paid</option>
                  <option value="FAILED">Failed</option>
                </Select>
                {reimb.status === 'FAILED' && (
                  <TextField
                    label="Failure reason"
                    value={reimb.failureReason}
                    onChange={(e) => setReimb((r) => ({ ...r, failureReason: e.target.value }))}
                  />
                )}
                <div className="flex items-end">
                  <Button
                    size="sm"
                    disabled={
                      !reimb.reimbursedAmount || !reimb.paymentDate || actions.reimburse.isPending
                    }
                    onClick={() =>
                      actions.reimburse.mutate({
                        reimbursedAmount: reimb.reimbursedAmount,
                        paymentDate: reimb.paymentDate,
                        paymentMethod: reimb.paymentMethod,
                        paymentReference: reimb.paymentReference || undefined,
                        transactionRef: reimb.transactionRef || undefined,
                        status: reimb.status,
                        failureReason:
                          reimb.status === 'FAILED' ? reimb.failureReason || undefined : undefined,
                      })
                    }
                  >
                    Record reimbursement
                  </Button>
                </div>
              </div>
            )}

            {(actions.submit.error ||
              actions.approve.error ||
              actions.reject.error ||
              actions.cancel.error ||
              actions.reimburse.error) && (
              <ErrorNote
                error={
                  actions.submit.error ||
                  actions.approve.error ||
                  actions.reject.error ||
                  actions.cancel.error ||
                  actions.reimburse.error
                }
              />
            )}
          </Card>
        </>
      )}
    </div>
  );
}
