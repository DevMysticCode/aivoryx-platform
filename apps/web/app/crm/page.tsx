'use client';

import Link from 'next/link';
import { Inbox, Plus, TrendingUp, UserRoundX, Users } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/admin/ui';
import { ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { Kpi } from '@/components/dashboard/kpi';
import { WidgetCard, WidgetSkeleton } from '@/components/dashboard/widget-card';
import { useCrmAnalytics } from '@/lib/crm/use-crm-analytics';
import { useCrossModuleAccess } from '@/lib/navigation/use-cross-module';
import { useVisitSummary } from '@/lib/field/use-field';
import { useQuotationPipelineSummary } from '@/lib/commercial/use-commercial';
import { PipelineVisualization, ConversionFunnelTable } from '@/components/crm/dashboard/pipeline';
import { ReportChart } from '@/components/charts/report-chart';
import { ModuleWelcome } from '@/components/help/module-welcome';
import { FollowupActionCenter } from '@/components/crm/dashboard/followups';
import {
  SourcePerformanceTable,
  TeamPerformanceTable,
} from '@/components/crm/dashboard/sources-team';
import { ActivityFeed } from '@/components/crm/dashboard/activity';

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

/** One count row that links to the screen that owns the work. */
function CountRow({ href, label, value }: { href: string; label: string; value: number }) {
  return (
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-3 rounded-sm py-2 text-sm hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="min-w-0">{label}</span>
        <span className="shrink-0 font-semibold tabular-nums">{value}</span>
      </Link>
    </li>
  );
}

/** Field visits + quotation pipeline — real counts from the owning modules, shown only where the caller has access. */
function CrossModuleWidgets() {
  const access = useCrossModuleAccess();
  const visits = useVisitSummary(access.fieldVisits);
  const pipeline = useQuotationPipelineSummary(access.quotations);
  const showVisits = access.fieldVisits && !visits.isError;
  const showPipeline = access.quotations && !pipeline.isError;
  if (!showVisits && !showPipeline) return null;

  return (
    <SectionGroup label="Field & quotations">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {showVisits ? (
          <WidgetCard title="Field visits" href="/crm/visits" linkLabel="All visits">
            {visits.data ? (
              <ul className="divide-y">
                <CountRow
                  href="/crm/visits"
                  label="Scheduled in the next 7 days"
                  value={visits.data.scheduledNext7Days}
                />
                <CountRow
                  href="/crm/visits"
                  label="Completed, awaiting an outcome"
                  value={visits.data.awaitingOutcome}
                />
                <CountRow
                  href="/crm/visits"
                  label="Follow-up required"
                  value={visits.data.followUpRequired}
                />
              </ul>
            ) : (
              <WidgetSkeleton rows={3} />
            )}
          </WidgetCard>
        ) : null}
        {showPipeline ? (
          <WidgetCard title="Quotation pipeline" href="/quotations" linkLabel="All quotations">
            {pipeline.data ? (
              <ul className="divide-y">
                <CountRow
                  href="/crm/leads?status=QUALIFIED"
                  label="Qualified leads awaiting a quotation"
                  value={pipeline.data.qualifiedAwaitingQuotation}
                />
                <CountRow href="/quotations" label="Drafts" value={pipeline.data.draft} />
                <CountRow
                  href="/quotations"
                  label="Sent, awaiting response"
                  value={pipeline.data.sentAwaitingResponse}
                />
              </ul>
            ) : (
              <WidgetSkeleton rows={3} />
            )}
          </WidgetCard>
        ) : null}
      </div>
    </SectionGroup>
  );
}

export default function CrmOverviewPage() {
  const { data, isLoading, error, refetch } = useCrmAnalytics(30);

  return (
    <div className="space-y-6">
      <PageHeader title="CRM overview" description="Your sales pipeline at a glance.">
        <Link
          href="/crm/leads?new=1"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          <Plus className="size-4" aria-hidden /> New lead
        </Link>
      </PageHeader>

      <ModuleWelcome
        id="crm"
        show={!!data && data.totals.total === 0}
        title="Welcome to CRM"
        description="Leads are prospects you track through your sales pipeline. Add them by hand or connect a source, assign an owner, and keep every one moving with follow-ups."
        steps={[
          'Add your first lead',
          'Assign an owner and schedule a follow-up',
          'Watch it move through your pipeline',
        ]}
        action={{ label: 'Add your first lead', href: '/crm/leads?new=1' }}
      />

      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock error={error} onRetry={refetch} />
      ) : !data ? null : (
        <>
          {/* Key metrics — a single quiet bordered strip, not a card per fact. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border-subtle bg-surface px-4 py-3 sm:grid-cols-4">
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

          <CrossModuleWidgets />

          {/* Analysis — diagnostic/secondary information, visually the same
              weight as Primary work (no extra border/shadow) but positioned
              and labelled as the quieter, "look into it" tier. */}
          <SectionGroup label="Analysis">
            <div className="space-y-4">
              <WidgetCard title="Lead activity trend">
                <ReportChart id="crm-lead-trend" />
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
                  <EmptyState
                    title="No leads yet"
                    action={
                      <Link
                        href="/crm/leads?new=1"
                        className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-surface-hover"
                      >
                        <Plus className="size-4" aria-hidden /> Create lead
                      </Link>
                    }
                  >
                    New prospects from your connected sources, or ones you add yourself, are listed
                    here.
                  </EmptyState>
                ) : (
                  <ul className="divide-y">
                    {data.recent.map((lead) => (
                      <li key={lead.id}>
                        <Link
                          href={`/crm/leads/${lead.id}`}
                          className="flex items-center justify-between gap-3 py-2 text-sm transition-colors hover:bg-surface-hover"
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
