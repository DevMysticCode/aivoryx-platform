'use client';

import Link from 'next/link';
import { ArrowRight, Plus, TrendingUp, Users } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import { PageHeader, StatusBadge } from '@/components/admin/ui';
import { StatCard, ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { useCrmOverview, LEAD_STATUSES } from '@/lib/crm/use-crm-overview';

const STATUS_LABEL: Record<string, string> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  DISQUALIFIED: 'Disqualified',
  CONVERTED: 'Converted',
};

export default function CrmOverviewPage() {
  const o = useCrmOverview();
  const max = Math.max(1, ...LEAD_STATUSES.map((s) => o.byStatus[s]));

  return (
    <div className="space-y-6">
      <PageHeader title="CRM overview" description="Your pipeline at a glance.">
        <Link
          href="/crm/leads?new=1"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          <Plus className="size-4" aria-hidden /> New lead
        </Link>
      </PageHeader>

      {o.isLoading ? (
        <LoadingBlock />
      ) : o.error ? (
        <ErrorBlock error={o.error} onRetry={o.refetch} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Total leads" value={o.total} icon={<Users className="size-4" />} />
            <StatCard label="Open" value={o.open} hint="New · Assigned · Contacted" />
            <StatCard label="Qualified" value={o.byStatus.QUALIFIED} />
            <StatCard
              label="Conversion"
              value={`${o.conversionRate}%`}
              hint={`${o.byStatus.CONVERTED} converted`}
              icon={<TrendingUp className="size-4" />}
            />
          </div>

          <section className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Leads by status</h2>
              <Link
                href="/crm/leads"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                Open leads <ArrowRight className="size-3.5" aria-hidden />
              </Link>
            </div>
            <ul className="space-y-2 p-4">
              {LEAD_STATUSES.map((s) => {
                const n = o.byStatus[s];
                return (
                  <li key={s}>
                    <Link
                      href={`/crm/leads?status=${s}`}
                      className="flex items-center gap-3 text-sm hover:opacity-80"
                    >
                      <span className="w-24 shrink-0 text-muted-foreground">{STATUS_LABEL[s]}</span>
                      <span className="relative h-4 flex-1 overflow-hidden rounded bg-secondary">
                        <span
                          className={cn(
                            'absolute inset-y-0 left-0 rounded',
                            s === 'CONVERTED'
                              ? 'bg-emerald-500'
                              : s === 'DISQUALIFIED'
                                ? 'bg-destructive/70'
                                : 'bg-primary',
                          )}
                          style={{ width: `${(n / max) * 100}%` }}
                        />
                      </span>
                      <span className="w-8 shrink-0 text-right tabular-nums">{n}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-lg border">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold">Recent leads</h2>
            </div>
            {o.recent.length === 0 ? (
              <div className="p-8 text-center text-sm">
                <p className="font-medium">No leads yet</p>
                <p className="mt-1 text-muted-foreground">
                  Leads from your configured sources will appear here.
                </p>
                <Link
                  href="/crm/leads?new=1"
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
                >
                  <Plus className="size-4" aria-hidden /> Create lead
                </Link>
              </div>
            ) : (
              <ul className="divide-y">
                {o.recent.map((lead) => (
                  <li key={lead.id}>
                    <Link
                      href={`/crm/leads/${lead.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-accent/40"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {lead.name ?? lead.phone ?? lead.email ?? 'Unnamed lead'}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[lead.sourceName ?? 'Manual', lead.city].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <StatusBadge status={lead.status} />
                        <span className="hidden text-xs text-muted-foreground sm:block">
                          {new Date(lead.updatedAt).toLocaleDateString()}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
