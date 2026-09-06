import { Injectable } from '@nestjs/common';
import { getDb, withTenantContext } from '@aivoryx/db';
import { EmployeesService } from './employees.service.js';
import { LeaveService } from './leave.service.js';
import { AttendanceService } from './attendance.service.js';
import { HrScope, resolveMyEmployeeId } from './common.js';
import type { HrMeDto } from './hr.dto.js';

/**
 * Employee self-service (Phase 12, ADR 0041). The identity contract:
 * authenticated membership → linked employee → own HR data. A client-provided
 * employeeId is NEVER trusted here. If the account is not linked to an
 * employee, {@link resolveMyEmployeeId} throws `HR_EMPLOYEE_NOT_LINKED`.
 *
 * Callers (the `/hr/me` controller) use {@link myEmployeeId} to scope every
 * downstream read (leave, expenses, payslips) to the caller's own record.
 */
@Injectable()
export class SelfServiceService {
  constructor(
    private readonly employees: EmployeesService,
    private readonly leave: LeaveService,
    private readonly attendance: AttendanceService,
  ) {}

  /** The caller's own employee id, resolved from their authenticated membership. */
  myEmployeeId(scope: HrScope): Promise<string> {
    return withTenantContext(getDb(), scope, (tx) =>
      resolveMyEmployeeId(tx, scope.tenantId, scope.actorMembershipId),
    );
  }

  /** The self-service snapshot: own profile, leave balances, today's attendance. */
  async me(scope: HrScope): Promise<HrMeDto> {
    const employeeId = await this.myEmployeeId(scope);
    const employee = await withTenantContext(getDb(), scope, (tx) =>
      this.employees.detail(tx, scope.tenantId, employeeId),
    );
    const leaveBalances = await this.leave.balancesFor(scope, employeeId);
    const today = new Date().toISOString().slice(0, 10);
    const attendancePage = await this.attendance.list(scope, {
      employeeId,
      from: today,
      to: today,
      page: 1,
      pageSize: 1,
    });
    return { employee, leaveBalances, todayAttendance: attendancePage.items[0] ?? null };
  }
}
