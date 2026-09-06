'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { Card, EmptyState, ErrorNote, Skeleton, PageHeader } from '@/components/admin/ui';
import { fmtMoney, fmtDate, SupplyStatusBadge } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { usePayment, usePaymentAction, useInvoices } from '@/lib/finance/use-finance';
import { paymentPrintUrl } from '@/lib/api/finance';

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const perms = usePermissions();
  const q = usePayment(id);
  const actions = usePaymentAction(id);

  const [showAlloc, setShowAlloc] = useState(false);
  const [invoiceId, setInvoiceId] = useState('');
  const [amount, setAmount] = useState('');
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState('');

  const openInvoices = useInvoices({ customerId: q.data?.customerId, status: 'ISSUED' });
  const partInvoices = useInvoices({ customerId: q.data?.customerId, status: 'PARTIALLY_PAID' });

  if (q.isLoading) return <Skeleton rows={8} />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <EmptyState>Payment not found.</EmptyState>;
  const p = q.data;

  const allocatable = [
    ...(openInvoices.data?.items ?? []),
    ...(partInvoices.data?.items ?? []),
  ].filter((i) => Number(i.amountOutstanding) > 0);
  const canAllocate =
    perms.includes('finance.payments.allocate') &&
    p.status === 'RECORDED' &&
    Number(p.unallocatedAmount) > 0;
  const canReverse = perms.includes('finance.payments.reverse') && p.status === 'RECORDED';
  const activeAllocs = p.allocations.filter((a) => !a.reversed);

  return (
    <div className="space-y-6">
      <PageHeader title={p.number} description={p.customerName ?? undefined}>
        <div className="flex flex-wrap items-center gap-2">
          <SupplyStatusBadge status={p.status} />
          <a
            href={paymentPrintUrl(p.id)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center rounded-md border px-3 text-sm hover:bg-accent"
          >
            Receipt
          </a>
          {canAllocate && (
            <Button size="sm" variant="outline" onClick={() => setShowAlloc((v) => !v)}>
              Allocate
            </Button>
          )}
          {canReverse && (
            <Button size="sm" variant="outline" onClick={() => setReversing((v) => !v)}>
              Reverse
            </Button>
          )}
        </div>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Amount" value={`${fmtMoney(p.amount)} ${p.currency}`} />
        <Stat label="Allocated" value={fmtMoney(p.allocatedAmount)} />
        <Stat
          label="Unallocated"
          value={fmtMoney(p.unallocatedAmount)}
          tone={Number(p.unallocatedAmount) > 0 ? 'warn' : undefined}
        />
      </div>

      <Card className="space-y-1 text-sm">
        <Row label="Date" value={fmtDate(p.paymentDate)} />
        <Row label="Method" value={p.method.replace(/_/g, ' ')} />
        {p.reference && <Row label="Reference" value={p.reference} />}
        {p.reversedAt && (
          <p className="border-t pt-2 text-destructive">
            Reversed {fmtDate(p.reversedAt)}
            {p.reversalReason ? ` — ${p.reversalReason}` : ''}
          </p>
        )}
        {p.notes && (
          <p className="border-t pt-2 text-muted-foreground whitespace-pre-wrap">{p.notes}</p>
        )}
      </Card>

      {reversing && (
        <Card className="space-y-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Reason (optional)</span>
            <input
              className="h-9 w-full rounded-md border px-3 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <ErrorNote error={actions.reverse.error} />
          <Button
            variant="outline"
            onClick={() => actions.reverse.mutate(reason)}
            disabled={actions.reverse.isPending}
          >
            {actions.reverse.isPending ? 'Reversing…' : 'Confirm reversal'}
          </Button>
        </Card>
      )}

      {showAlloc && (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Invoice</span>
              <select
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
              >
                <option value="">Select an open invoice…</option>
                {allocatable.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} — {fmtMoney(i.amountOutstanding)} {i.currency} outstanding
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Amount</span>
              <input
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={p.unallocatedAmount}
              />
            </label>
          </div>
          <ErrorNote error={actions.allocate.error} />
          <Button
            onClick={() =>
              actions.allocate.mutate(
                { allocations: [{ invoiceId, amount }] },
                {
                  onSuccess: () => {
                    setShowAlloc(false);
                    setInvoiceId('');
                    setAmount('');
                  },
                },
              )
            }
            disabled={!invoiceId || !amount || actions.allocate.isPending}
          >
            {actions.allocate.isPending ? 'Allocating…' : 'Allocate'}
          </Button>
        </Card>
      )}

      {activeAllocs.length > 0 && (
        <Card className="p-0">
          <div className="border-b px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
            Applied to
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {activeAllocs.map((a) => (
                <tr key={a.id}>
                  <td className="px-3 py-2">
                    <Link
                      href={`/finance/invoices/${a.invoiceId}`}
                      className="font-mono text-xs text-primary"
                    >
                      {a.invoiceNumber}
                    </Link>
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

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold tabular-nums ${
          tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''
        }`}
      >
        {value}
      </div>
    </div>
  );
}
