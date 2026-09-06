import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import {
  canTransitionExpense,
  isExpenseAmountLocked,
  type ExpenseClaimStatus,
} from './lifecycles.js';
import { mileageAmount } from './money.js';
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
  CreateExpenseClaimDto,
  ExpenseCategoryDto,
  ExpenseClaimDto,
  ExpenseDecisionDto,
  ListExpenseQueryDto,
  RecordReimbursementDto,
  UpsertExpenseCategoryDto,
} from './hr.dto.js';

const { expenseCategories, expenseClaims, expenseReimbursements, employees } = schema;

/**
 * Expense claims & reimbursements (Phase 12, ADR 0041) — a first-class HR
 * workflow, NOT a list. Employees and (through a narrow capability) field
 * agents raise claims; approval freezes the approved amount; a reimbursement
 * record captures the actual payment. HR owns "I incurred it and am owed it";
 * a future Finance adapter can consume an approved claim without changing this.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  // ---- categories (hr.expense.manage) --------------------

  listCategories(scope: HrScope): Promise<ExpenseCategoryDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(expenseCategories)
        .where(eq(expenseCategories.tenantId, scope.tenantId))
        .orderBy(expenseCategories.name);
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        defaultMileageRate: r.defaultMileageRate,
        requiresReceipt: r.requiresReceipt,
        status: r.status,
      }));
    });
  }

  async upsertCategory(
    scope: HrScope,
    body: UpsertExpenseCategoryDto,
    id?: string,
  ): Promise<ExpenseCategoryDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      try {
        if (id) {
          const res = await tx
            .update(expenseCategories)
            .set({
              name: body.name.trim(),
              code: body.code.trim(),
              defaultMileageRate: body.defaultMileageRate ?? null,
              requiresReceipt: body.requiresReceipt ?? true,
              updatedAt: new Date(),
            })
            .where(
              and(eq(expenseCategories.id, id), eq(expenseCategories.tenantId, scope.tenantId)),
            )
            .returning({ id: expenseCategories.id });
          if (res.length === 0) throw new AppError('HR_EXPENSE_CATEGORY_NOT_FOUND');
        } else {
          await tx.insert(expenseCategories).values({
            tenantId: scope.tenantId,
            name: body.name.trim(),
            code: body.code.trim(),
            defaultMileageRate: body.defaultMileageRate ?? null,
            requiresReceipt: body.requiresReceipt ?? true,
          });
        }
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('HR_DUPLICATE_CODE', { details: { code: body.code } });
        throw err;
      }
    });
    return (await this.listCategories(scope)).find((c) => c.code === body.code.trim())!;
  }

  // ---- claims -------------------------------------------

  /** Narrow capability used by the Field module (a claim referencing a visit).
   *  The Field module never touches HR tables directly — it calls this. */
  async createClaimFor(
    scope: HrScope,
    input: CreateExpenseClaimDto & { employeeId: string },
    autoSubmit: boolean,
  ): Promise<ExpenseClaimDto> {
    const id = await withTenantContext(getDb(), scope, (tx) =>
      this.insertClaim(tx, scope, input, input.employeeId, autoSubmit),
    );
    return this.get(scope, id);
  }

  /**
   * THE approved Field → HR seam. A field agent raises an expense claim tied to
   * a visit they worked. The employee is resolved from the caller's own
   * authenticated membership — never from client input — so a field agent can
   * only ever claim for themselves. The Field module passes an opaque
   * `visitRef`; HR stores it as a soft reference and never dereferences it.
   * Field validates visit ownership before calling.
   */
  async createFromFieldVisit(
    scope: HrScope,
    input: {
      visitId: string;
      categoryId: string;
      expenseDate: string;
      amount: string;
      currency?: string;
      description?: string;
      merchant?: string;
      distanceKm?: string;
      notes?: string;
      autoSubmit: boolean;
    },
  ): Promise<ExpenseClaimDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      const employeeId = await resolveMyEmployeeId(tx, scope.tenantId, scope.actorMembershipId);
      const body: CreateExpenseClaimDto = {
        categoryId: input.categoryId,
        expenseDate: input.expenseDate,
        amount: input.amount,
        currency: input.currency,
        description: input.description,
        merchant: input.merchant,
        distanceKm: input.distanceKm,
        notes: input.notes,
        visitRef: input.visitId,
      };
      return this.insertClaim(tx, scope, body, employeeId, input.autoSubmit);
    });
    return this.get(scope, id);
  }

  /**
   * Create a claim. `body.employeeId` is honoured ONLY when `canActForOthers`
   * is true (caller holds `hr.expense.manage`); otherwise the claim is always
   * filed against the caller's own linked employee — a plain submitter can
   * never file on someone else's behalf by passing an id.
   */
  async createClaim(
    scope: HrScope,
    body: CreateExpenseClaimDto,
    canActForOthers = false,
  ): Promise<ExpenseClaimDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      const myEmployeeId = await findMyEmployeeId(tx, scope.tenantId, scope.actorMembershipId);
      let employeeId: string;
      if (body.employeeId && body.employeeId !== myEmployeeId) {
        if (!canActForOthers) throw new AppError('HR_FORBIDDEN_FOR_OTHERS');
        employeeId = body.employeeId;
      } else {
        employeeId =
          myEmployeeId ?? (await resolveMyEmployeeId(tx, scope.tenantId, scope.actorMembershipId));
      }
      return this.insertClaim(tx, scope, body, employeeId, false);
    });
    return this.get(scope, id);
  }

  async submit(scope: HrScope, id: string): Promise<ExpenseClaimDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const claim = await this.lock(tx, scope.tenantId, id);
      if (claim.status === 'SUBMITTED') return;
      if (!canTransitionExpense(claim.status as ExpenseClaimStatus, 'SUBMITTED')) {
        throw new AppError('HR_INVALID_STATE', { details: { from: claim.status } });
      }
      await tx
        .update(expenseClaims)
        .set({ status: 'SUBMITTED', submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(expenseClaims.id, id));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.expense.submitted',
        entityType: 'expense_claim',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: claim.status, to: 'SUBMITTED' } },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'hr.expense.submitted',
        payload: { expenseClaimId: id, employeeId: claim.employeeId },
        actorMembershipId: scope.actorMembershipId,
      });
    });
    return this.get(scope, id);
  }

  async decide(
    scope: HrScope,
    id: string,
    outcome: 'APPROVED' | 'REJECTED',
    body: ExpenseDecisionDto,
  ): Promise<ExpenseClaimDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const claim = await this.lock(tx, scope.tenantId, id);
      if (!canTransitionExpense(claim.status as ExpenseClaimStatus, outcome)) {
        throw new AppError('HR_INVALID_STATE', { details: { from: claim.status, to: outcome } });
      }
      // separation of duties: an approver cannot approve their own claim
      const myEmpId = await findMyEmployeeId(tx, scope.tenantId, scope.actorMembershipId);
      if (myEmpId && myEmpId === claim.employeeId) throw new AppError('HR_SELF_APPROVAL_FORBIDDEN');

      const set: Record<string, unknown> = {
        status: outcome,
        approverMembershipId: scope.actorMembershipId,
        decidedByMembershipId: scope.actorMembershipId,
        decidedAt: new Date(),
        decisionReason: body.reason ?? null,
        updatedAt: new Date(),
      };
      if (outcome === 'APPROVED') {
        const approved = body.approvedAmount ?? claim.reimbursementAmount ?? claim.amount;
        set.approvedAmount = approved;
      }
      await tx.update(expenseClaims).set(set).where(eq(expenseClaims.id, id));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: outcome === 'APPROVED' ? 'hr.expense.approved' : 'hr.expense.rejected',
        entityType: 'expense_claim',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: claim.status, to: outcome } },
        metadata: {
          approvedAmount: outcome === 'APPROVED' ? (set.approvedAmount as string) : undefined,
          reason: body.reason ?? undefined,
        },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: outcome === 'APPROVED' ? 'hr.expense.approved' : 'hr.expense.rejected',
        payload: { expenseClaimId: id, employeeId: claim.employeeId },
        actorMembershipId: scope.actorMembershipId,
      });
    });
    return this.get(scope, id);
  }

  async cancel(scope: HrScope, id: string, canManage: boolean): Promise<ExpenseClaimDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const claim = await this.lock(tx, scope.tenantId, id);
      if (!canTransitionExpense(claim.status as ExpenseClaimStatus, 'CANCELLED')) {
        throw new AppError('HR_INVALID_STATE', { details: { from: claim.status } });
      }
      const myEmpId = await findMyEmployeeId(tx, scope.tenantId, scope.actorMembershipId);
      if (!canManage && myEmpId !== claim.employeeId) throw new AppError('AUTH_FORBIDDEN');
      await tx
        .update(expenseClaims)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(eq(expenseClaims.id, id));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.expense.cancelled',
        entityType: 'expense_claim',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: claim.status, to: 'CANCELLED' } },
      });
    });
    return this.get(scope, id);
  }

  async reimburse(
    scope: HrScope,
    id: string,
    body: RecordReimbursementDto,
  ): Promise<ExpenseClaimDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const claim = await this.lock(tx, scope.tenantId, id);
      if (
        claim.status !== 'APPROVED' &&
        claim.status !== 'REIMBURSEMENT_PENDING' &&
        claim.status !== 'REIMBURSEMENT_FAILED'
      ) {
        throw new AppError('HR_INVALID_STATE', { details: { from: claim.status } });
      }
      const failed = body.status === 'FAILED';
      const nextStatus: ExpenseClaimStatus = failed ? 'REIMBURSEMENT_FAILED' : 'REIMBURSED';

      await tx
        .insert(expenseReimbursements)
        .values({
          tenantId: scope.tenantId,
          expenseClaimId: id,
          reimbursedAmount: body.reimbursedAmount,
          currency: claim.currency,
          paymentDate: body.paymentDate.slice(0, 10),
          paymentMethod: body.paymentMethod as 'BANK_TRANSFER',
          paymentReference: body.paymentReference ?? null,
          transactionRef: body.transactionRef ?? null,
          status: failed ? 'FAILED' : 'PAID',
          failureReason: failed ? (body.failureReason ?? null) : null,
          processedByMembershipId: scope.actorMembershipId,
        })
        .onConflictDoUpdate({
          target: [expenseReimbursements.tenantId, expenseReimbursements.expenseClaimId],
          set: {
            reimbursedAmount: body.reimbursedAmount,
            paymentDate: body.paymentDate.slice(0, 10),
            paymentMethod: body.paymentMethod as 'BANK_TRANSFER',
            paymentReference: body.paymentReference ?? null,
            transactionRef: body.transactionRef ?? null,
            status: failed ? 'FAILED' : 'PAID',
            failureReason: failed ? (body.failureReason ?? null) : null,
            processedByMembershipId: scope.actorMembershipId,
            updatedAt: new Date(),
          },
        });
      await tx
        .update(expenseClaims)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(expenseClaims.id, id));

      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: failed ? 'hr.expense.reimbursement_failed' : 'hr.expense.reimbursed',
        entityType: 'expense_claim',
        entityId: id,
        actor: userActor(scope),
        changes: { status: { from: claim.status, to: nextStatus } },
        metadata: {
          reimbursedAmount: body.reimbursedAmount,
          paymentMethod: body.paymentMethod,
          reference: body.paymentReference ?? null,
        },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: failed ? 'hr.expense.reimbursement_failed' : 'hr.expense.reimbursed',
        payload: { expenseClaimId: id, employeeId: claim.employeeId },
        actorMembershipId: scope.actorMembershipId,
      });
    });
    return this.get(scope, id);
  }

  // ---- reads ------------------------------------------

  list(scope: HrScope, query: ListExpenseQueryDto): Promise<Paged<ExpenseClaimDto>> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [eq(expenseClaims.tenantId, scope.tenantId)];
      if (query.employeeId) conds.push(eq(expenseClaims.employeeId, query.employeeId));
      if (query.categoryId) conds.push(eq(expenseClaims.categoryId, query.categoryId));
      if (query.status) conds.push(eq(expenseClaims.status, query.status as 'DRAFT'));
      if (query.visitRef) conds.push(eq(expenseClaims.visitRef, query.visitRef));
      if (query.from) conds.push(gte(expenseClaims.expenseDate, query.from.slice(0, 10)));
      if (query.to) conds.push(lte(expenseClaims.expenseDate, query.to.slice(0, 10)));
      const where = and(...conds)!;
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(expenseClaims)
        .where(where);
      const rows = await tx
        .select(this.cols())
        .from(expenseClaims)
        .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
        .innerJoin(expenseCategories, eq(expenseCategories.id, expenseClaims.categoryId))
        .where(where)
        .orderBy(desc(expenseClaims.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const reimb = await this.reimbursements(
        tx,
        scope.tenantId,
        rows.map((r) => r.id),
      );
      return {
        items: rows.map((r) => this.toDto(r, reimb.get(r.id) ?? null)),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  get(scope: HrScope, id: string): Promise<ExpenseClaimDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select(this.cols())
        .from(expenseClaims)
        .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
        .innerJoin(expenseCategories, eq(expenseCategories.id, expenseClaims.categoryId))
        .where(and(eq(expenseClaims.tenantId, scope.tenantId), eq(expenseClaims.id, id)))
        .limit(1);
      if (!row) throw new AppError('HR_EXPENSE_NOT_FOUND');
      const reimb = await this.reimbursements(tx, scope.tenantId, [id]);
      return this.toDto(row, reimb.get(id) ?? null);
    });
  }

  receiptObjectKey(scope: HrScope, id: string): Promise<string | null> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select({ key: expenseClaims.receiptObjectKey })
        .from(expenseClaims)
        .where(and(eq(expenseClaims.tenantId, scope.tenantId), eq(expenseClaims.id, id)))
        .limit(1);
      if (!row) throw new AppError('HR_EXPENSE_NOT_FOUND');
      return row.key;
    });
  }

  async setReceiptKey(scope: HrScope, id: string, objectKey: string): Promise<void> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const claim = await this.lock(tx, scope.tenantId, id);
      if (isExpenseAmountLocked(claim.status as ExpenseClaimStatus)) {
        throw new AppError('HR_INVALID_STATE', {
          details: { hint: 'claim is no longer editable' },
        });
      }
      await tx
        .update(expenseClaims)
        .set({ receiptObjectKey: objectKey, updatedAt: new Date() })
        .where(eq(expenseClaims.id, id));
    });
  }

  // ---- internals ---------------------------------

  private async insertClaim(
    tx: Tx,
    scope: HrScope,
    body: CreateExpenseClaimDto,
    employeeId: string,
    autoSubmit: boolean,
  ): Promise<string> {
    const [emp] = await tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, scope.tenantId), eq(employees.id, employeeId)))
      .limit(1);
    if (!emp) throw new AppError('HR_EMPLOYEE_NOT_FOUND');
    const [cat] = await tx
      .select()
      .from(expenseCategories)
      .where(
        and(
          eq(expenseCategories.tenantId, scope.tenantId),
          eq(expenseCategories.id, body.categoryId),
        ),
      )
      .limit(1);
    if (!cat) throw new AppError('HR_EXPENSE_CATEGORY_NOT_FOUND');

    const currency = (body.currency ?? 'INR').toUpperCase();
    const isMileage = !!cat.defaultMileageRate && !!body.distanceKm;
    const reimbursementAmount = isMileage
      ? mileageAmount(body.distanceKm!, cat.defaultMileageRate!)
      : body.amount;
    const number = await nextHrNumber(tx, scope.tenantId, 'expense_claim');

    const [row] = await tx
      .insert(expenseClaims)
      .values({
        tenantId: scope.tenantId,
        claimNumber: number,
        employeeId,
        categoryId: body.categoryId,
        claimDate: new Date().toISOString().slice(0, 10),
        expenseDate: body.expenseDate.slice(0, 10),
        amount: body.amount,
        currency,
        description: body.description ?? null,
        merchant: body.merchant ?? null,
        projectRef: body.projectRef ?? null,
        visitRef: body.visitRef ?? null,
        distanceKm: body.distanceKm ?? null,
        mileageRate: isMileage ? cat.defaultMileageRate : null,
        reimbursementAmount,
        status: autoSubmit ? 'SUBMITTED' : 'DRAFT',
        submittedAt: autoSubmit ? new Date() : null,
        notes: body.notes ?? null,
        createdByMembershipId: scope.actorMembershipId,
      })
      .returning({ id: expenseClaims.id });

    await this.audit.record(tx, {
      tenantId: scope.tenantId,
      action: autoSubmit ? 'hr.expense.submitted' : 'hr.expense.created',
      entityType: 'expense_claim',
      entityId: row!.id,
      actor: userActor(scope),
      metadata: {
        number,
        employeeId,
        categoryId: body.categoryId,
        amount: body.amount,
        currency,
        visitRef: body.visitRef ?? null,
      },
    });
    if (autoSubmit) {
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'hr.expense.submitted',
        payload: { expenseClaimId: row!.id, employeeId },
        actorMembershipId: scope.actorMembershipId,
      });
    }
    return row!.id;
  }

  private cols() {
    return {
      id: expenseClaims.id,
      claimNumber: expenseClaims.claimNumber,
      employeeId: expenseClaims.employeeId,
      employeeName: employees.displayName,
      employeeNumber: employees.employeeNumber,
      categoryName: expenseCategories.name,
      expenseDate: expenseClaims.expenseDate,
      amount: expenseClaims.amount,
      currency: expenseClaims.currency,
      approvedAmount: expenseClaims.approvedAmount,
      reimbursementAmount: expenseClaims.reimbursementAmount,
      description: expenseClaims.description,
      merchant: expenseClaims.merchant,
      projectRef: expenseClaims.projectRef,
      visitRef: expenseClaims.visitRef,
      distanceKm: expenseClaims.distanceKm,
      status: expenseClaims.status,
      receiptObjectKey: expenseClaims.receiptObjectKey,
      decidedAt: expenseClaims.decidedAt,
      decisionReason: expenseClaims.decisionReason,
      createdAt: expenseClaims.createdAt,
    };
  }

  private toDto(
    r: {
      id: string;
      claimNumber: string;
      employeeId: string;
      employeeName: string;
      employeeNumber: string;
      categoryName: string;
      expenseDate: string;
      amount: string;
      currency: string;
      approvedAmount: string | null;
      reimbursementAmount: string | null;
      description: string | null;
      merchant: string | null;
      projectRef: string | null;
      visitRef: string | null;
      distanceKm: string | null;
      status: string;
      receiptObjectKey: string | null;
      decidedAt: Date | null;
      decisionReason: string | null;
      createdAt: Date;
    },
    reimb: schema.ExpenseReimbursementRow | null,
  ): ExpenseClaimDto {
    return {
      id: r.id,
      claimNumber: r.claimNumber,
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      employeeNumber: r.employeeNumber,
      categoryName: r.categoryName,
      expenseDate: r.expenseDate,
      amount: r.amount,
      currency: r.currency,
      approvedAmount: r.approvedAmount,
      reimbursementAmount: r.reimbursementAmount,
      description: r.description,
      merchant: r.merchant,
      projectRef: r.projectRef,
      visitRef: r.visitRef,
      distanceKm: r.distanceKm,
      status: r.status,
      hasReceipt: !!r.receiptObjectKey,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionReason: r.decisionReason,
      reimbursement: reimb
        ? {
            reimbursedAmount: reimb.reimbursedAmount,
            paymentDate: reimb.paymentDate,
            paymentMethod: reimb.paymentMethod,
            paymentReference: reimb.paymentReference,
            transactionRef: reimb.transactionRef,
            status: reimb.status,
            failureReason: reimb.failureReason,
          }
        : null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private async reimbursements(
    tx: Tx,
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, schema.ExpenseReimbursementRow>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select()
      .from(expenseReimbursements)
      .where(
        and(
          eq(expenseReimbursements.tenantId, tenantId),
          inArray(expenseReimbursements.expenseClaimId, ids),
        ),
      );
    return new Map(rows.map((r) => [r.expenseClaimId, r]));
  }

  private async lock(tx: Tx, tenantId: string, id: string): Promise<schema.ExpenseClaimRow> {
    const [row] = await tx
      .select()
      .from(expenseClaims)
      .where(and(eq(expenseClaims.tenantId, tenantId), eq(expenseClaims.id, id)))
      .for('update')
      .limit(1);
    if (!row) throw new AppError('HR_EXPENSE_NOT_FOUND');
    return row;
  }
}
