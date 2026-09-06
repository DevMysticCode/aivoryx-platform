import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { canTransitionLeave, type LeaveRequestStatus } from './lifecycles.js';
import {
  findMyEmployeeId,
  HrScope,
  isUniqueViolation,
  nextHrNumber,
  pageBounds,
  resolveMyEmployeeId,
  type Paged,
} from './common.js';
import type {
  AdjustLeaveBalanceDto,
  CreateLeaveRequestDto,
  LeaveBalanceDto,
  LeaveCalendarItemDto,
  LeaveDecisionDto,
  LeaveRequestDto,
  LeaveTypeDto,
  ListLeaveCalendarQueryDto,
  ListLeaveQueryDto,
  UpsertLeaveTypeDto,
} from './hr.dto.js';

const {
  leaveTypes,
  leavePolicies,
  leaveBalances,
  leaveBalanceTransactions,
  leaveRequests,
  employees,
  departments,
  userTenantMemberships,
} = schema;

interface LeaveReqRow {
  id: string;
  requestNumber: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  leaveTypeId: string;
  leaveTypeName: string;
  startDate: string;
  endDate: string;
  isHalfDay: boolean;
  halfDayPeriod: string | null;
  totalDays: string;
  reason: string | null;
  status: string;
  approverMembershipId: string | null;
  decisionReason: string | null;
  decidedAt: Date | null;
  attachmentObjectKey: string | null;
  createdAt: Date;
}

/** Whole-day count between two ISO dates, inclusive. Weekend handling is
 *  intentionally left to a future policy engine (generic status logic). */
function dayCount(start: string, end: string): number {
  const a = new Date(start + 'T00:00:00Z').getTime();
  const b = new Date(end + 'T00:00:00Z').getTime();
  return Math.floor((b - a) / 86_400_000) + 1;
}

@Injectable()
export class LeaveService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  // ---- config (hr.leave.manage) --------------------------

  listTypes(scope: HrScope): Promise<LeaveTypeDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({ t: leaveTypes, p: leavePolicies })
        .from(leaveTypes)
        .leftJoin(
          leavePolicies,
          and(
            eq(leavePolicies.leaveTypeId, leaveTypes.id),
            eq(leavePolicies.tenantId, scope.tenantId),
          ),
        )
        .where(eq(leaveTypes.tenantId, scope.tenantId))
        .orderBy(leaveTypes.name);
      return rows.map((r) => ({
        id: r.t.id,
        name: r.t.name,
        code: r.t.code,
        isPaid: r.t.isPaid,
        requiresApproval: r.t.requiresApproval,
        allowNegativeBalance: r.t.allowNegativeBalance,
        status: r.t.status,
        policy: r.p
          ? {
              annualQuota: r.p.annualQuota,
              approverStrategy: r.p.approverStrategy,
              designatedApproverMembershipId: r.p.designatedApproverMembershipId,
            }
          : null,
      }));
    });
  }

  async upsertType(scope: HrScope, body: UpsertLeaveTypeDto, id?: string): Promise<LeaveTypeDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      let typeId = id;
      try {
        if (typeId) {
          const res = await tx
            .update(leaveTypes)
            .set({
              name: body.name.trim(),
              code: body.code.trim(),
              isPaid: body.isPaid ?? true,
              requiresApproval: body.requiresApproval ?? true,
              allowNegativeBalance: body.allowNegativeBalance ?? false,
              updatedAt: new Date(),
            })
            .where(and(eq(leaveTypes.id, typeId), eq(leaveTypes.tenantId, scope.tenantId)))
            .returning({ id: leaveTypes.id });
          if (res.length === 0) throw new AppError('HR_LEAVE_TYPE_NOT_FOUND');
        } else {
          const [row] = await tx
            .insert(leaveTypes)
            .values({
              tenantId: scope.tenantId,
              name: body.name.trim(),
              code: body.code.trim(),
              isPaid: body.isPaid ?? true,
              requiresApproval: body.requiresApproval ?? true,
              allowNegativeBalance: body.allowNegativeBalance ?? false,
            })
            .returning({ id: leaveTypes.id });
          typeId = row!.id;
        }
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('HR_DUPLICATE_CODE', { details: { code: body.code } });
        throw err;
      }
      if (body.designatedApproverMembershipId) {
        const [m] = await tx
          .select({ id: userTenantMemberships.id })
          .from(userTenantMemberships)
          .where(
            and(
              eq(userTenantMemberships.id, body.designatedApproverMembershipId),
              eq(userTenantMemberships.tenantId, scope.tenantId),
            ),
          )
          .limit(1);
        if (!m) throw new AppError('HR_MEMBERSHIP_INVALID');
      }
      await tx
        .insert(leavePolicies)
        .values({
          tenantId: scope.tenantId,
          leaveTypeId: typeId!,
          name: `${body.name} policy`,
          annualQuota: body.annualQuota,
          approverStrategy: (body.approverStrategy as 'REPORTING_MANAGER') ?? 'REPORTING_MANAGER',
          designatedApproverMembershipId: body.designatedApproverMembershipId ?? null,
        })
        .onConflictDoUpdate({
          target: [leavePolicies.tenantId, leavePolicies.leaveTypeId],
          set: {
            annualQuota: body.annualQuota,
            approverStrategy: (body.approverStrategy as 'REPORTING_MANAGER') ?? 'REPORTING_MANAGER',
            designatedApproverMembershipId: body.designatedApproverMembershipId ?? null,
            updatedAt: new Date(),
          },
        });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.leave.type_created',
        entityType: 'leave_type',
        entityId: typeId!,
        actor: userActor(scope),
        metadata: { code: body.code, annualQuota: body.annualQuota },
      });
    });
    return (await this.listTypes(scope)).find((t) => t.code === body.code.trim())!;
  }

  async adjustBalance(scope: HrScope, body: AdjustLeaveBalanceDto): Promise<LeaveBalanceDto[]> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await this.ensureBalanceRow(tx, scope.tenantId, body.employeeId, body.leaveTypeId, body.year);
      await tx
        .update(leaveBalances)
        .set({ adjusted: sql`${leaveBalances.adjusted} + ${body.amount}`, updatedAt: new Date() })
        .where(
          and(
            eq(leaveBalances.tenantId, scope.tenantId),
            eq(leaveBalances.employeeId, body.employeeId),
            eq(leaveBalances.leaveTypeId, body.leaveTypeId),
            eq(leaveBalances.year, body.year),
          ),
        );
      await tx.insert(leaveBalanceTransactions).values({
        tenantId: scope.tenantId,
        employeeId: body.employeeId,
        leaveTypeId: body.leaveTypeId,
        year: body.year,
        kind: 'ADJUSTMENT',
        amount: body.amount,
        reason: body.reason,
        createdByMembershipId: scope.actorMembershipId,
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.leave.balance_adjusted',
        entityType: 'leave_balance',
        entityId: body.employeeId,
        actor: userActor(scope),
        metadata: {
          leaveTypeId: body.leaveTypeId,
          year: body.year,
          amount: body.amount,
          reason: body.reason,
        },
      });
    });
    return this.balancesFor(scope, body.employeeId);
  }

  balancesFor(scope: HrScope, employeeId: string): Promise<LeaveBalanceDto[]> {
    return withTenantContext(getDb(), scope, (tx) =>
      this.loadBalances(tx, scope.tenantId, employeeId),
    );
  }

  // ---- requests ----------------------------------------

  async createRequest(scope: HrScope, body: CreateLeaveRequestDto): Promise<LeaveRequestDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      const employeeId =
        body.employeeId ?? (await resolveMyEmployeeId(tx, scope.tenantId, scope.actorMembershipId));
      const [emp] = await tx
        .select({ id: employees.id, managerId: employees.managerId })
        .from(employees)
        .where(and(eq(employees.tenantId, scope.tenantId), eq(employees.id, employeeId)))
        .limit(1);
      if (!emp) throw new AppError('HR_EMPLOYEE_NOT_FOUND');

      const [type] = await tx
        .select({ t: leaveTypes, p: leavePolicies })
        .from(leaveTypes)
        .leftJoin(
          leavePolicies,
          and(
            eq(leavePolicies.leaveTypeId, leaveTypes.id),
            eq(leavePolicies.tenantId, scope.tenantId),
          ),
        )
        .where(and(eq(leaveTypes.tenantId, scope.tenantId), eq(leaveTypes.id, body.leaveTypeId)))
        .limit(1);
      if (!type) throw new AppError('HR_LEAVE_TYPE_NOT_FOUND');

      const start = body.startDate.slice(0, 10);
      const end = body.endDate.slice(0, 10);
      if (end < start)
        throw new AppError('HR_INVALID_STATE', { details: { hint: 'end before start' } });
      const totalDays = body.isHalfDay ? 0.5 : dayCount(start, end);

      // overlap with any non-terminal request for the same employee
      const overlap = await tx
        .select({ id: leaveRequests.id })
        .from(leaveRequests)
        .where(
          and(
            eq(leaveRequests.tenantId, scope.tenantId),
            eq(leaveRequests.employeeId, employeeId),
            inArray(leaveRequests.status, ['PENDING', 'APPROVED']),
            lte(leaveRequests.startDate, end),
            gte(leaveRequests.endDate, start),
          ),
        )
        .limit(1);
      if (overlap.length) throw new AppError('HR_LEAVE_OVERLAP');

      const number = await nextHrNumber(tx, scope.tenantId, 'leave_request');
      const strategy = type.p?.approverStrategy ?? 'REPORTING_MANAGER';
      let approverMembershipId: string | null = null;
      if (strategy === 'REPORTING_MANAGER' && emp.managerId) {
        const [mgr] = await tx
          .select({ membershipId: employees.membershipId })
          .from(employees)
          .where(and(eq(employees.tenantId, scope.tenantId), eq(employees.id, emp.managerId)))
          .limit(1);
        approverMembershipId = mgr?.membershipId ?? null;
      } else if (strategy === 'DESIGNATED_APPROVER') {
        approverMembershipId = type.p?.designatedApproverMembershipId ?? null;
      }

      const [row] = await tx
        .insert(leaveRequests)
        .values({
          tenantId: scope.tenantId,
          requestNumber: number,
          employeeId,
          leaveTypeId: body.leaveTypeId,
          startDate: start,
          endDate: end,
          isHalfDay: body.isHalfDay ?? false,
          halfDayPeriod: (body.halfDayPeriod as 'FIRST_HALF') ?? null,
          totalDays: String(totalDays),
          reason: body.reason ?? null,
          notes: body.notes ?? null,
          status: 'PENDING',
          approverMembershipId,
          createdByMembershipId: scope.actorMembershipId,
        })
        .returning({ id: leaveRequests.id });

      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.leave.requested',
        entityType: 'leave_request',
        entityId: row!.id,
        actor: userActor(scope),
        metadata: { number, employeeId, leaveTypeId: body.leaveTypeId, totalDays },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'hr.leave.requested',
        payload: { leaveRequestId: row!.id, employeeId },
        actorMembershipId: scope.actorMembershipId,
      });
      return row!.id;
    });
    return this.getRequest(scope, id);
  }

  async decide(
    scope: HrScope,
    id: string,
    outcome: 'APPROVED' | 'REJECTED',
    body: LeaveDecisionDto,
    canManage: boolean,
  ): Promise<LeaveRequestDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const [req] = await tx
        .select()
        .from(leaveRequests)
        .where(and(eq(leaveRequests.tenantId, scope.tenantId), eq(leaveRequests.id, id)))
        .for('update')
        .limit(1);
      if (!req) throw new AppError('HR_LEAVE_NOT_FOUND');
      if (!canTransitionLeave(req.status as LeaveRequestStatus, outcome)) {
        throw new AppError('HR_INVALID_STATE', { details: { from: req.status, to: outcome } });
      }
      // self-approval forbidden
      const myEmpId = await findMyEmployeeId(tx, scope.tenantId, scope.actorMembershipId);
      if (myEmpId && myEmpId === req.employeeId) throw new AppError('HR_SELF_APPROVAL_FORBIDDEN');
      // authority check
      const isAssignedApprover =
        req.approverMembershipId != null && req.approverMembershipId === scope.actorMembershipId;
      if (!isAssignedApprover && !canManage) throw new AppError('HR_NOT_THE_APPROVER');

      const year = Number(req.startDate.slice(0, 4));
      if (outcome === 'APPROVED') {
        await this.ensureBalanceRow(tx, scope.tenantId, req.employeeId, req.leaveTypeId, year);
        const [bal] = await tx
          .select()
          .from(leaveBalances)
          .where(
            and(
              eq(leaveBalances.tenantId, scope.tenantId),
              eq(leaveBalances.employeeId, req.employeeId),
              eq(leaveBalances.leaveTypeId, req.leaveTypeId),
              eq(leaveBalances.year, year),
            ),
          )
          .for('update')
          .limit(1);
        const [lt] = await tx
          .select({ allowNeg: leaveTypes.allowNegativeBalance })
          .from(leaveTypes)
          .where(and(eq(leaveTypes.tenantId, scope.tenantId), eq(leaveTypes.id, req.leaveTypeId)))
          .limit(1);
        const remaining = Number(bal?.balance ?? '0');
        if (!lt?.allowNeg && remaining < Number(req.totalDays)) {
          throw new AppError('HR_LEAVE_INSUFFICIENT_BALANCE', {
            details: { remaining: String(remaining), requested: req.totalDays },
          });
        }
        await tx
          .update(leaveBalances)
          .set({
            consumed: sql`${leaveBalances.consumed} + ${req.totalDays}`,
            updatedAt: new Date(),
          })
          .where(eq(leaveBalances.id, bal!.id));
        await tx.insert(leaveBalanceTransactions).values({
          tenantId: scope.tenantId,
          employeeId: req.employeeId,
          leaveTypeId: req.leaveTypeId,
          year,
          kind: 'CONSUMPTION',
          amount: `-${req.totalDays}`,
          leaveRequestId: id,
          createdByMembershipId: scope.actorMembershipId,
        });
      }

      await tx
        .update(leaveRequests)
        .set({
          status: outcome,
          decidedByMembershipId: scope.actorMembershipId,
          decidedAt: new Date(),
          decisionReason: body.reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(leaveRequests.id, id));

      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: outcome === 'APPROVED' ? 'hr.leave.approved' : 'hr.leave.rejected',
        entityType: 'leave_request',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: req.status, to: outcome } },
        metadata: body.reason ? { reason: body.reason } : undefined,
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: outcome === 'APPROVED' ? 'hr.leave.approved' : 'hr.leave.rejected',
        payload: { leaveRequestId: id, employeeId: req.employeeId },
        actorMembershipId: scope.actorMembershipId,
      });
    });
    return this.getRequest(scope, id);
  }

  async cancel(scope: HrScope, id: string, canManage: boolean): Promise<LeaveRequestDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const [req] = await tx
        .select()
        .from(leaveRequests)
        .where(and(eq(leaveRequests.tenantId, scope.tenantId), eq(leaveRequests.id, id)))
        .for('update')
        .limit(1);
      if (!req) throw new AppError('HR_LEAVE_NOT_FOUND');
      if (!canTransitionLeave(req.status as LeaveRequestStatus, 'CANCELLED')) {
        throw new AppError('HR_INVALID_STATE', { details: { from: req.status } });
      }
      const myEmpId = await findMyEmployeeId(tx, scope.tenantId, scope.actorMembershipId);
      if (!canManage && myEmpId !== req.employeeId) throw new AppError('AUTH_FORBIDDEN');

      if (req.status === 'APPROVED') {
        // restore consumed balance
        const year = Number(req.startDate.slice(0, 4));
        await tx
          .update(leaveBalances)
          .set({
            consumed: sql`${leaveBalances.consumed} - ${req.totalDays}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(leaveBalances.tenantId, scope.tenantId),
              eq(leaveBalances.employeeId, req.employeeId),
              eq(leaveBalances.leaveTypeId, req.leaveTypeId),
              eq(leaveBalances.year, year),
            ),
          );
        await tx.insert(leaveBalanceTransactions).values({
          tenantId: scope.tenantId,
          employeeId: req.employeeId,
          leaveTypeId: req.leaveTypeId,
          year,
          kind: 'REVERSAL',
          amount: req.totalDays,
          leaveRequestId: id,
          createdByMembershipId: scope.actorMembershipId,
        });
      }
      await tx
        .update(leaveRequests)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(eq(leaveRequests.id, id));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.leave.cancelled',
        entityType: 'leave_request',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: req.status, to: 'CANCELLED' } },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'hr.leave.cancelled',
        payload: { leaveRequestId: id, employeeId: req.employeeId },
        actorMembershipId: scope.actorMembershipId,
      });
    });
    return this.getRequest(scope, id);
  }

  // ---- reads --------------------------------------

  list(scope: HrScope, query: ListLeaveQueryDto): Promise<Paged<LeaveRequestDto>> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [eq(leaveRequests.tenantId, scope.tenantId)];
      if (query.employeeId) conds.push(eq(leaveRequests.employeeId, query.employeeId));
      if (query.leaveTypeId) conds.push(eq(leaveRequests.leaveTypeId, query.leaveTypeId));
      if (query.status) conds.push(eq(leaveRequests.status, query.status as 'PENDING'));
      if (query.from) conds.push(gte(leaveRequests.endDate, query.from.slice(0, 10)));
      if (query.to) conds.push(lte(leaveRequests.startDate, query.to.slice(0, 10)));
      const where = and(...conds)!;
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(leaveRequests)
        .where(where);
      const rows = await tx
        .select(this.reqCols())
        .from(leaveRequests)
        .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(where)
        .orderBy(desc(leaveRequests.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: await this.hydrate(tx, scope.tenantId, rows),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  /** Requests the caller must act on: assigned to them, still pending. */
  approvalQueue(scope: HrScope, canManage: boolean): Promise<LeaveRequestDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const cond = canManage
        ? or(
            eq(leaveRequests.approverMembershipId, scope.actorMembershipId),
            sql`${leaveRequests.approverMembershipId} is null`,
          )!
        : eq(leaveRequests.approverMembershipId, scope.actorMembershipId);
      const rows = await tx
        .select(this.reqCols())
        .from(leaveRequests)
        .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(
          and(
            eq(leaveRequests.tenantId, scope.tenantId),
            eq(leaveRequests.status, 'PENDING'),
            cond,
          ),
        )
        .orderBy(leaveRequests.startDate);
      return this.hydrate(tx, scope.tenantId, rows);
    });
  }

  getRequest(scope: HrScope, id: string): Promise<LeaveRequestDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select(this.reqCols())
        .from(leaveRequests)
        .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(and(eq(leaveRequests.tenantId, scope.tenantId), eq(leaveRequests.id, id)))
        .limit(1);
      if (rows.length === 0) throw new AppError('HR_LEAVE_NOT_FOUND');
      return (await this.hydrate(tx, scope.tenantId, rows))[0]!;
    });
  }

  calendar(scope: HrScope, query: ListLeaveCalendarQueryDto): Promise<LeaveCalendarItemDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [
        eq(leaveRequests.tenantId, scope.tenantId),
        inArray(leaveRequests.status, ['PENDING', 'APPROVED']),
        lte(leaveRequests.startDate, query.to.slice(0, 10)),
        gte(leaveRequests.endDate, query.from.slice(0, 10)),
      ];
      if (query.departmentId) conds.push(eq(employees.departmentId, query.departmentId));
      if (query.leaveTypeId) conds.push(eq(leaveRequests.leaveTypeId, query.leaveTypeId));
      const rows = await tx
        .select({
          id: leaveRequests.id,
          employeeName: employees.displayName,
          department: departments.name,
          leaveTypeName: leaveTypes.name,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          totalDays: leaveRequests.totalDays,
          status: leaveRequests.status,
        })
        .from(leaveRequests)
        .innerJoin(employees, eq(employees.id, leaveRequests.employeeId))
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
        .where(and(...conds))
        .orderBy(leaveRequests.startDate);
      return rows;
    });
  }

  // ---- helpers ------------------------------------

  private reqCols() {
    return {
      id: leaveRequests.id,
      requestNumber: leaveRequests.requestNumber,
      employeeId: leaveRequests.employeeId,
      employeeName: employees.displayName,
      employeeNumber: employees.employeeNumber,
      leaveTypeId: leaveRequests.leaveTypeId,
      leaveTypeName: leaveTypes.name,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      isHalfDay: leaveRequests.isHalfDay,
      halfDayPeriod: leaveRequests.halfDayPeriod,
      totalDays: leaveRequests.totalDays,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      approverMembershipId: leaveRequests.approverMembershipId,
      decisionReason: leaveRequests.decisionReason,
      decidedAt: leaveRequests.decidedAt,
      attachmentObjectKey: leaveRequests.attachmentObjectKey,
      createdAt: leaveRequests.createdAt,
    };
  }

  private async hydrate(tx: Tx, tenantId: string, rows: LeaveReqRow[]): Promise<LeaveRequestDto[]> {
    const approverIds = [
      ...new Set(rows.map((r) => r.approverMembershipId).filter(Boolean)),
    ] as string[];
    const approverNames = new Map<string, string>();
    if (approverIds.length) {
      for (const e of await tx
        .select({ membershipId: employees.membershipId, name: employees.displayName })
        .from(employees)
        .where(
          and(eq(employees.tenantId, tenantId), inArray(employees.membershipId, approverIds)),
        )) {
        if (e.membershipId) approverNames.set(e.membershipId, e.name);
      }
    }
    // balances for the involved (employee, type, year)
    const balances = new Map<string, string>();
    for (const r of rows) {
      const year = Number(r.startDate.slice(0, 4));
      const key = `${r.employeeId}:${r.leaveTypeId}:${year}`;
      if (balances.has(key)) continue;
      const [b] = await tx
        .select({ balance: leaveBalances.balance })
        .from(leaveBalances)
        .where(
          and(
            eq(leaveBalances.tenantId, tenantId),
            eq(leaveBalances.employeeId, r.employeeId),
            eq(leaveBalances.leaveTypeId, r.leaveTypeId),
            eq(leaveBalances.year, year),
          ),
        )
        .limit(1);
      balances.set(key, b?.balance ?? '0.00');
    }
    return rows.map((r) => {
      const year = Number(r.startDate.slice(0, 4));
      return {
        id: r.id,
        requestNumber: r.requestNumber,
        employeeId: r.employeeId,
        employeeName: r.employeeName,
        employeeNumber: r.employeeNumber,
        leaveTypeId: r.leaveTypeId,
        leaveTypeName: r.leaveTypeName,
        startDate: r.startDate,
        endDate: r.endDate,
        isHalfDay: r.isHalfDay,
        halfDayPeriod: r.halfDayPeriod,
        totalDays: r.totalDays,
        reason: r.reason,
        status: r.status,
        approverMembershipId: r.approverMembershipId,
        approverName: r.approverMembershipId
          ? (approverNames.get(r.approverMembershipId) ?? null)
          : null,
        decisionReason: r.decisionReason,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        availableBalance: balances.get(`${r.employeeId}:${r.leaveTypeId}:${year}`) ?? null,
        hasAttachment: !!r.attachmentObjectKey,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  private async loadBalances(
    tx: Tx,
    tenantId: string,
    employeeId: string,
  ): Promise<LeaveBalanceDto[]> {
    const year = new Date().getFullYear();
    const rows = await tx
      .select({
        leaveTypeId: leaveTypes.id,
        leaveTypeName: leaveTypes.name,
        opening: leaveBalances.opening,
        accrued: leaveBalances.accrued,
        consumed: leaveBalances.consumed,
        adjusted: leaveBalances.adjusted,
        balance: leaveBalances.balance,
      })
      .from(leaveTypes)
      .leftJoin(
        leaveBalances,
        and(
          eq(leaveBalances.leaveTypeId, leaveTypes.id),
          eq(leaveBalances.tenantId, tenantId),
          eq(leaveBalances.employeeId, employeeId),
          eq(leaveBalances.year, year),
        ),
      )
      .where(and(eq(leaveTypes.tenantId, tenantId), eq(leaveTypes.status, 'ACTIVE')))
      .orderBy(leaveTypes.name);
    return rows.map((r) => ({
      leaveTypeId: r.leaveTypeId,
      leaveTypeName: r.leaveTypeName,
      year,
      opening: r.opening ?? '0.00',
      accrued: r.accrued ?? '0.00',
      consumed: r.consumed ?? '0.00',
      adjusted: r.adjusted ?? '0.00',
      balance: r.balance ?? '0.00',
    }));
  }

  private async ensureBalanceRow(
    tx: Tx,
    tenantId: string,
    employeeId: string,
    leaveTypeId: string,
    year: number,
  ): Promise<void> {
    const [pol] = await tx
      .select({ quota: leavePolicies.annualQuota })
      .from(leavePolicies)
      .where(and(eq(leavePolicies.tenantId, tenantId), eq(leavePolicies.leaveTypeId, leaveTypeId)))
      .limit(1);
    await tx
      .insert(leaveBalances)
      .values({
        tenantId,
        employeeId,
        leaveTypeId,
        year,
        opening: pol?.quota ?? '0',
      })
      .onConflictDoNothing({
        target: [
          leaveBalances.tenantId,
          leaveBalances.employeeId,
          leaveBalances.leaveTypeId,
          leaveBalances.year,
        ],
      });
  }
}
