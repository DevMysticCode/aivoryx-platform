'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useAccess } from '@/lib/navigation/use-access';
import { getCrmAnalyticsOverview } from '@/lib/api/crm-analytics';
import { fieldKeys } from '@/lib/field/use-field';
import * as fieldApi from '@/lib/api/field';
import { hrKeys } from '@/lib/hr/use-hr';
import * as hrApi from '@/lib/api/hr';
import { financeKeys } from '@/lib/finance/use-finance';
import * as financeApi from '@/lib/api/finance';
import { WidgetCard, WidgetSkeleton } from './widget-card';

/**
 * Global Dashboard "Attention required" (Phase 13D §5) — cross-module items
 * that need action, each sourced from that module's own existing read
 * surface and shown only when the module is entitled and the permission is
 * held. No item here is estimated; every count is a real query result.
 */
export function AttentionRequiredWidget() {
  const access = useAccess();

  const showCrm = access.hasModule('CRM') && access.can('crm.leads.read');
  const showHr =
    access.hasModule('HR') && (access.can('hr.leave.approve') || access.can('hr.expense.approve'));
  const showFinance = access.hasModule('FINANCE') && access.can('finance.invoices.read');

  const crm = useQuery({
    queryKey: ['crm', 'analytics', 'overview', 30],
    queryFn: () => getCrmAnalyticsOverview(30),
    enabled: showCrm,
  });
  const hr = useQuery({ queryKey: hrKeys.dashboard, queryFn: hrApi.hrDashboard, enabled: showHr });
  const finance = useQuery({
    queryKey: financeKeys.overview,
    queryFn: financeApi.financeOverview,
    enabled: showFinance,
  });

  const isLoading =
    (showCrm && crm.isLoading) || (showHr && hr.isLoading) || (showFinance && finance.isLoading);

  const items: { key: string; href: string; label: string; count: number }[] = [];
  if (showCrm && crm.data && crm.data.followups.overdueCount > 0) {
    items.push({
      key: 'crm-overdue',
      href: '/crm',
      label: 'Overdue follow-ups',
      count: crm.data.followups.overdueCount,
    });
  }
  if (showHr && hr.data) {
    if (access.can('hr.leave.approve') && hr.data.pendingLeaveApprovals > 0) {
      items.push({
        key: 'hr-leave',
        href: '/hr/leave',
        label: 'Leave approvals',
        count: hr.data.pendingLeaveApprovals,
      });
    }
    if (access.can('hr.expense.approve') && hr.data.pendingExpenseApprovals > 0) {
      items.push({
        key: 'hr-expense',
        href: '/hr/expenses',
        label: 'Expense approvals',
        count: hr.data.pendingExpenseApprovals,
      });
    }
  }
  if (showFinance && finance.data) {
    const overdue = finance.data.byCurrency.reduce((a, r) => a + r.overdueCount, 0);
    if (overdue > 0) {
      items.push({
        key: 'finance-overdue',
        href: '/finance/invoices',
        label: 'Overdue invoices',
        count: overdue,
      });
    }
  }

  if (!showCrm && !showHr && !showFinance) return null;

  return (
    <WidgetCard title="Attention required">
      {isLoading ? (
        <WidgetSkeleton />
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing needs your attention right now.</p>
      ) : (
        <ul className="divide-y">
          {items.map((i) => (
            <li key={i.key}>
              <Link
                href={i.href}
                className="flex items-center justify-between gap-2 py-2 text-sm hover:opacity-80"
              >
                <span>{i.label}</span>
                <span className="font-semibold text-amber-600 tabular-nums dark:text-amber-400">
                  {i.count}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

/**
 * Global Dashboard "Upcoming work" (Phase 13D §5) — CRM follow-ups due soon
 * plus Field visits scheduled soon, each gated the same way as above.
 */
export function UpcomingWorkWidget() {
  const access = useAccess();

  const showCrm = access.hasModule('CRM') && access.can('crm.leads.read');
  const showField = access.hasModule('FIELD') && access.can('field.visits.read');

  const crm = useQuery({
    queryKey: ['crm', 'analytics', 'overview', 30],
    queryFn: () => getCrmAnalyticsOverview(30),
    enabled: showCrm,
  });
  const visits = useQuery({
    queryKey: fieldKeys.visits({ status: 'SCHEDULED', pageSize: 5 }),
    queryFn: () => fieldApi.listVisits({ status: 'SCHEDULED', pageSize: 5 }),
    enabled: showField,
  });

  if (!showCrm && !showField) return null;

  const crmUpcoming = crm.data?.followups.dueToday.length ?? 0;
  const fieldUpcoming = showField ? (visits.data?.items ?? []) : [];
  const isLoading = (showCrm && crm.isLoading) || (showField && visits.isLoading);

  const nothing = crmUpcoming === 0 && fieldUpcoming.length === 0;

  return (
    <WidgetCard title="Upcoming work">
      {isLoading ? (
        <WidgetSkeleton />
      ) : nothing ? (
        <p className="text-sm text-muted-foreground">Nothing scheduled for today.</p>
      ) : (
        <div className="space-y-3">
          {showCrm && crmUpcoming > 0 ? (
            <Link
              href="/crm"
              className="flex items-center justify-between text-sm hover:opacity-80"
            >
              <span>Follow-ups due today</span>
              <span className="font-semibold tabular-nums">{crmUpcoming}</span>
            </Link>
          ) : null}
          {fieldUpcoming.length > 0 ? (
            <ul className="divide-y">
              {fieldUpcoming.map((v) => (
                <li key={v.id}>
                  <Link
                    href={`/crm/visits/${v.id}`}
                    className="flex items-center justify-between gap-2 py-1.5 text-sm hover:opacity-80"
                  >
                    <span className="min-w-0 truncate">{v.leadName ?? 'Visit'}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {new Date(v.scheduledAt).toLocaleDateString()}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </WidgetCard>
  );
}
