'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Users } from 'lucide-react';
import { PageHeader } from '@/components/admin/ui';
import { ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { Kpi } from '@/components/dashboard/kpi';
import { useCrmAnalytics } from '@/lib/crm/use-crm-analytics';
import { PipelineVisualization, ConversionFunnelTable } from '@/components/crm/dashboard/pipeline';
import { TrendChart } from '@/components/crm/dashboard/trend-chart';
import { FollowupActionCenter } from '@/components/crm/dashboard/followups';
import {
  SourcePerformanceTable,
  TeamPerformanceTable,
} from '@/components/crm/dashboard/sources-team';
import { ActivityFeed } from '@/components/crm/dashboard/activity';

const RANGES = [7, 30, 90] as const;

function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 rounded-lg border bg-background ${className ?? ''}`}>
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function CrmOverviewPage() {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const { data, isLoading, error, refetch } = useCrmAnalytics(days);

  return (
    <div className="space-y-6">
      <PageHeader title="CRM overview" description="Your sales pipeline at a glance.">
        <Link
          href="/crm/leads?new=1"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          <Plus className="size-4" aria-hidden /> New lead
        </Link>
      </PageHeader>

      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : !data ? null : (
        <>
          {/* Key metrics */}
          <div className="grid grid-cols-2 gap-4 rounded-lg border bg-background p-4 sm:grid-cols-4">
            <Kpi
              label="Total leads"
              value={data.totals.total}
              icon={<Users className="size-3.5" />}
            />
            <Kpi label="Open" value={data.totals.open} hint="New · Assigned · Contacted" />
            <Kpi label="Unassigned" value={data.totals.unassigned} />
            <Kpi
              label="New this week"
              value={data.trendDelta?.thisWeek ?? '—'}
              delta={data.trendDelta}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section
              title="Pipeline"
              action={
                <Link
                  href="/crm/leads"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  All leads
                </Link>
              }
            >
              <PipelineVisualization funnel={data.funnel} />
            </Section>
            <Section title="Follow-up action center">
              <FollowupActionCenter followups={data.followups} />
            </Section>
          </div>

          <Section
            title="Lead activity trend"
            action={
              <div className="flex gap-1">
                {RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setDays(r)}
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      days === r
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {r}d
                  </button>
                ))}
              </div>
            }
          >
            <TrendChart trend={data.trend} />
          </Section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section title="Lead source performance">
              <SourcePerformanceTable sources={data.sources} />
            </Section>
            <Section title="Conversion funnel">
              <ConversionFunnelTable funnel={data.funnel} />
            </Section>
          </div>

          {data.team !== null ? (
            <Section title="Team performance">
              <TeamPerformanceTable team={data.team} />
            </Section>
          ) : null}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Section
              title="Recent leads"
              action={
                <Link
                  href="/crm/leads"
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open leads
                </Link>
              }
            >
              {data.recent.length === 0 ? (
                <div className="py-6 text-center text-sm">
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
                  {data.recent.map((lead) => (
                    <li key={lead.id}>
                      <Link
                        href={`/crm/leads/${lead.id}`}
                        className="flex items-center justify-between gap-3 py-2 text-sm hover:opacity-80"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {lead.name ?? lead.phone ?? 'Unnamed lead'}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[lead.sourceName ?? 'Manual', lead.assigneeName]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {new Date(lead.updatedAt).toLocaleDateString()}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section title="Activity">
              <ActivityFeed activity={data.recentActivity} />
            </Section>
          </div>
        </>
      )}
    </div>
  );
}
