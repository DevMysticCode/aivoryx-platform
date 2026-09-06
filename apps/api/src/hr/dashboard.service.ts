import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { HrScope } from './common.js';
import type { HrDashboardDto } from './hr.dto.js';

const { employees, attendanceRecords, leaveRequests, expenseClaims, departments, payrollPeriods } =
  schema;

/**
 * HR dashboard aggregation (Phase 12, ADR 0041). Read-only counters for the
 * `/hr` landing page. Every query is tenant-scoped through the RLS context.
 */
@Injectable()
export class DashboardService {
  summary(scope: HrScope): Promise<HrDashboardDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const today = new Date().toISOString().slice(0, 10);

      const [emp] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${employees.status} = 'ACTIVE')::int`,
        })
        .from(employees)
        .where(eq(employees.tenantId, scope.tenantId));

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
          ),
        );

      const [leave] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(leaveRequests)
        .where(
          and(eq(leaveRequests.tenantId, scope.tenantId), eq(leaveRequests.status, 'PENDING')),
        );

      const [expense] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(expenseClaims)
        .where(
          and(eq(expenseClaims.tenantId, scope.tenantId), eq(expenseClaims.status, 'SUBMITTED')),
        );

      const [dept] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(departments)
        .where(eq(departments.tenantId, scope.tenantId));

      const [payroll] = await tx
        .select({ id: payrollPeriods.id, name: payrollPeriods.name, status: payrollPeriods.status })
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

      return {
        totalEmployees: emp?.total ?? 0,
        activeEmployees: emp?.active ?? 0,
        presentToday: att?.present ?? 0,
        onLeaveToday: att?.onLeave ?? 0,
        absentToday: att?.absent ?? 0,
        pendingLeaveApprovals: leave?.n ?? 0,
        pendingExpenseApprovals: expense?.n ?? 0,
        departmentCount: dept?.n ?? 0,
        currentPayroll: payroll
          ? { id: payroll.id, name: payroll.name, status: payroll.status }
          : null,
      };
    });
  }
}
