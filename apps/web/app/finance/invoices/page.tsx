'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { fmtMoney, fmtDate, Select, SupplyStatusBadge, Table, Pager } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { useCustomers } from '@/lib/commercial/use-commercial';
import { useInvoices, useCreateInvoice } from '@/lib/finance/use-finance';

type LineForm = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountValue: string;
  taxRate: string;
};

const emptyLine = (): LineForm => ({
  description: '',
  quantity: '1',
  unitPrice: '0',
  discountValue: '0',
  taxRate: '0',
});

export default function InvoicesPage() {
  const router = useRouter();
  const perms = usePermissions();
  const canCreate = perms.includes('finance.invoices.create');

  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [page, setPage] = useState(1);
  const list = useInvoices({ status: status || undefined, overdue: overdue || undefined, page });

  const customers = useCustomers({ pageSize: 100 });
  const create = useCreateInvoice();
  const [showNew, setShowNew] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<LineForm[]>([emptyLine()]);

  const submit = async () => {
    const inv = await create.mutateAsync({
      customerId,
      dueDate: dueDate || undefined,
      lines: lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        discountType: 'AMOUNT',
        discountValue: l.discountValue,
        taxRate: l.taxRate,
      })),
    });
    router.push(`/finance/invoices/${inv.id}`);
  };

  const total = list.data?.total ?? 0;
  const pageSize = list.data?.pageSize ?? 20;

  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" description="Draft, issue and track customer invoices.">
        {canCreate && (
          <Button size="sm" onClick={() => setShowNew((v) => !v)}>
            {showNew ? 'Close' : 'New invoice'}
          </Button>
        )}
      </PageHeader>

      {showNew && canCreate && (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Customer"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Select a customer…</option>
              {(customers.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.number})
                </option>
              ))}
            </Select>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Due date</span>
              <input
                type="date"
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </label>
          </div>

          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_70px_100px_90px_80px_auto] gap-2">
                <input
                  className="h-8 rounded-md border px-2 text-sm"
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) =>
                    setLines((ls) =>
                      ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)),
                    )
                  }
                />
                <input
                  className="h-8 rounded-md border px-2 text-sm"
                  placeholder="Qty"
                  value={l.quantity}
                  onChange={(e) =>
                    setLines((ls) =>
                      ls.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)),
                    )
                  }
                />
                <input
                  className="h-8 rounded-md border px-2 text-sm"
                  placeholder="Unit price"
                  value={l.unitPrice}
                  onChange={(e) =>
                    setLines((ls) =>
                      ls.map((x, j) => (j === i ? { ...x, unitPrice: e.target.value } : x)),
                    )
                  }
                />
                <input
                  className="h-8 rounded-md border px-2 text-sm"
                  placeholder="Discount"
                  value={l.discountValue}
                  onChange={(e) =>
                    setLines((ls) =>
                      ls.map((x, j) => (j === i ? { ...x, discountValue: e.target.value } : x)),
                    )
                  }
                />
                <input
                  className="h-8 rounded-md border px-2 text-sm"
                  placeholder="Tax rate"
                  value={l.taxRate}
                  onChange={(e) =>
                    setLines((ls) =>
                      ls.map((x, j) => (j === i ? { ...x, taxRate: e.target.value } : x)),
                    )
                  }
                />
                <button
                  type="button"
                  className="text-xs text-destructive hover:underline disabled:opacity-40"
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setLines((ls) => [...ls, emptyLine()])}
            >
              + Add line
            </button>
          </div>

          <ErrorNote error={create.error} />
          <Button
            onClick={submit}
            disabled={!customerId || lines.some((l) => !l.description.trim()) || create.isPending}
          >
            {create.isPending ? 'Creating…' : 'Create draft'}
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
            {['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'VOID'].map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={overdue}
            onChange={(e) => {
              setOverdue(e.target.checked);
              setPage(1);
            }}
          />
          Overdue only
        </label>
      </div>

      {list.isLoading && <Skeleton rows={6} />}
      {list.error && <ErrorNote error={list.error} />}

      {list.data && (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 text-left font-medium">Invoice</th>
                <th className="px-3 py-2 text-left font-medium">Customer</th>
                <th className="px-3 py-2 text-left font-medium">Due</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            }
          >
            {list.data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No invoices.
                </td>
              </tr>
            )}
            {list.data.items.map((inv) => (
              <tr key={inv.id} className="border-t hover:bg-accent/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/finance/invoices/${inv.id}`}
                    className="font-mono text-xs text-primary"
                  >
                    {inv.number}
                  </Link>
                </td>
                <td className="px-3 py-2 text-sm">{inv.customerName ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(inv.dueDate)}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtMoney(inv.grandTotal)} {inv.currency}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtMoney(inv.amountOutstanding)}
                </td>
                <td className="px-3 py-2">
                  <SupplyStatusBadge status={inv.status} />
                  {inv.overdue && (
                    <span className="ml-1 rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] text-destructive">
                      {inv.daysOverdue}d
                    </span>
                  )}
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
