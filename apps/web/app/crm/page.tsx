'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlarmClock,
  CalendarCheck,
  CalendarClock,
  CalendarX2,
  ClipboardList,
  FileClock,
  FileText,
  Filter,
  Inbox,
  LineChart,
  Plus,
  Send,
  Target,
  TrendingUp,
  UserRoundX,
  Users,
} from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { StatusBadge } from '@/components/admin/ui';
import { ReportChart } from '@/components/charts/report-chart';
import { ModuleWelcome } from '@/components/help/module-welcome';
import {
  type ActionCenterItem,
  DashboardActionCenter,
  DashboardCard,
  DashboardEmptyState,
  DashboardGrid,
  DashboardHeader,
  DashboardKpiCard,
  DashboardKpiGrid,
  DashboardList,
  DashboardListItem,
  DashboardRangeToggle,
  DashboardSection,
  DashboardShell,
} from '@/components/dashboard-kit';
import { ConversionFunnel, SourceBars, STAGE_LABEL } from '@/components/crm/dashboard/visuals';
import { TeamPerformanceTable } from '@/components/crm/dashboard/sources-team';
import { ActivityFeed } from '@/components/crm/dashboard/activity';
import { useCrmAnalytics } from '@/lib/crm/use-crm-analytics';
import { useCrossModuleAccess } from '@/lib/navigation/use-cross-module';
import { useVisitSummary } from '@/lib/field/use-field';
import { useQuotationPipelineSummary } from '@/lib/commercial/use-commercial';

const RANGES = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
] as const;
type Range = (typeof RANGES)[number]['value'];

/** Compact pipeline: the real count per stage, each bar a link to the filtered lead list. */
function PipelineBars({ funnel }: { funnel: { stage: string; count: number }[] }) {
  const max = Math.max(1, ...funnel.map((s) => s.count));
  return (
    <ul className="space-y-3">
      {funnel.map((s) => (
        <li key={s.stage}>
          <Link
            href={`/crm/leads?status=${s.stage}`}
            className="group block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground group-hover:text-foreground">
                {STAGE_LABEL[s.stage] ?? s.stage}
              </span>
              <span className="font-semibold tabular-nums">{s.count}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-[width] group-hover:bg-primary-hover"
                style={{ width: `${s.count === 0 ? 0 : Math.max(3, (s.count / max) * 100)}%` }}
              />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Follow-up action center: real counts from the CRM analytics, plus (where the
 * caller has access) the real counts owned by Field and Commercial. Rows with
 * nothing to do stay quiet; every row with a destination is a link.
 */
function FollowupCenter({
  followups,
}: {
  followups: NonNullable<ReturnType<typeof useCrmAnalytics>['data']>['followups'];
}) {
  const access = useCrossModuleAccess();
  const visits = useVisitSummary(access.fieldVisits);
  const pipeline = useQuotationPipelineSummary(access.quotations);

  const items: ActionCenterItem[] = [
    {
      key: 'overdue',
      label: 'Overdue follow-ups',
      hint: 'Past their due date',
      count: followups.overdueCount,
      icon: AlarmClock,
      tone: 'red',
      href: '/crm/leads',
    },
    {
      key: 'today',
      label: 'Due today',
      count: followups.dueTodayCount,
      icon: CalendarCheck,
      tone: 'amber',
      href: '/crm/leads',
    },
    {
      key: 'upcoming',
      label: 'Upcoming follow-ups',
      count: followups.upcomingCount,
      icon: CalendarClock,
      tone: 'blue',
      href: '/crm/leads',
    },
  ];
  if (access.fieldVisits && visits.data && !visits.isError) {
    items.push(
      {
        key: 'visits-outcome',
        label: 'Visits awaiting an outcome',
        hint: 'Completed, no outcome recorded',
        count: visits.data.awaitingOutcome,
        icon: ClipboardList,
        tone: 'orange',
        href: '/crm/visits',
      },
      {
        key: 'visits-followup',
        label: 'Visits needing follow-up',
        count: visits.data.followUpRequired,
        icon: CalendarX2,
        tone: 'amber',
        href: '/crm/visits',
      },
      {
        key: 'visits-next',
        label: 'Visits in the next 7 days',
        count: visits.data.scheduledNext7Days,
        icon: CalendarClock,
        tone: 'blue',
        href: '/crm/visits',
      },
    );
  }
  if (access.quotations && pipeline.data && !pipeline.isError) {
    items.push(
      {
        key: 'q-await',
        label: 'Qualified leads awaiting a quotation',
        count: pipeline.data.qualifiedAwaitingQuotation,
        icon: FileClock,
        tone: 'purple',
        href: '/crm/leads?status=QUALIFIED',
      },
      {
        key: 'q-draft',
        label: 'Quotation drafts',
        count: pipeline.data.draft,
        icon: FileText,
        tone: 'teal',
        href: '/quotations',
      },
      {
        key: 'q-sent',
        label: 'Sent, awaiting response',
        count: pipeline.data.sentAwaitingResponse,
        icon: Send,
        tone: 'blue',
        href: '/quotations',
      },
    );
  }

  const next = [...followups.overdue, ...followups.dueToday, ...followups.upcoming].slice(0, 4);

  return (
    <div className="space-y-3">
      <DashboardActionCenter
        items={items}
        allClearText="No follow-ups pending. You’re all caught up."
      />
      {next.length > 0 ? (
        <div className="-mx-4 border-t border-border-subtle pt-1">
          <DashboardList>
            {next.map((f) => (
              <DashboardListItem
                key={f.followupId}
                href={`/crm/leads/${f.leadId}`}
                title={f.leadName ?? 'Unnamed lead'}
                subtitle={f.note ?? undefined}
                trailing={
                  <span className="text-muted-foreground">
                    {new Date(f.dueAt).toLocaleDateString()}
                  </span>
                }
                tone="amber"
              />
            ))}
          </DashboardList>
        </div>
      ) : null}
    </div>
  );
}

export default function CrmOverviewPage() {
  const [days, setDays] = useState<Range>(30);
  const { data, isLoading, error, refetch } = useCrmAnalytics(days);

  return (
    <DashboardShell>
      <DashboardHeader
        title="CRM overview"
        description="Your sales pipeline at a glance."
        controls={
          <DashboardRangeToggle
            value={days}
            options={[...RANGES]}
            onChange={setDays}
            label="Date range for trends and sources"
          />
        }
        actions={
          <Link
            href="/crm/leads?new=1"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="size-4" aria-hidden /> New lead
          </Link>
        }
      />

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
          <DashboardKpiGrid>
            <DashboardKpiCard
              label="Total leads"
              value={data.totals.total}
              icon={Users}
              tone="teal"
              description={`${data.totals.open} open`}
              href="/crm/leads"
            />
            <DashboardKpiCard
              label="Open"
              value={data.totals.open}
              icon={Inbox}
              tone="blue"
              description="New · Assigned · Contacted"
              href="/crm/leads"
            />
            <DashboardKpiCard
              label="Unassigned"
              value={data.totals.unassigned}
              icon={UserRoundX}
              tone="amber"
              description={data.totals.unassigned > 0 ? 'Need an owner' : 'Every lead has an owner'}
              href="/crm/leads"
            />
            <DashboardKpiCard
              label="New this week"
              value={data.trendDelta?.thisWeek ?? null}
              emptyText="No weekly comparison available"
              icon={TrendingUp}
              tone="green"
              description={
                data.trendDelta ? `${data.trendDelta.previousWeek} the week before` : undefined
              }
              delta={
                data.trendDelta && data.trendDelta.changePct !== null
                  ? { changePct: data.trendDelta.changePct, label: 'vs prior week' }
                  : null
              }
            />
          </DashboardKpiGrid>

          <DashboardSection label="Primary work">
            <DashboardGrid cols={3}>
              <DashboardCard
                title="Pipeline"
                icon={Filter}
                tone="teal"
                href="/crm/leads"
                linkLabel="All leads"
              >
                <PipelineBars funnel={data.funnel} />
              </DashboardCard>
              <DashboardCard
                title="Lead activity trend"
                description={`Leads created, last ${days} days`}
                icon={LineChart}
                tone="blue"
                href="/reports/crm-lead-trend"
                linkLabel="Report"
              >
                <ReportChart
                  id="crm-lead-trend"
                  range={days}
                  onRangeChange={(v) => setDays(v as Range)}
                  hideRanges
                />
              </DashboardCard>
              <DashboardCard
                title="Follow-up action center"
                icon={AlarmClock}
                tone="amber"
                className="md:col-span-2 xl:col-span-1"
              >
                <FollowupCenter followups={data.followups} />
              </DashboardCard>
            </DashboardGrid>
          </DashboardSection>

          <DashboardSection label="Analysis">
            <DashboardGrid cols={2}>
              <DashboardCard
                title="Conversion funnel"
                description="Share of leads reaching each stage"
                icon={Target}
                tone="green"
              >
                <ConversionFunnel funnel={data.funnel} />
              </DashboardCard>
              <DashboardCard
                title="Lead source performance"
                description={`Last ${days} days`}
                icon={ClipboardList}
                tone="purple"
                href="/reports/crm-lead-sources"
                linkLabel="Report"
              >
                <SourceBars sources={data.sources} />
              </DashboardCard>
            </DashboardGrid>
            {data.team !== null ? (
              <DashboardCard title="Team performance" icon={Users} tone="orange">
                <TeamPerformanceTable team={data.team} />
              </DashboardCard>
            ) : null}
          </DashboardSection>

          <DashboardSection label="Recent activity">
            <DashboardGrid cols={2}>
              <DashboardCard
                title="Recent leads"
                icon={Inbox}
                tone="teal"
                href="/crm/leads"
                linkLabel="Open leads"
                padded={false}
              >
                {data.recent.length === 0 ? (
                  <div className="p-4">
                    <DashboardEmptyState
                      title="No leads yet"
                      description="Leads from your configured sources will appear here."
                      action={
                        <Link
                          href="/crm/leads?new=1"
                          className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-surface-hover"
                        >
                          <Plus className="size-4" aria-hidden /> Create lead
                        </Link>
                      }
                    />
                  </div>
                ) : (
                  <DashboardList>
                    {data.recent.map((lead) => (
                      <DashboardListItem
                        key={lead.id}
                        href={`/crm/leads/${lead.id}`}
                        title={lead.name ?? lead.phone ?? 'Unnamed lead'}
                        subtitle={[lead.sourceName ?? 'Manual', lead.assigneeName]
                          .filter(Boolean)
                          .join(' · ')}
                        trailing={
                          <>
                            <StatusBadge status={lead.status} />
                            <span className="text-muted-foreground">
                              {new Date(lead.updatedAt).toLocaleDateString()}
                            </span>
                          </>
                        }
                      />
                    ))}
                  </DashboardList>
                )}
              </DashboardCard>
              <DashboardCard title="Activity" icon={LineChart} tone="blue">
                <ActivityFeed activity={data.recentActivity} />
              </DashboardCard>
            </DashboardGrid>
          </DashboardSection>
        </>
      )}
    </DashboardShell>
  );
}
