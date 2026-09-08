'use client';

import { useHrDashboard } from '@/lib/hr/use-hr';
import { WidgetCard, WidgetError, WidgetSkeleton, WidgetStat } from './widget-card';

export function HrDashboardWidget() {
  const q = useHrDashboard();
  const d = q.data;
  return (
    <WidgetCard title="Workforce" href="/hr" linkLabel="HR">
      {q.isLoading ? (
        <WidgetSkeleton />
      ) : q.error ? (
        <WidgetError onRetry={() => q.refetch()} />
      ) : d ? (
        <div className="grid grid-cols-2 gap-3">
          <WidgetStat label="Active employees" value={d.activeEmployees} />
          <WidgetStat label="Present today" value={d.presentToday} tone="good" />
          <WidgetStat
            label="Leave approvals"
            value={d.pendingLeaveApprovals}
            tone={d.pendingLeaveApprovals > 0 ? 'warn' : 'default'}
          />
          <WidgetStat
            label="Expense approvals"
            value={d.pendingExpenseApprovals}
            tone={d.pendingExpenseApprovals > 0 ? 'warn' : 'default'}
          />
        </div>
      ) : null}
    </WidgetCard>
  );
}
