'use client';

import { PageHeader, ErrorNote, Skeleton } from '@/components/admin/ui';
import { StatCard } from '@/components/hr/ui';
import { useHrDashboard } from '@/lib/hr/use-hr';

/** HR dashboard — the workspace-wide people snapshot (Phase 12, ADR 0041). */
export default function HrDashboardPage() {
  const q = useHrDashboard();

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR & Workforce"
        description="People, attendance, leave, expenses and payroll."
      />

      {q.isLoading && <Skeleton rows={3} />}
      {q.error && <ErrorNote error={q.error} />}

      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Employees" value={q.data.totalEmployees} href="/hr/employees" />
            <StatCard label="Active" value={q.data.activeEmployees} tone="pos" />
            <StatCard label="Present today" value={q.data.presentToday} tone="pos" />
            <StatCard label="On leave today" value={q.data.onLeaveToday} tone="warn" />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Absent today"
              value={q.data.absentToday}
              tone={q.data.absentToday ? 'neg' : undefined}
            />
            <StatCard
              label="Leave approvals pending"
              value={q.data.pendingLeaveApprovals}
              tone={q.data.pendingLeaveApprovals ? 'warn' : undefined}
              href="/hr/leave"
            />
            <StatCard
              label="Expense approvals pending"
              value={q.data.pendingExpenseApprovals}
              tone={q.data.pendingExpenseApprovals ? 'warn' : undefined}
              href="/hr/expenses"
            />
            <StatCard label="Departments" value={q.data.departmentCount} href="/hr/organization" />
          </div>

          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm font-semibold">Current payroll</div>
            {q.data.currentPayroll ? (
              <a
                href={`/hr/payroll/${q.data.currentPayroll.id}`}
                className="mt-1 inline-flex items-center gap-2 text-sm text-primary underline"
              >
                {q.data.currentPayroll.name}
                <span className="text-muted-foreground">({q.data.currentPayroll.status})</span>
              </a>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No open payroll period.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
