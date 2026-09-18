'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Inbox, Plus, TrendingUp, UserRoundX, Users } from 'lucide-react';
import { PageHeader } from '@/components/admin/ui';
import { ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { Kpi } from '@/components/dashboard/kpi';
import { WidgetCard } from '@/components/dashboard/widget-card';
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

/** Matches the global Dashboard's section-eyebrow treatment (app/page.tsx) —
 *  the same visual grouping device, so the two dashboards read as one product. */
function SectionGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h2>
      {children}
    </div>
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
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
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
          {/* Key metrics — the hero: the one section given a touch more
              visual weight (a card, not just bare KPIs) than everything below it. */}
          <div className="grid grid-cols-2 gap-4 rounded-lg border bg-card p-4 sm:grid-cols-4">
            <Kpi
              label="Total leads"
              value={data.totals.total}
              icon={<Users className="size-3.5" />}
            />
            <Kpi
              label="Open"
              value={data.totals.open}
              hint="New · Assigned · Contacted"
              icon={<Inbox className="size-3.5" />}
            />
            <Kpi
              label="Unassigned"
              value={data.totals.unassigned}
              icon={<UserRoundX className="size-3.5" />}
            />
            <Kpi
              label="New this week"
              value={data.trendDelta?.thisWeek ?? '—'}
              delta={data.trendDelta}
              icon={<TrendingUp className="size-3.5" />}
            />
          </div>

          {/* Primary work — what needs attention and where the pipeline stands right now. */}
          <SectionGroup label="Primary work">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <WidgetCard title="Pipeline" href="/crm/leads" linkLabel="All leads">
                <PipelineVisualization funnel={data.funnel} />
              </WidgetCard>
              <WidgetCard title="Follow-up action center">
                <FollowupActionCenter followups={data.followups} />
              </WidgetCard>
            </div>
          </SectionGroup>

          {/* Analysis — diagnostic/secondary information, visually the same
              weight as Primary work (no extra border/shadow) but positioned
              and labelled as the quieter, "look into it" tier. */}
          <SectionGroup label="Analysis">
            <div className="space-y-4">
              <WidgetCard
                title="Lead activity trend"
                action={
                  <div className="flex gap-1">
                    {RANGES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setDays(r)}
                        className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
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
              </WidgetCard>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <WidgetCard title="Lead source performance">
                  <SourcePerformanceTable sources={data.sources} />
                </WidgetCard>
                <WidgetCard title="Conversion funnel">
                  <ConversionFunnelTable funnel={data.funnel} />
                </WidgetCard>
              </div>

              {data.team !== null ? (
                <WidgetCard title="Team performance">
                  <TeamPerformanceTable team={data.team} />
                </WidgetCard>
              ) : null}
            </div>
          </SectionGroup>

          {/* Recent activity — the trailing, lowest-priority tier. */}
          <SectionGroup label="Recent activity">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <WidgetCard title="Recent leads" href="/crm/leads" linkLabel="Open leads">
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
                          className="flex items-center justify-between gap-3 py-2 text-sm transition-colors hover:bg-accent/40"
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
              </WidgetCard>
              <WidgetCard title="Activity">
                <ActivityFeed activity={data.recentActivity} />
              </WidgetCard>
            </div>
          </SectionGroup>
        </>
      )}
    </div>
  );
}
