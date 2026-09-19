import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { HrScope } from './common.js';
import { employeeIdFilter, employeeScopeCondition } from './data-scope.js';
import type { HrActivityItemDto, HrDashboardDto } from './hr.dto.js';

const {
  employees,
  attendanceRecords,
  leaveRequests,
  expenseClaims,
  departments,
  payrollPeriods,
  employmentHistory,
} = schema;

const ACTIVITY_LIMIT = 8;
const PROBATION_WINDOW_DAYS = 30;

const HISTORY_LABEL: Record<string, string> = {
  DEPARTMENT: 'Department changed',
  DESIGNATION: 'Designation changed',
  MANAGER: 'Reporting manager changed',
  LOCATION: 'Work location changed',
};

/**
 * HR dashboard aggregation (Phase 12, ADR 0041; Phase 17). Read-only, real data
 * only, and bound by the caller's HR data scope — a manager scoped to their team
 * sees their team's numbers, never the whole workspace's. Every query is
 * tenant-scoped through the RLS context.
 *
 * The activity feed deliberately excludes compensation changes and carries no raw
 * identifiers: it is a "what changed" pulse, not an audit log (the audit log
 * remains the source of truth for who did what).
 */
@Injectable()
export class DashboardService {
  summary(scope: HrScope, opts: { canSeePayroll: boolean }): Promise<HrDashboardDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const probationCutoff = new Date(now.getTime() + PROBATION_WINDOW_DAYS * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const empScope = await employeeScopeCondition(tx, scope);
      const empWhere = and(eq(employees.tenantId, scope.tenantId), empScope ?? undefined)!;

      const [emp] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${employees.status} = 'ACTIVE')::int`,
          onboarding: sql<number>`count(*) filter (where ${employees.status} = 'ONBOARDING')::int`,
        })
        .from(employees)
        .where(empWhere);

      const attScope = await employeeIdFilter(tx, scope, attendanceRecords.employeeId);
      const [att] = await tx
        .select({
          present: sql<number>`count(*) filter (where ${attendanceRecords.status} in ('PRESENT','LATE','HALF_DAY','EARLY_DEPARTURE'))::int`,
          onLeave: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'ON_LEAVE')::int`,
          absent: sql<number>`count(*) filter (where ${attendanceRecords.status} = 'ABSENT')::int`,
        })
        .from(attendanceRecords)
        .where(
          and(
            eq(attendanceRecords.tenantId, scope.tenantId),
            eq(attendanceRecords.workDate, today),
            attScope ?? undefined,
          ),
        );

      const leaveScope = await employeeIdFilter(tx, scope, leaveRequests.employeeId);
      const [leave] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.tenantId, scope.tenantId),
            eq(leaveRequests.status, 'PENDING'),
            leaveScope ?? undefined,
          ),
        );

      const expenseScope = await employeeIdFilter(tx, scope, expenseClaims.employeeId);
      const [expense] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(expenseClaims)
        .where(
          and(
            eq(expenseClaims.tenantId, scope.tenantId),
            eq(expenseClaims.status, 'SUBMITTED'),
            expenseScope ?? undefined,
          ),
        );

      const [dept] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(departments)
        .where(eq(departments.tenantId, scope.tenantId));

      const upcomingStarts = await tx
        .select({
          id: employees.id,
          displayName: employees.displayName,
          date: employees.joiningDate,
        })
        .from(employees)
        .where(and(empWhere, eq(employees.status, 'ONBOARDING')))
        .orderBy(asc(employees.joiningDate))
        .limit(5);

      const probationEnding = await tx
        .select({
          id: employees.id,
          displayName: employees.displayName,
          date: employees.probationEndDate,
        })
        .from(employees)
        .where(
          and(
            empWhere,
            eq(employees.status, 'ACTIVE'),
            gte(employees.probationEndDate, today),
            lte(employees.probationEndDate, probationCutoff),
          ),
        )
        .orderBy(asc(employees.probationEndDate))
        .limit(5);

      const historyScope = await employeeIdFilter(tx, scope, employmentHistory.employeeId);
      const historyRows = await tx
        .select({
          employeeId: employmentHistory.employeeId,
          employeeName: employees.displayName,
          changeType: employmentHistory.changeType,
          fromValue: employmentHistory.fromValue,
          toValue: employmentHistory.toValue,
          at: employmentHistory.createdAt,
        })
        .from(employmentHistory)
        .innerJoin(employees, eq(employees.id, employmentHistory.employeeId))
        .where(
          and(
            eq(employmentHistory.tenantId, scope.tenantId),
            ne(employmentHistory.changeType, 'COMPENSATION'),
            historyScope ?? undefined,
          ),
        )
        .orderBy(desc(employmentHistory.createdAt))
        .limit(ACTIVITY_LIMIT);

      const hired = await tx
        .select({ id: employees.id, displayName: employees.displayName, at: employees.createdAt })
        .from(employees)
        .where(empWhere)
        .orderBy(desc(employees.createdAt))
        .limit(ACTIVITY_LIMIT);

      const recentActivity: HrActivityItemDto[] = [
        ...hired.map((h) => ({
          at: h.at.toISOString(),
          kind: 'HIRED',
          employeeId: h.id,
          employeeName: h.displayName,
          summary: 'Added to the workforce',
        })),
        ...historyRows.map((h) => ({
          at: h.at.toISOString(),
          kind: h.changeType,
          employeeId: h.employeeId,
          employeeName: h.employeeName,
          summary: historySummary(h.changeType, h.fromValue, h.toValue),
        })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, ACTIVITY_LIMIT);

      let currentPayroll: HrDashboardDto['currentPayroll'] = null;
      if (opts.canSeePayroll) {
        const [payroll] = await tx
          .select({
            id: payrollPeriods.id,
            name: payrollPeriods.name,
            status: payrollPeriods.status,
          })
          .from(payrollPeriods)
          .where(
            and(
              eq(payrollPeriods.tenantId, scope.tenantId),
              inArray(payrollPeriods.status, [
                'DRAFT',
                'PROCESSING',
                'FINALIZED',
                'PAYMENT_PROCESSING',
                'PARTIALLY_PAID',
              ]),
            ),
          )
          .orderBy(sql`${payrollPeriods.periodStart} desc`)
          .limit(1);
        currentPayroll = payroll
          ? { id: payroll.id, name: payroll.name, status: payroll.status }
          : null;
      }

      return {
        totalEmployees: emp?.total ?? 0,
        activeEmployees: emp?.active ?? 0,
        onboardingEmployees: emp?.onboarding ?? 0,
        upcomingStarts,
        probationEnding: probationEnding.flatMap((p) =>
          p.date ? [{ id: p.id, displayName: p.displayName, date: p.date }] : [],
        ),
        recentActivity,
        presentToday: att?.present ?? 0,
        onLeaveToday: att?.onLeave ?? 0,
        absentToday: att?.absent ?? 0,
        pendingLeaveApprovals: leave?.n ?? 0,
        pendingExpenseApprovals: expense?.n ?? 0,
        departmentCount: dept?.n ?? 0,
        currentPayroll,
      };
    });
  }
}

/** Readable, non-identifying description of an employment-history row. */
function historySummary(
  changeType: string,
  from: Record<string, unknown> | null,
  to: Record<string, unknown> | null,
): string {
  const label = (v: Record<string, unknown> | null) =>
    typeof v?.value === 'string' ? (v.value as string).replace(/_/g, ' ').toLowerCase() : '—';
  if (changeType === 'STATUS') return `Status changed: ${label(from)} → ${label(to)}`;
  if (changeType === 'EMPLOYMENT_TYPE')
    return `Employment type changed: ${label(from)} → ${label(to)}`;
  return HISTORY_LABEL[changeType] ?? 'Employment record updated';
}
