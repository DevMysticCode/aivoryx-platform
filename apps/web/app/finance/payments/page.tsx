'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { fmtMoney, fmtDate, Select, SupplyStatusBadge, Table, Pager } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { useCustomers } from '@/lib/commercial/use-commercial';
import type { RecordPaymentRequest } from '@aivoryx/contracts';
import { usePayments, useRecordPayment } from '@/lib/finance/use-finance';

export default function PaymentsPage() {
  const router = useRouter();
  const perms = usePermissions();
  const canCreate = perms.includes('finance.payments.create');

  const [status, setStatus] = useState('');
  const [unallocatedOnly, setUnallocatedOnly] = useState(false);
  const [page, setPage] = useState(1);
  const list = usePayments({
    status: status || undefined,
    unallocatedOnly: unallocatedOnly || undefined,
    page,
  });

  const customers = useCustomers({ pageSize: 100 });
  const create = useRecordPayment();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    customerId: '',
    amount: '',
    currency: 'INR',
    method: 'BANK_TRANSFER',
    paymentDate: new Date().toISOString().slice(0, 10),
    reference: '',
  });

  const submit = async () => {
    const p = await create.mutateAsync({
      customerId: form.customerId,
      amount: form.amount,
      currency: form.currency,
      method: form.method as RecordPaymentRequest['method'],
      paymentDate: form.paymentDate,
      reference: form.reference || undefined,
    });
    router.push(`/finance/payments/${p.id}`);
  };

  const total = list.data?.total ?? 0;
  const pageSize = list.data?.pageSize ?? 20;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Record customer payments and allocate them to invoices."
      >
        {canCreate && (
          <Button size="sm" onClick={() => setShowNew((v) => !v)}>
            {showNew ? 'Close' : 'Record payment'}
          </Button>
        )}
      </PageHeader>

      {showNew && canCreate && (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select
              label="Customer"
              value={form.customerId}
              onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}
            >
              <option value="">Select…</option>
              {(customers.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.number})
                </option>
              ))}
            </Select>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Amount</span>
              <input
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Currency</span>
              <input
                className="h-9 w-full rounded-md border px-3 text-sm uppercase"
                maxLength={3}
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Date</span>
              <input
                type="date"
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={form.paymentDate}
                onChange={(e) => setForm((f) => ({ ...f, paymentDate: e.target.value }))}
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Method</span>
              <select
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={form.method}
                onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
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
                value={form.reference}
                onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              />
            </label>
          </div>
          <ErrorNote error={create.error} />
          <Button onClick={submit} disabled={!form.customerId || !form.amount || create.isPending}>
            {create.isPending ? 'Recording…' : 'Record payment'}
          </Button>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="w-40">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {['RECORDED', 'REVERSED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={unallocatedOnly}
            onChange={(e) => {
              setUnallocatedOnly(e.target.checked);
              setPage(1);
            }}
          />
          Unallocated only
        </label>
      </div>

      {list.isLoading && <Skeleton rows={6} />}
      {list.error && <ErrorNote error={list.error} />}

      {list.data && (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 text-left font-medium">Payment</th>
                <th className="px-3 py-2 text-left font-medium">Customer</th>
                <th className="px-3 py-2 text-left font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-right font-medium">Unallocated</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            }
          >
            {list.data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No payments.
                </td>
              </tr>
            )}
            {list.data.items.map((p) => (
              <tr key={p.id} className="border-t hover:bg-accent/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/finance/payments/${p.id}`}
                    className="font-mono text-xs text-primary"
                  >
                    {p.number}
                  </Link>
                </td>
                <td className="px-3 py-2 text-sm">{p.customerName ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {fmtDate(p.paymentDate)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtMoney(p.amount)} {p.currency}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtMoney(p.unallocatedAmount)}
                </td>
                <td className="px-3 py-2">
                  <SupplyStatusBadge status={p.status} />
                </td>
              </tr>
            ))}
          </Table>
          <Pager
            page={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
