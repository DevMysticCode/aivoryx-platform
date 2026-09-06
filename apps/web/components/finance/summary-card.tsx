'use client';

import Link from 'next/link';
import type { FinancialSummary } from '@aivoryx/contracts';
import { ApiError } from '@/lib/api/client';
import { fmtMoney } from '@/components/supply/ui';
import { useCustomerFinancialSummary, useProjectFinancialSummary } from '@/lib/finance/use-finance';

function Grid({ s }: { s: FinancialSummary }) {
  const cells: [string, string, 'pos' | 'neg' | undefined][] = [
    ['Invoiced', `${fmtMoney(s.invoicedTotal)} ${s.currency}`, undefined],
    ['Paid', fmtMoney(s.paidTotal), 'pos'],
    ['Outstanding', fmtMoney(s.outstandingTotal), undefined],
    [
      `Overdue (${s.overdueCount})`,
      fmtMoney(s.overdueTotal),
      Number(s.overdueTotal) > 0 ? 'neg' : undefined,
    ],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cells.map(([label, value, tone]) => (
        <div key={label}>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div
            className={`text-base font-semibold tabular-nums ${
              tone === 'pos'
                ? 'text-emerald-600 dark:text-emerald-400'
                : tone === 'neg'
                  ? 'text-destructive'
                  : ''
            }`}
          >
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Read-only finance summary for a customer overview (Phase 9, ADR 0038). */
export function CustomerFinanceCard({ customerId }: { customerId: string }) {
  const q = useCustomerFinancialSummary(customerId);
  const forbidden = q.error instanceof ApiError && q.error.status === 403;
  if (forbidden) return null;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Finance</h2>
        <Link
          href={`/finance/invoices?customerId=${customerId}`}
          className="text-xs text-primary hover:underline"
        >
          View invoices
        </Link>
      </div>
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.data && (
        <>
          <Grid s={q.data} />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <MiniList
              title="Recent invoices"
              rows={q.data.recentInvoices.map((i) => ({
                id: i.id,
                href: `/finance/invoices/${i.id}`,
                label: i.number,
                right: `${fmtMoney(i.amountOutstanding)} ${i.currency}`,
                muted: i.status,
              }))}
            />
            <MiniList
              title="Recent payments"
              rows={q.data.recentPayments.map((p) => ({
                id: p.id,
                href: `/finance/payments/${p.id}`,
                label: p.number,
                right: `${fmtMoney(p.amount)} ${p.currency}`,
                muted: p.status,
              }))}
            />
          </div>
        </>
      )}
    </section>
  );
}

/** Read-only finance summary for a project workspace (Phase 9, ADR 0038). */
export function ProjectFinanceCard({ projectId }: { projectId: string }) {
  const q = useProjectFinancialSummary(projectId);
  const forbidden = q.error instanceof ApiError && q.error.status === 403;
  if (forbidden) return null;

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Finance</h2>
        <Link
          href={`/finance/invoices?projectId=${projectId}`}
          className="text-xs text-primary hover:underline"
        >
          View invoices
        </Link>
      </div>
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.data && <Grid s={q.data} />}
    </section>
  );
}

function MiniList({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; href: string; label: string; right: string; muted: string }[];
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{title}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <Link href={r.href} className="font-mono text-xs text-primary hover:underline">
                {r.label}
              </Link>
              <span className="tabular-nums">
                {r.right}
                <span className="ml-1 text-[11px] text-muted-foreground">{r.muted}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
