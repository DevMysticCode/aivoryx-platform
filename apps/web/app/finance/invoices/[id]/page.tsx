'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { Card, EmptyState, ErrorNote, Skeleton, PageHeader } from '@/components/admin/ui';
import { fmtMoney, fmtDate, SupplyStatusBadge } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { useInvoice, useInvoiceAction, useRecordPayment } from '@/lib/finance/use-finance';
import { invoicePrintUrl } from '@/lib/api/finance';
import type { RecordPaymentRequest } from '@aivoryx/contracts';

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const perms = usePermissions();
  const q = useInvoice(id);
  const actions = useInvoiceAction(id);
  const pay = useRecordPayment();

  const [showPay, setShowPay] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');

  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <EmptyState>Invoice not found.</EmptyState>;
  const inv = q.data;

  const canIssue = perms.includes('finance.invoices.issue') && inv.status === 'DRAFT';
  const canCancel =
    perms.includes('finance.invoices.cancel') &&
    ['DRAFT', 'ISSUED', 'PARTIALLY_PAID'].includes(inv.status);
  const canPay =
    perms.includes('finance.payments.create') &&
    ['ISSUED', 'PARTIALLY_PAID'].includes(inv.status) &&
    Number(inv.amountOutstanding) > 0;
  const activeAllocs = inv.allocations.filter((a) => !a.reversed);

  const recordPayment = async () => {
    await pay.mutateAsync({
      customerId: inv.customerId,
      paymentDate,
      amount,
      currency: inv.currency,
      method: method as RecordPaymentRequest['method'],
      reference: reference || undefined,
      allocations: [{ invoiceId: inv.id, amount }],
    });
    setShowPay(false);
    setAmount('');
    setReference('');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={inv.number}
        description={
          inv.customerName
            ? `${inv.customerName}${inv.projectNumber ? ` · ${inv.projectNumber}` : ''}`
            : undefined
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <SupplyStatusBadge status={inv.status} />
          {inv.overdue && (
            <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
              Overdue {inv.daysOverdue}d
            </span>
          )}
          <a
            href={invoicePrintUrl(inv.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-accent"
          >
            Print
          </a>
          {canIssue && (
            <Button
              size="sm"
              onClick={() => actions.issue.mutate()}
              disabled={actions.issue.isPending}
            >
              {actions.issue.isPending ? 'Issuing…' : 'Issue invoice'}
            </Button>
          )}
          {canCancel && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm('Cancel this invoice?')) actions.cancel.mutate('CANCELLED');
              }}
              disabled={actions.cancel.isPending}
            >
              Cancel
            </Button>
          )}
          {canPay && (
            <Button size="sm" variant="outline" onClick={() => setShowPay((v) => !v)}>
              Record payment
            </Button>
          )}
        </div>
      </PageHeader>

      <ErrorNote error={actions.issue.error ?? actions.cancel.error} />

      {inv.status === 'DRAFT' && perms.includes('finance.invoices.update') && (
        <p className="text-sm text-muted-foreground">
          This is a draft. Edit its lines from the{' '}
          <Link href="/finance/invoices" className="text-primary underline">
            invoices list
          </Link>{' '}
          then issue it. Issued invoices are financially immutable.
        </p>
      )}

      {showPay && (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Amount ({inv.currency})
              </span>
              <input
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={inv.amountOutstanding}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Date</span>
              <input
                type="date"
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Method</span>
              <select
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                {['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'].map((m) => (
                  <option key={m} value={m}>
                    {m.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Reference</span>
              <input
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
          </div>
          <ErrorNote error={pay.error} />
          <Button onClick={recordPayment} disabled={!amount || pay.isPending}>
            {pay.isPending ? 'Recording…' : 'Record & allocate'}
          </Button>
        </Card>
      )}

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-secondary/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Unit price</th>
              <th className="px-3 py-2 text-right">Discount</th>
              <th className="px-3 py-2 text-right">Tax</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {inv.lines.map((l) => (
              <tr key={l.lineNo}>
                <td className="px-3 py-2">
                  {l.description}
                  {l.reference && (
                    <span className="block text-xs text-muted-foreground">{l.reference}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{l.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.unitPrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.lineDiscount)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {l.taxName ? `${l.taxName} ` : ''}
                  {fmtMoney(l.lineTax)}
                </td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">
                  {fmtMoney(l.lineTotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="space-y-1 text-sm">
          <Row label="Issue date" value={fmtDate(inv.issueDate)} />
          <Row label="Due date" value={fmtDate(inv.dueDate)} />
          <Row label="Currency" value={inv.currency} />
          {inv.reference && <Row label="Reference" value={inv.reference} />}
          {inv.notes && (
            <p className="border-t pt-2 text-muted-foreground whitespace-pre-wrap">{inv.notes}</p>
          )}
        </Card>
        <Card className="space-y-1 text-sm tabular-nums">
          <Row label="Subtotal" value={fmtMoney(inv.subtotal)} />
          <Row label="Discount" value={`-${fmtMoney(inv.discountTotal)}`} />
          <Row label="Tax" value={fmtMoney(inv.taxTotal)} />
          <div className="flex justify-between border-t pt-2 font-semibold">
            <span>Grand total</span>
            <span>
              {fmtMoney(inv.grandTotal)} {inv.currency}
            </span>
          </div>
          <Row label="Paid" value={fmtMoney(inv.amountPaid)} />
          {Number(inv.amountCredited) > 0 && (
            <Row label="Credited" value={fmtMoney(inv.amountCredited)} />
          )}
          <div className="flex justify-between border-t pt-2 font-semibold">
            <span>Outstanding</span>
            <span className={Number(inv.amountOutstanding) > 0 ? 'text-destructive' : ''}>
              {fmtMoney(inv.amountOutstanding)}
            </span>
          </div>
        </Card>
      </div>

      {activeAllocs.length > 0 && (
        <Card className="p-0">
          <div className="border-b px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            Payments
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {activeAllocs.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/finance/payments/${a.paymentId}`}
                      className="font-mono text-xs text-primary"
                    >
                      {a.paymentNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {fmtDate(a.createdAt)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {fmtMoney(a.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
