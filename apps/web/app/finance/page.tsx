'use client';

import Link from 'next/link';
import { PageHeader, ErrorNote, Skeleton } from '@/components/admin/ui';
import { fmtMoney } from '@/components/supply/ui';
import { useFinanceOverview } from '@/lib/finance/use-finance';

/** Finance overview — workspace totals by currency (Phase 9, ADR 0038). */
export default function FinanceOverviewPage() {
  const q = useFinanceOverview();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Invoiced, paid and outstanding across the workspace."
      />
      {q.isLoading && <Skeleton rows={3} />}
      {q.error && <ErrorNote error={q.error} />}

      {q.data && q.data.byCurrency.length === 0 && (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          No issued invoices yet.{' '}
          <Link href="/finance/invoices" className="text-primary underline">
            Create one
          </Link>
          .
        </div>
      )}

      {q.data?.byCurrency.map((s) => (
        <div key={s.currency} className="rounded-lg border bg-card p-4">
          <div className="mb-3 text-sm font-semibold">
            {s.currency}
            <span className="ml-2 font-normal text-muted-foreground">
              {s.invoiceCount} invoice{s.invoiceCount === 1 ? '' : 's'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Invoiced" value={fmtMoney(s.invoicedTotal)} />
            <Stat label="Paid" value={fmtMoney(s.paidTotal)} tone="pos" />
            <Stat label="Outstanding" value={fmtMoney(s.outstandingTotal)} />
            <Stat
              label={`Overdue (${s.overdueCount})`}
              value={fmtMoney(s.overdueTotal)}
              tone={Number(s.overdueTotal) > 0 ? 'neg' : undefined}
            />
          </div>
          {Number(s.creditedTotal) > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Credited: {fmtMoney(s.creditedTotal)} {s.currency}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold tabular-nums ${
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
  );
}
