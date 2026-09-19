'use client';

import Link from 'next/link';
import { PageHeader, Skeleton, EmptyState } from '@/components/admin/ui';
import { ErrorBlock } from '@/components/ui/kit';
import { fmtMoney } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { useFinanceOverview } from '@/lib/finance/use-finance';

/** Finance overview — workspace totals by currency (Phase 9, ADR 0038). */
export default function FinanceOverviewPage() {
  const q = useFinanceOverview();
  const canCreate = usePermissions().includes('finance.invoices.create');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="Invoiced, paid and outstanding across the workspace."
      >
        <Link
          href="/finance/invoices"
          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          {canCreate ? 'Invoices' : 'View invoices'}
        </Link>
      </PageHeader>
      {q.isLoading && <Skeleton rows={3} />}
      {q.error && <ErrorBlock error={q.error} onRetry={() => q.refetch()} />}

      {q.data && q.data.byCurrency.length === 0 && (
        <EmptyState
          title="No issued invoices yet"
          action={
            <Link href="/finance/invoices" className="text-primary hover:underline">
              {canCreate ? 'Create an invoice' : 'Go to invoices'}
            </Link>
          }
        >
          This page totals what you have invoiced, collected and are still owed. It fills in once
          the first invoice is issued.
        </EmptyState>
      )}

      {q.data?.byCurrency.map((s) => (
        <section key={s.currency} aria-label={`${s.currency} totals`} className="space-y-2">
          <h2 className="text-sm font-semibold">
            {s.currency}
            <span className="ml-2 font-normal text-muted-foreground">
              {s.invoiceCount} invoice{s.invoiceCount === 1 ? '' : 's'}
              {Number(s.creditedTotal) > 0
                ? ` · ${fmtMoney(s.creditedTotal)} ${s.currency} credited`
                : ''}
            </span>
          </h2>
          <dl className="grid grid-cols-2 divide-x divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-surface sm:grid-cols-4 sm:divide-y-0">
            <Stat label="Invoiced" value={fmtMoney(s.invoicedTotal)} />
            <Stat label="Paid" value={fmtMoney(s.paidTotal)} tone="pos" />
            <Stat label="Outstanding" value={fmtMoney(s.outstandingTotal)} />
            <Stat
              label={`Overdue (${s.overdueCount})`}
              value={fmtMoney(s.overdueTotal)}
              tone={Number(s.overdueTotal) > 0 ? 'neg' : undefined}
            />
          </dl>
        </section>
      ))}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`text-lg font-semibold tabular-nums ${
          tone === 'pos' ? 'text-success' : tone === 'neg' ? 'text-danger' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
