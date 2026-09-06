'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { fmtMoney, Select, SupplyStatusBadge, Table, Pager } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { useCustomers } from '@/lib/commercial/use-commercial';
import { useCreditNotes, useCreateCreditNote, useInvoices } from '@/lib/finance/use-finance';

export default function CreditNotesPage() {
  const router = useRouter();
  const perms = usePermissions();
  const canCreate = perms.includes('finance.credit_notes.create');

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const list = useCreditNotes({ status: status || undefined, page });

  const customers = useCustomers({ pageSize: 100 });
  const create = useCreateCreditNote();
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ customerId: '', invoiceId: '', amount: '', reason: '' });
  const invoices = useInvoices({ customerId: form.customerId || undefined });

  const submit = async () => {
    const cn = await create.mutateAsync({
      customerId: form.customerId,
      invoiceId: form.invoiceId || undefined,
      amount: form.amount,
      reason: form.reason,
    });
    router.push(`/finance/credit-notes/${cn.id}`);
  };

  const total = list.data?.total ?? 0;
  const pageSize = list.data?.pageSize ?? 20;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit notes"
        description="Adjustments that reduce a customer’s receivable."
      >
        {canCreate && (
          <Button size="sm" onClick={() => setShowNew((v) => !v)}>
            {showNew ? 'Close' : 'New credit note'}
          </Button>
        )}
      </PageHeader>

      {showNew && canCreate && (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Customer"
              value={form.customerId}
              onChange={(e) =>
                setForm((f) => ({ ...f, customerId: e.target.value, invoiceId: '' }))
              }
            >
              <option value="">Select…</option>
              {(customers.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.number})
                </option>
              ))}
            </Select>
            <Select
              label="Invoice (optional)"
              value={form.invoiceId}
              onChange={(e) => setForm((f) => ({ ...f, invoiceId: e.target.value }))}
            >
              <option value="">Not linked to an invoice</option>
              {(invoices.data?.items ?? [])
                .filter((i) => ['ISSUED', 'PARTIALLY_PAID', 'PAID'].includes(i.status))
                .map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number} — {fmtMoney(i.amountOutstanding)} outstanding
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
              <span className="text-xs font-medium text-muted-foreground">Reason</span>
              <input
                className="h-9 w-full rounded-md border px-3 text-sm"
                value={form.reason}
                onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              />
            </label>
          </div>
          <ErrorNote error={create.error} />
          <Button
            onClick={submit}
            disabled={!form.customerId || !form.amount || !form.reason.trim() || create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create draft'}
          </Button>
        </Card>
      )}

      <div className="w-40">
        <Select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {['DRAFT', 'ISSUED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading && <Skeleton rows={5} />}
      {list.error && <ErrorNote error={list.error} />}

      {list.data && (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 text-left font-medium">Credit note</th>
                <th className="px-3 py-2 text-left font-medium">Customer</th>
                <th className="px-3 py-2 text-left font-medium">Invoice</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            }
          >
            {list.data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No credit notes.
                </td>
              </tr>
            )}
            {list.data.items.map((cn) => (
              <tr key={cn.id} className="border-t hover:bg-accent/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/finance/credit-notes/${cn.id}`}
                    className="font-mono text-xs text-primary"
                  >
                    {cn.number}
                  </Link>
                </td>
                <td className="px-3 py-2 text-sm">{cn.customerName ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {cn.invoiceNumber ?? '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtMoney(cn.amount)} {cn.currency}
                </td>
                <td className="px-3 py-2">
                  <SupplyStatusBadge status={cn.status} />
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
