import { Injectable } from '@nestjs/common';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { canTransitionReview, type PerformanceReviewStatus } from './lifecycles.js';
import { HrScope, isUniqueViolation } from './common.js';
import type {
  CreateGoalDto,
  CreatePerformancePeriodDto,
  CreateReviewDto,
  PerformanceGoalDto,
  PerformancePeriodDto,
  PerformanceReviewDto,
  UpdateReviewDto,
} from './hr.dto.js';

const { performancePeriods, performanceGoals, performanceReviews, employees } = schema;

/**
 * Lightweight performance management (Phase 12, ADR 0041): periods, goals and
 * reviews with manager + employee comments. No talent-management engine, no AI
 * scoring, no calibration. A review moves DRAFT → SUBMITTED → ACKNOWLEDGED →
 * CLOSED; the employee acknowledges their own review.
 */
@Injectable()
export class PerformanceService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  // ---- periods --------------------------------------

  listPeriods(scope: HrScope): Promise<PerformancePeriodDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(performancePeriods)
        .where(eq(performancePeriods.tenantId, scope.tenantId))
        .orderBy(desc(performancePeriods.periodStart));
      return rows.map(periodDto);
    });
  }

  async createPeriod(
    scope: HrScope,
    body: CreatePerformancePeriodDto,
  ): Promise<PerformancePeriodDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      if (body.periodEnd < body.periodStart)
        throw new AppError('HR_INVALID_STATE', { details: { hint: 'end before start' } });
      try {
        const [row] = await tx
          .insert(performancePeriods)
          .values({
            tenantId: scope.tenantId,
            name: body.name.trim(),
            periodStart: body.periodStart.slice(0, 10),
            periodEnd: body.periodEnd.slice(0, 10),
            status: 'DRAFT',
            createdByMembershipId: scope.actorMembershipId,
          })
          .returning();
        return periodDto(row!);
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('HR_DUPLICATE_CODE', { details: { name: body.name } });
        throw err;
      }
    });
  }

  async setPeriodStatus(
    scope: HrScope,
    id: string,
    status: 'OPEN' | 'CLOSED',
  ): Promise<PerformancePeriodDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .update(performancePeriods)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(performancePeriods.tenantId, scope.tenantId), eq(performancePeriods.id, id)))
        .returning();
      if (!row) throw new AppError('HR_PERFORMANCE_NOT_FOUND');
      return periodDto(row);
    });
  }

  // ---- goals ---------------------------------------

  listGoals(
    scope: HrScope,
    query: { performancePeriodId?: string; employeeId?: string },
  ): Promise<PerformanceGoalDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [eq(performanceGoals.tenantId, scope.tenantId)];
      if (query.performancePeriodId)
        conds.push(eq(performanceGoals.performancePeriodId, query.performancePeriodId));
      if (query.employeeId) conds.push(eq(performanceGoals.employeeId, query.employeeId));
      const rows = await tx
        .select({
          id: performanceGoals.id,
          performancePeriodId: performanceGoals.performancePeriodId,
          employeeId: performanceGoals.employeeId,
          employeeName: employees.displayName,
          title: performanceGoals.title,
          description: performanceGoals.description,
          weight: performanceGoals.weight,
          status: performanceGoals.status,
        })
        .from(performanceGoals)
        .innerJoin(employees, eq(employees.id, performanceGoals.employeeId))
        .where(and(...conds))
        .orderBy(desc(performanceGoals.createdAt));
      return rows;
    });
  }

  async createGoal(scope: HrScope, body: CreateGoalDto): Promise<PerformanceGoalDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      await requireEmployee(tx, scope.tenantId, body.employeeId);
      await requirePeriod(tx, scope.tenantId, body.performancePeriodId);
      const [row] = await tx
        .insert(performanceGoals)
        .values({
          tenantId: scope.tenantId,
          performancePeriodId: body.performancePeriodId,
          employeeId: body.employeeId,
          title: body.title.trim(),
          description: body.description ?? null,
          weight: body.weight ?? null,
          status: 'OPEN',
          createdByMembershipId: scope.actorMembershipId,
        })
        .returning({ id: performanceGoals.id });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.performance.goal_created',
        entityType: 'performance_goal',
        entityId: row!.id,
        actor: userActor(scope),
        metadata: {
          employeeId: body.employeeId,
          performancePeriodId: body.performancePeriodId,
          title: body.title,
        },
      });
      return row!.id;
    });
    const [g] = await this.listGoals(scope, {}).then((all) => all.filter((x) => x.id === id));
    return g!;
  }

  async setGoalStatus(
    scope: HrScope,
    id: string,
    status: 'OPEN' | 'ACHIEVED' | 'MISSED' | 'CANCELLED',
  ): Promise<PerformanceGoalDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .update(performanceGoals)
        .set({ status, updatedAt: new Date() })
        .where(and(eq(performanceGoals.tenantId, scope.tenantId), eq(performanceGoals.id, id)))
        .returning({ id: performanceGoals.id });
      if (!row) throw new AppError('HR_PERFORMANCE_NOT_FOUND');
    });
    const [g] = await this.listGoals(scope, {}).then((all) => all.filter((x) => x.id === id));
    return g!;
  }

  // ---- reviews ------------------------------------

  listReviews(
    scope: HrScope,
    query: { performancePeriodId?: string; employeeId?: string },
  ): Promise<PerformanceReviewDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [eq(performanceReviews.tenantId, scope.tenantId)];
      if (query.performancePeriodId)
        conds.push(eq(performanceReviews.performancePeriodId, query.performancePeriodId));
      if (query.employeeId) conds.push(eq(performanceReviews.employeeId, query.employeeId));
      return this.loadReviews(tx, scope.tenantId, and(...conds)!);
    });
  }

  async createReview(scope: HrScope, body: CreateReviewDto): Promise<PerformanceReviewDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      await requireEmployee(tx, scope.tenantId, body.employeeId);
      await requirePeriod(tx, scope.tenantId, body.performancePeriodId);
      try {
        const [row] = await tx
          .insert(performanceReviews)
          .values({
            tenantId: scope.tenantId,
            performancePeriodId: body.performancePeriodId,
            employeeId: body.employeeId,
            reviewerMembershipId: scope.actorMembershipId,
            overallRating: body.overallRating ?? null,
            managerComments: body.managerComments ?? null,
            status: 'DRAFT',
            createdByMembershipId: scope.actorMembershipId,
          })
          .returning({ id: performanceReviews.id });
        return row!.id;
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('HR_DUPLICATE_CODE', {
            details: { hint: 'review already exists for this employee and period' },
          });
        throw err;
      }
    });
    return this.getReview(scope, id);
  }

  async updateReview(
    scope: HrScope,
    id: string,
    body: UpdateReviewDto,
  ): Promise<PerformanceReviewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const row = await lockReview(tx, scope.tenantId, id);
      if (row.status === 'CLOSED')
        throw new AppError('HR_INVALID_STATE', { details: { hint: 'review is closed' } });
      await tx
        .update(performanceReviews)
        .set({
          overallRating: body.overallRating ?? row.overallRating,
          managerComments: body.managerComments ?? row.managerComments,
          employeeComments: body.employeeComments ?? row.employeeComments,
          updatedAt: new Date(),
        })
        .where(eq(performanceReviews.id, id));
    });
    return this.getReview(scope, id);
  }

  /** DRAFT → SUBMITTED. Emits the notification event so the employee is told. */
  async submitReview(scope: HrScope, id: string): Promise<PerformanceReviewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const row = await lockReview(tx, scope.tenantId, id);
      assertTransition(row.status, 'SUBMITTED');
      await tx
        .update(performanceReviews)
        .set({ status: 'SUBMITTED', submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(performanceReviews.id, id));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.performance.review_submitted',
        entityType: 'performance_review',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: row.status, to: 'SUBMITTED' } },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'hr.performance.review_submitted',
        payload: { performanceReviewId: id, employeeId: row.employeeId },
        actorMembershipId: scope.actorMembershipId,
      });
    });
    return this.getReview(scope, id);
  }

  /** SUBMITTED → ACKNOWLEDGED. Only the reviewed employee may acknowledge. */
  async acknowledgeReview(
    scope: HrScope,
    id: string,
    myEmployeeId: string,
  ): Promise<PerformanceReviewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const row = await lockReview(tx, scope.tenantId, id);
      if (row.employeeId !== myEmployeeId)
        throw new AppError('HR_NOT_THE_APPROVER', {
          details: { hint: 'only the reviewed employee can acknowledge' },
        });
      assertTransition(row.status, 'ACKNOWLEDGED');
      await tx
        .update(performanceReviews)
        .set({ status: 'ACKNOWLEDGED', acknowledgedAt: new Date(), updatedAt: new Date() })
        .where(eq(performanceReviews.id, id));
    });
    return this.getReview(scope, id);
  }

  async closeReview(scope: HrScope, id: string): Promise<PerformanceReviewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const row = await lockReview(tx, scope.tenantId, id);
      assertTransition(row.status, 'CLOSED');
      await tx
        .update(performanceReviews)
        .set({ status: 'CLOSED', updatedAt: new Date() })
        .where(eq(performanceReviews.id, id));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.performance.review_closed',
        entityType: 'performance_review',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: row.status, to: 'CLOSED' } },
      });
    });
    return this.getReview(scope, id);
  }

  getReview(scope: HrScope, id: string): Promise<PerformanceReviewDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await this.loadReviews(
        tx,
        scope.tenantId,
        and(eq(performanceReviews.tenantId, scope.tenantId), eq(performanceReviews.id, id))!,
      );
      if (!row) throw new AppError('HR_PERFORMANCE_NOT_FOUND');
      return row;
    });
  }

  private async loadReviews(tx: Tx, tenantId: string, where: SQL): Promise<PerformanceReviewDto[]> {
    const rows = await tx
      .select({
        id: performanceReviews.id,
        performancePeriodId: performanceReviews.performancePeriodId,
        periodName: performancePeriods.name,
        employeeId: performanceReviews.employeeId,
        employeeName: employees.displayName,
        overallRating: performanceReviews.overallRating,
        managerComments: performanceReviews.managerComments,
        employeeComments: performanceReviews.employeeComments,
        status: performanceReviews.status,
        submittedAt: performanceReviews.submittedAt,
        createdAt: performanceReviews.createdAt,
      })
      .from(performanceReviews)
      .innerJoin(
        performancePeriods,
        eq(performancePeriods.id, performanceReviews.performancePeriodId),
      )
      .innerJoin(employees, eq(employees.id, performanceReviews.employeeId))
      .where(where)
      .orderBy(desc(performanceReviews.createdAt));
    return rows.map((r) => ({
      ...r,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

function periodDto(r: schema.PerformancePeriodRow): PerformancePeriodDto {
  return {
    id: r.id,
    name: r.name,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    status: r.status,
  };
}

function assertTransition(from: string, to: PerformanceReviewStatus): void {
  if (!canTransitionReview(from as PerformanceReviewStatus, to)) {
    throw new AppError('HR_INVALID_STATE', { details: { from, to } });
  }
}

async function requireEmployee(tx: Tx, tenantId: string, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.id, id)))
    .limit(1);
  if (!row) throw new AppError('HR_EMPLOYEE_NOT_FOUND');
}

async function requirePeriod(tx: Tx, tenantId: string, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: performancePeriods.id })
    .from(performancePeriods)
    .where(and(eq(performancePeriods.tenantId, tenantId), eq(performancePeriods.id, id)))
    .limit(1);
  if (!row) throw new AppError('HR_PERFORMANCE_NOT_FOUND');
}

async function lockReview(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<schema.PerformanceReviewRow> {
  const [row] = await tx
    .select()
    .from(performanceReviews)
    .where(and(eq(performanceReviews.tenantId, tenantId), eq(performanceReviews.id, id)))
    .for('update')
    .limit(1);
  if (!row) throw new AppError('HR_PERFORMANCE_NOT_FOUND');
  return row;
}
