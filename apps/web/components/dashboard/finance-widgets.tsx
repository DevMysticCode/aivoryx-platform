'use client';

import { useFinanceOverview } from '@/lib/finance/use-finance';
import { WidgetCard, WidgetError, WidgetSkeleton, WidgetStat } from './widget-card';

function money(currency: string, amount: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${currency} ${amount}`;
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

export function FinanceOverviewWidget() {
  const q = useFinanceOverview();
  const rows = q.data?.byCurrency ?? [];
  return (
    <WidgetCard title="Receivables" href="/finance" linkLabel="Finance">
      {q.isLoading ? (
        <WidgetSkeleton />
      ) : q.error ? (
        <WidgetError onRetry={() => q.refetch()} />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No invoices raised yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.currency} className="grid grid-cols-2 gap-3">
              <WidgetStat
                label={`Outstanding (${r.currency})`}
                value={money(r.currency, r.outstandingTotal)}
              />
              <WidgetStat
                label={`Overdue · ${r.overdueCount}`}
                value={money(r.currency, r.overdueTotal)}
                tone={Number(r.overdueTotal) > 0 ? 'danger' : 'default'}
              />
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
