import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import { HrScope, pageBounds, type Paged } from './common.js';
import type { CreateIncentiveDto, IncentiveDto } from './hr.dto.js';

const { incentives, employees } = schema;

/**
 * Incentives (Phase 12, ADR 0041) — generic records only. `type` is free text
 * (tenant-defined) — no hardcoded sales-commission / installation-bonus concept.
 * Other modules can feed incentive inputs later through a narrow contract
 * (an approved incentive row carrying `sourceRef`); HR never queries CRM/Field.
 * An APPROVED incentive in a period's window is picked up by payroll processing.
 */
@Injectable()
export class IncentivesService {
  constructor(private readonly audit: AuditService) {}

  list(
    scope: HrScope,
    query: { employeeId?: string; status?: string; page?: number; pageSize?: number },
  ): Promise<Paged<IncentiveDto>> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [eq(incentives.tenantId, scope.tenantId)];
      if (query.employeeId) conds.push(eq(incentives.employeeId, query.employeeId));
      if (query.status) conds.push(eq(incentives.status, query.status as 'DRAFT'));
      const where = and(...conds)!;
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(incentives)
        .where(where);
      const rows = await tx
        .select({
          id: incentives.id,
          employeeId: incentives.employeeId,
          employeeName: employees.displayName,
          amount: incentives.amount,
          currency: incentives.currency,
          type: incentives.type,
          reason: incentives.reason,
          status: incentives.status,
          payrollPeriodId: incentives.payrollPeriodId,
          createdAt: incentives.createdAt,
        })
        .from(incentives)
        .innerJoin(employees, eq(employees.id, incentives.employeeId))
        .where(where)
        .orderBy(desc(incentives.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  async create(scope: HrScope, body: CreateIncentiveDto): Promise<IncentiveDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      const [emp] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(and(eq(employees.tenantId, scope.tenantId), eq(employees.id, body.employeeId)))
        .limit(1);
      if (!emp) throw new AppError('HR_EMPLOYEE_NOT_FOUND');
      const [row] = await tx
        .insert(incentives)
        .values({
          tenantId: scope.tenantId,
          employeeId: body.employeeId,
          amount: body.amount,
          currency: (body.currency ?? 'INR').toUpperCase(),
          type: body.type.trim(),
          reason: body.reason ?? null,
          sourceRef: body.sourceRef ?? null,
          status: 'DRAFT',
          createdByMembershipId: scope.actorMembershipId,
        })
        .returning({ id: incentives.id });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.incentive.created',
        entityType: 'incentive',
        entityId: row!.id,
        actor: userActor(scope),
        metadata: { employeeId: body.employeeId, amount: body.amount, type: body.type },
      });
      return row!.id;
    });
    return this.get(scope, id);
  }

  async approve(scope: HrScope, id: string): Promise<IncentiveDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(incentives)
        .where(and(eq(incentives.tenantId, scope.tenantId), eq(incentives.id, id)))
        .for('update')
        .limit(1);
      if (!row) throw new AppError('HR_INCENTIVE_NOT_FOUND');
      if (row.status === 'APPROVED') return;
      if (row.status !== 'DRAFT')
        throw new AppError('HR_INVALID_STATE', { details: { from: row.status } });
      await tx
        .update(incentives)
        .set({
          status: 'APPROVED',
          approvedByMembershipId: scope.actorMembershipId,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(incentives.id, id));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.incentive.approved',
        entityType: 'incentive',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: row.status, to: 'APPROVED' } },
      });
    });
    return this.get(scope, id);
  }

  get(scope: HrScope, id: string): Promise<IncentiveDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select({
          id: incentives.id,
          employeeId: incentives.employeeId,
          employeeName: employees.displayName,
          amount: incentives.amount,
          currency: incentives.currency,
          type: incentives.type,
          reason: incentives.reason,
          status: incentives.status,
          payrollPeriodId: incentives.payrollPeriodId,
          createdAt: incentives.createdAt,
        })
        .from(incentives)
        .innerJoin(employees, eq(employees.id, incentives.employeeId))
        .where(and(eq(incentives.tenantId, scope.tenantId), eq(incentives.id, id)))
        .limit(1);
      if (!row) throw new AppError('HR_INCENTIVE_NOT_FOUND');
      return { ...row, createdAt: row.createdAt.toISOString() };
    });
  }
}
