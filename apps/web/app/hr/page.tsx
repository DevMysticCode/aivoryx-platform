'use client';

import Link from 'next/link';
import {
  Banknote,
  CalendarCheck,
  CalendarOff,
  ClipboardCheck,
  Clock,
  Hourglass,
  LineChart,
  PieChart,
  Plus,
  Receipt,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { ReportChart } from '@/components/charts/report-chart';
import { ModuleWelcome } from '@/components/help/module-welcome';
import { HrStatusBadge, fmtDate, fmtDateTime } from '@/components/hr/ui';
import {
  DashboardActionCenter,
  DashboardCard,
  DashboardEmptyState,
  DashboardGrid,
  DashboardHeader,
  DashboardKpiCard,
  DashboardKpiGrid,
  DashboardList,
  DashboardListItem,
  DashboardQuickActions,
  DashboardSection,
  DashboardShell,
  type QuickAction,
} from '@/components/dashboard-kit';
import { usePermissions } from '@/components/supply/supply-shell';
import { useHrDashboard } from '@/lib/hr/use-hr';

/** HR dashboard — the workforce snapshot (Phase 12/17, ADR 0041), recomposed in Phase 20. */
export default function HrDashboardPage() {
  const q = useHrDashboard();
  const perms = usePermissions();
  const can = (p: string) => perms.includes(p);
  const d = q.data;

  const candidates: (QuickAction | null)[] = [
    can('hr.employee.create')
      ? { key: 'employee', label: 'Add new employee', href: '/hr/employees', icon: UserPlus }
      : null,
    can('hr.attendance.manage') || can('hr.attendance.correct')
      ? {
          key: 'attendance',
          label: 'Record attendance',
          href: '/hr/attendance',
          icon: Clock,
          tone: 'blue' as const,
        }
      : null,
    can('hr.leave.approve')
      ? {
          key: 'leave',
          label: 'Approve leave',
          href: '/hr/leave',
          icon: CalendarCheck,
          tone: 'green' as const,
        }
      : null,
    can('hr.expense.approve')
      ? {
          key: 'expenses',
          label: 'Process expenses',
          href: '/hr/expenses',
          icon: Receipt,
          tone: 'amber' as const,
        }
      : null,
    can('hr.payroll.process')
      ? {
          key: 'payroll',
          label: 'Run payroll',
          href: '/hr/payroll',
          icon: Wallet,
          tone: 'purple' as const,
        }
      : null,
  ];
  const quickActions = candidates.filter((a): a is QuickAction => a !== null);

  return (
    <DashboardShell>
      <DashboardHeader
        title="HR & Workforce"
        description="People, attendance, leave, expenses and payroll at a glance."
        actions={
          can('hr.employee.create') ? (
            <Link
              href="/hr/employees"
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <Plus className="size-4" aria-hidden /> New employee
            </Link>
          ) : null
        }
      />

      {q.isLoading && <LoadingBlock />}
      {q.error && <ErrorBlock error={q.error} onRetry={() => q.refetch()} />}

      {d && (
        <>
          <ModuleWelcome
            id="hr"
            title="Set up your workforce"
            description="Add employees to track attendance, leave, expenses and payroll in one place."
            steps={[
              'Add your first employee',
              'Assign a manager and department',
              'Configure leave types',
            ]}
            action={{ label: 'Add employee', href: '/hr/employees' }}
            show={d.totalEmployees === 0 && can('hr.employee.create')}
          />

          <DashboardSection label="Key metrics">
            <DashboardKpiGrid>
              <DashboardKpiCard
                label="Employees"
                value={d.totalEmployees}
                icon={Users}
                tone="teal"
                description={`${d.activeEmployees} active · ${d.onboardingEmployees} onboarding`}
                href="/hr/employees"
              />
              <DashboardKpiCard
                label="Present today"
                value={d.presentToday}
                icon={UserCheck}
                tone="green"
                description={
                  d.activeEmployees > 0 ? `of ${d.activeEmployees} active employees` : undefined
                }
                href={can('hr.attendance.read') ? '/hr/attendance' : undefined}
              />
              <DashboardKpiCard
                label="On leave today"
                value={d.onLeaveToday}
                icon={CalendarOff}
                tone="blue"
                href={can('hr.leave.read') ? '/hr/leave' : undefined}
              />
              <DashboardKpiCard
                label="Absent today"
                value={d.absentToday}
                icon={UserMinus}
                tone={d.absentToday > 0 ? 'red' : 'amber'}
                href={can('hr.attendance.read') ? '/hr/attendance' : undefined}
              />
            </DashboardKpiGrid>
          </DashboardSection>

          <DashboardSection label="Primary work">
            <DashboardGrid cols={3}>
              <DashboardCard title="Leave & expense approvals" icon={ClipboardCheck} tone="amber">
                {d.pendingLeaveApprovals === 0 && d.pendingExpenseApprovals === 0 ? (
                  <DashboardEmptyState
                    title="No approvals waiting"
                    description="Leave and expense requests that need a decision will be listed here."
                  />
                ) : (
                  <DashboardActionCenter
                    items={[
                      {
                        key: 'leave',
                        label: 'Leave approvals pending',
                        count: d.pendingLeaveApprovals,
                        icon: CalendarCheck,
                        tone: 'amber',
                        href: can('hr.leave.read') ? '/hr/leave' : undefined,
                      },
                      {
                        key: 'expense',
                        label: 'Expense approvals pending',
                        count: d.pendingExpenseApprovals,
                        icon: Receipt,
                        tone: 'orange',
                        href: can('hr.expense.read') ? '/hr/expenses' : undefined,
                      },
                    ]}
                  />
                )}
              </DashboardCard>

              <DashboardCard
                title="Attendance"
                description="Share of active employees checked in"
                icon={Clock}
                tone="green"
                href="/reports/hr-attendance-rate"
                linkLabel="Report"
              >
                <ReportChart id="hr-attendance-rate" />
              </DashboardCard>

              {can('hr.payroll.read') || d.currentPayroll ? (
                <DashboardCard
                  title="Current payroll"
                  icon={Banknote}
                  tone="purple"
                  className="md:col-span-2 xl:col-span-1"
                >
                  {d.currentPayroll ? (
                    <div className="space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Payroll period</p>
                        <p className="break-words text-lg font-semibold tracking-tight">
                          {d.currentPayroll.name}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Status</span>
                        <HrStatusBadge status={d.currentPayroll.status} />
                      </div>
                      <Link
                        href={`/hr/payroll/${d.currentPayroll.id}`}
                        className="inline-flex h-8 items-center rounded-md border px-3 text-sm font-medium hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                      >
                        View payroll
                      </Link>
                    </div>
                  ) : (
                    <DashboardEmptyState
                      title="No payroll in progress"
                      description="A payroll period appears here once one is created."
                      action={
                        can('hr.payroll.read') ? (
                          <Link
                            href="/hr/payroll"
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            Open payroll
                          </Link>
                        ) : undefined
                      }
                    />
                  )}
                </DashboardCard>
              ) : null}
            </DashboardGrid>
          </DashboardSection>

          <DashboardSection label="Workforce">
            <DashboardGrid cols={3}>
              <DashboardCard
                title="Attendance trend"
                description="Employees present per day, last 14 days"
                icon={LineChart}
                tone="blue"
                href="/reports/hr-attendance-trend"
                linkLabel="Report"
              >
                <ReportChart id="hr-attendance-trend" hideRanges />
              </DashboardCard>
              <DashboardCard
                title="Department distribution"
                description="Active employees per department"
                icon={PieChart}
                tone="orange"
                href="/reports/hr-department-headcount"
                linkLabel="Report"
              >
                <ReportChart id="hr-department-headcount" hideRanges />
              </DashboardCard>
              <DashboardCard
                title="Upcoming"
                description="Starts and probation reviews"
                icon={Hourglass}
                tone="purple"
                padded={false}
                className="md:col-span-2 xl:col-span-1"
              >
                {d.upcomingStarts.length === 0 && d.probationEnding.length === 0 ? (
                  <div className="p-4">
                    <DashboardEmptyState
                      title="Nothing upcoming"
                      description="New starts and probation end dates in the next 30 days appear here."
                    />
                  </div>
                ) : (
                  <DashboardList>
                    {d.upcomingStarts.map((p) => (
                      <DashboardListItem
                        key={`s-${p.id}`}
                        href={`/hr/employees/${p.id}`}
                        title={p.displayName}
                        subtitle="Starts"
                        trailing={<span className="text-muted-foreground">{fmtDate(p.date)}</span>}
                        tone="teal"
                      />
                    ))}
                    {d.probationEnding.map((p) => (
                      <DashboardListItem
                        key={`p-${p.id}`}
                        href={`/hr/employees/${p.id}`}
                        title={p.displayName}
                        subtitle="Probation ends"
                        trailing={<span className="text-muted-foreground">{fmtDate(p.date)}</span>}
                        tone="amber"
                      />
                    ))}
                  </DashboardList>
                )}
              </DashboardCard>
            </DashboardGrid>
          </DashboardSection>

          <DashboardSection label="Recent activity">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
              <DashboardCard title="Workforce changes" icon={Users} tone="teal" padded={false}>
                {d.recentActivity.length > 0 ? (
                  <DashboardList>
                    {d.recentActivity.map((a, i) => (
                      <DashboardListItem
                        key={`${a.employeeId}-${a.at}-${i}`}
                        href={`/hr/employees/${a.employeeId}`}
                        title={a.employeeName}
                        subtitle={a.summary}
                        trailing={
                          <time dateTime={a.at} className="text-muted-foreground">
                            {fmtDateTime(a.at)}
                          </time>
                        }
                      />
                    ))}
                  </DashboardList>
                ) : (
                  <div className="p-4">
                    <DashboardEmptyState
                      title="No recent changes"
                      description="Hires, status changes and updates to employee records will show here."
                    />
                  </div>
                )}
              </DashboardCard>
              <DashboardQuickActions actions={quickActions} />
            </div>
          </DashboardSection>
        </>
      )}
    </DashboardShell>
  );
}
