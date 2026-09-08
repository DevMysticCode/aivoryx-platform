'use client';

import Link from 'next/link';
import { cn } from '@aivoryx/ui';
import { StatusBadge } from '@/components/admin/ui';
import { useCrmOverview, LEAD_STATUSES } from '@/lib/crm/use-crm-overview';
import { WidgetCard, WidgetError, WidgetSkeleton, WidgetStat } from './widget-card';

const STATUS_LABEL: Record<string, string> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  DISQUALIFIED: 'Disq.',
  CONVERTED: 'Converted',
};

export function CrmPipelineWidget() {
  const o = useCrmOverview();
  const max = Math.max(1, ...LEAD_STATUSES.map((s) => o.byStatus[s]));
  return (
    <WidgetCard title="Lead pipeline" href="/crm/leads" linkLabel="All leads">
      {o.isLoading ? (
        <WidgetSkeleton />
      ) : o.error ? (
        <WidgetError onRetry={o.refetch} />
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <WidgetStat label="Total" value={o.total} />
            <WidgetStat label="Open" value={o.open} />
            <WidgetStat label="Conversion" value={`${o.conversionRate}%`} tone="good" />
          </div>
          <ul className="space-y-1.5">
            {LEAD_STATUSES.map((s) => (
              <li key={s}>
                <Link
                  href={`/crm/leads?status=${s}`}
                  className="flex items-center gap-2 text-xs hover:opacity-80"
                >
                  <span className="w-16 shrink-0 text-muted-foreground">{STATUS_LABEL[s]}</span>
                  <span className="relative h-3 flex-1 overflow-hidden rounded bg-secondary">
                    <span
                      className={cn(
                        'absolute inset-y-0 left-0 rounded',
                        s === 'CONVERTED'
                          ? 'bg-emerald-500'
                          : s === 'DISQUALIFIED'
                            ? 'bg-destructive/70'
                            : 'bg-primary',
                      )}
                      style={{ width: `${(o.byStatus[s] / max) * 100}%` }}
                    />
                  </span>
                  <span className="w-6 shrink-0 text-right tabular-nums">{o.byStatus[s]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </WidgetCard>
  );
}

export function CrmFollowupsWidget() {
  const o = useCrmOverview();
  return (
    <WidgetCard title="Recent leads" href="/crm" linkLabel="CRM overview">
      {o.isLoading ? (
        <WidgetSkeleton />
      ) : o.error ? (
        <WidgetError onRetry={o.refetch} />
      ) : o.recent.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No leads yet.{' '}
          <Link href="/crm/leads?new=1" className="font-medium text-primary hover:underline">
            Create one
          </Link>
        </p>
      ) : (
        <ul className="divide-y">
          {o.recent.slice(0, 6).map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/crm/leads/${lead.id}`}
                className="flex items-center justify-between gap-2 py-2 text-sm hover:opacity-80"
              >
                <span className="min-w-0 truncate">
                  {lead.name ?? lead.phone ?? 'Unnamed lead'}
                </span>
                <StatusBadge status={lead.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
