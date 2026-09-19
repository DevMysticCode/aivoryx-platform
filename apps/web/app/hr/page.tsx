'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageHeader, Skeleton, Card, EmptyState } from '@/components/admin/ui';
import { StatCard, HrStatusBadge, fmtDate, fmtDateTime } from '@/components/hr/ui';
import { useHrDashboard } from '@/lib/hr/use-hr';
import { ErrorBlock } from '@/components/ui/kit';
import { ModuleWelcome } from '@/components/help/module-welcome';
import { usePermissions } from '@/components/supply/supply-shell';

function SectionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h2>
      {children}
    </section>
  );
}

function CountRow({ label, count, href }: { label: string; count: number; href?: string }) {
  const body = (
    <>
      <span className="min-w-0">{label}</span>
      <span className="font-semibold tabular-nums">{count}</span>
    </>
  );
  const cls = 'flex items-center justify-between gap-3 py-2 text-sm';
  return href ? (
    <Link href={href} className={`${cls} hover:text-primary`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function PeopleList({
  title,
  items,
}: {
  title: string;
  items: { id: string; displayName: string; date: string }[];
}) {
  return (
    <div>
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="divide-y divide-border-subtle">
        {items.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-x-3 py-2 text-sm"
          >
            <Link
              href={`/hr/employees/${p.id}`}
              className="min-w-0 break-words text-primary hover:underline"
            >
              {p.displayName}
            </Link>
            <span className="text-muted-foreground">{fmtDate(p.date)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** HR dashboard — the workspace-wide people snapshot (Phase 12/17, ADR 0041). */
export default function HrDashboardPage() {
  const q = useHrDashboard();
  const perms = usePermissions();
  const d = q.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="HR & Workforce"
        description="People, attendance, leave, expenses and payroll at a glance."
      />

      {q.isLoading && <Skeleton rows={4} />}
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
            show={d.totalEmployees === 0 && perms.includes('hr.employee.create')}
          />
          <SectionGroup label="Key metrics">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard
                label="Employees"
                value={
                  <>
                    {d.totalEmployees}
                    <span className="block text-xs font-normal text-muted-foreground">
                      {d.activeEmployees} active · {d.onboardingEmployees} onboarding
                    </span>
                  </>
                }
                href="/hr/employees"
              />
              <StatCard label="Present today" value={d.presentToday} tone="pos" />
              <StatCard label="On leave today" value={d.onLeaveToday} tone="warn" />
              <StatCard
                label="Absent today"
                value={d.absentToday}
                tone={d.absentToday ? 'neg' : undefined}
              />
            </div>
          </SectionGroup>

          <SectionGroup label="Primary work">
            {d.pendingLeaveApprovals > 0 || d.pendingExpenseApprovals > 0 || d.currentPayroll ? (
              <Card className="space-y-3">
                <div className="divide-y divide-border-subtle">
                  {d.pendingLeaveApprovals > 0 && (
                    <CountRow
                      label="Leave approvals pending"
                      count={d.pendingLeaveApprovals}
                      href={perms.includes('hr.leave.read') ? '/hr/leave' : undefined}
                    />
                  )}
                  {d.pendingExpenseApprovals > 0 && (
                    <CountRow
                      label="Expense approvals pending"
                      count={d.pendingExpenseApprovals}
                      href={perms.includes('hr.expense.read') ? '/hr/expenses' : undefined}
                    />
                  )}
                  {d.currentPayroll && (
                    <Link
                      href={`/hr/payroll/${d.currentPayroll.id}`}
                      className="flex items-center justify-between gap-3 py-2 text-sm hover:text-primary"
                    >
                      <span className="min-w-0 break-words">
                        Current payroll: {d.currentPayroll.name}
                      </span>
                      <HrStatusBadge status={d.currentPayroll.status} />
                    </Link>
                  )}
                </div>
              </Card>
            ) : (
              <EmptyState title="No approvals waiting">
                Leave and expense requests that need a decision will be listed here. Nothing is
                pending right now.
              </EmptyState>
            )}
          </SectionGroup>

          {(d.upcomingStarts.length > 0 || d.probationEnding.length > 0) && (
            <SectionGroup label="Upcoming">
              <Card className="grid gap-4 md:grid-cols-2">
                {d.upcomingStarts.length > 0 && (
                  <PeopleList title="Upcoming starts" items={d.upcomingStarts} />
                )}
                {d.probationEnding.length > 0 && (
                  <PeopleList title="Probation ending soon" items={d.probationEnding} />
                )}
              </Card>
            </SectionGroup>
          )}

          <SectionGroup label="Recent activity">
            {d.recentActivity.length > 0 ? (
              <ul className="divide-y divide-border-subtle rounded-lg border bg-card px-4">
                {d.recentActivity.map((a, i) => (
                  <li key={`${a.employeeId}-${a.at}-${i}`} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <Link
                        href={`/hr/employees/${a.employeeId}`}
                        className="min-w-0 break-words font-medium text-primary hover:underline"
                      >
                        {a.employeeName}
                      </Link>
                      <time dateTime={a.at} className="text-xs text-muted-foreground">
                        {fmtDateTime(a.at)}
                      </time>
                    </div>
                    <p className="break-words text-muted-foreground">{a.summary}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No recent changes">
                Hires, status changes and updates to employee records will show here.
              </EmptyState>
            )}
          </SectionGroup>
        </>
      )}
    </div>
  );
}
