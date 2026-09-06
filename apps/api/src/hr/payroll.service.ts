import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { DocumentRenderService } from '../documents/document-render.service.js';
import { canTransitionPayroll, isPayrollLocked, type PayrollPeriodStatus } from './lifecycles.js';
import { computePayrollTotals, sum, type PayComponent } from './money.js';
import { buildPayslipDocument } from './payslip.builder.js';
import { HrScope, isUniqueViolation, pageBounds, type Paged } from './common.js';
import type {
  CreatePayrollPeriodDto,
  PayrollEntryDto,
  PayrollHistoryItemDto,
  PayrollPeriodDetailDto,
  PayrollPeriodDto,
  RecordPayrollPaymentDto,
} from './hr.dto.js';

const {
  payrollPeriods,
  payrollEntries,
  payrollEntryComponents,
  payrollPayments,
  compensationProfiles,
  compensationComponents,
  incentives,
  expenseClaims,
  expenseReimbursements,
  employees,
} = schema;

/**
 * Operational payroll (Phase 12, ADR 0041). NOT a statutory payroll engine —
 * no PF/ESI/PAYE/tax filing. Money is exact fixed-point. When a period is
 * FINALIZED its entries become immutable snapshots: later changes to salary,
 * incentives, expenses, department or leave never alter finalized payroll.
 * Payment processing records operational payment state only — Aivoryx is not a
 * bank; bank integration is a future adapter.
 */
@Injectable()
export class PayrollService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly documents: DocumentRenderService,
  ) {}

  // ---- periods ----------------------------------------

  list(
    scope: HrScope,
    query: { status?: string; page?: number; pageSize?: number },
  ): Promise<Paged<PayrollPeriodDto>> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [eq(payrollPeriods.tenantId, scope.tenantId)];
      if (query.status) conds.push(eq(payrollPeriods.status, query.status as 'DRAFT'));
      const where = and(...conds)!;
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(payrollPeriods)
        .where(where);
      const rows = await tx
        .select()
        .from(payrollPeriods)
        .where(where)
        .orderBy(desc(payrollPeriods.periodStart))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const counts = await this.entryCounts(
        tx,
        scope.tenantId,
        rows.map((r) => r.id),
      );
      return {
        items: rows.map((r) => this.toDto(r, counts.get(r.id))),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  async create(scope: HrScope, body: CreatePayrollPeriodDto): Promise<PayrollPeriodDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      if (body.periodEnd < body.periodStart)
        throw new AppError('HR_INVALID_STATE', { details: { hint: 'end before start' } });
      try {
        const [row] = await tx
          .insert(payrollPeriods)
          .values({
            tenantId: scope.tenantId,
            name: body.name.trim(),
            periodStart: body.periodStart.slice(0, 10),
            periodEnd: body.periodEnd.slice(0, 10),
            payDate: body.payDate?.slice(0, 10) ?? null,
            currency: (body.currency ?? 'INR').toUpperCase(),
            status: 'DRAFT',
            createdByMembershipId: scope.actorMembershipId,
          })
          .returning({ id: payrollPeriods.id });
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'hr.payroll.created',
          entityType: 'payroll_period',
          entityId: row!.id,
          actor: userActor(scope),
          metadata: { name: body.name, periodStart: body.periodStart, periodEnd: body.periodEnd },
        });
        return row!.id;
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('HR_DUPLICATE_CODE', { details: { name: body.name } });
        throw err;
      }
    });
    return this.getPeriod(scope, id);
  }

  /** PROCESS: (re)build every entry from current compensation + approved
   *  incentives + reimbursed expenses in the period window. Draft-only. */
  async process(scope: HrScope, id: string): Promise<PayrollPeriodDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const period = await this.lock(tx, scope.tenantId, id);
      if (isPayrollLocked(period.status as PayrollPeriodStatus))
        throw new AppError('HR_PAYROLL_LOCKED');
      if (!canTransitionPayroll(period.status as PayrollPeriodStatus, 'PROCESSING')) {
        throw new AppError('HR_INVALID_STATE', { details: { from: period.status } });
      }

      // clear any prior draft entries
      await tx
        .delete(payrollEntries)
        .where(
          and(eq(payrollEntries.tenantId, scope.tenantId), eq(payrollEntries.payrollPeriodId, id)),
        );

      const emps = await tx
        .select({ id: employees.id, number: employees.employeeNumber, name: employees.displayName })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, scope.tenantId),
            inArray(employees.status, ['ACTIVE', 'ON_LEAVE']),
          ),
        );

      let gross = '0.00';
      let ded = '0.00';
      let inc = '0.00';
      let reimb = '0.00';
      let net = '0.00';

      for (const emp of emps) {
        // current compensation
        const [cp] = await tx
          .select()
          .from(compensationProfiles)
          .where(
            and(
              eq(compensationProfiles.tenantId, scope.tenantId),
              eq(compensationProfiles.employeeId, emp.id),
              eq(compensationProfiles.status, 'ACTIVE'),
              lte(compensationProfiles.effectiveDate, period.periodEnd),
            ),
          )
          .orderBy(desc(compensationProfiles.effectiveDate))
          .limit(1);
        if (!cp) continue; // no compensation -> not on payroll
        const cpComps = await tx
          .select()
          .from(compensationComponents)
          .where(
            and(
              eq(compensationComponents.tenantId, scope.tenantId),
              eq(compensationComponents.compensationProfileId, cp.id),
            ),
          );

        // approved incentives not yet tied to a period, dated in window
        const incRows = await tx
          .select()
          .from(incentives)
          .where(
            and(
              eq(incentives.tenantId, scope.tenantId),
              eq(incentives.employeeId, emp.id),
              eq(incentives.status, 'APPROVED'),
              sql`${incentives.payrollPeriodId} is null`,
            ),
          );

        // reimbursed expense claims in window, not yet on a payroll
        const expRows = await tx
          .select({ id: expenseClaims.id, amount: expenseReimbursements.reimbursedAmount })
          .from(expenseClaims)
          .innerJoin(
            expenseReimbursements,
            and(
              eq(expenseReimbursements.expenseClaimId, expenseClaims.id),
              eq(expenseReimbursements.tenantId, scope.tenantId),
            ),
          )
          .where(
            and(
              eq(expenseClaims.tenantId, scope.tenantId),
              eq(expenseClaims.employeeId, emp.id),
              eq(expenseClaims.status, 'REIMBURSED'),
              eq(expenseReimbursements.status, 'PAID'),
              gte(expenseReimbursements.paymentDate, period.periodStart),
              lte(expenseReimbursements.paymentDate, period.periodEnd),
            ),
          );

        const components: (PayComponent & { name: string; source: string })[] = [
          ...cpComps.map((c) => ({
            kind: c.kind as PayComponent['kind'],
            amount: c.amount,
            name: c.name,
            source: 'compensation',
          })),
          ...incRows.map((r) => ({
            kind: 'INCENTIVE' as const,
            amount: r.amount,
            name: r.type,
            source: 'incentive',
          })),
          ...expRows.map((r) => ({
            kind: 'REIMBURSEMENT' as const,
            amount: r.amount,
            name: 'Reimbursement',
            source: 'reimbursement',
          })),
        ];
        const totals = computePayrollTotals(cp.baseSalary, components);

        const [entry] = await tx
          .insert(payrollEntries)
          .values({
            tenantId: scope.tenantId,
            payrollPeriodId: id,
            employeeId: emp.id,
            employeeNumber: emp.number,
            employeeName: emp.name,
            currency: period.currency,
            baseEarnings: totals.baseEarnings,
            allowancesTotal: totals.allowancesTotal,
            incentivesTotal: totals.incentivesTotal,
            reimbursementsTotal: totals.reimbursementsTotal,
            deductionsTotal: totals.deductionsTotal,
            grossPay: totals.grossPay,
            netPay: totals.netPay,
            snapshot: {},
            paymentStatus: 'PENDING',
          })
          .returning({ id: payrollEntries.id });

        const rows = [
          {
            kind: 'EARNING' as const,
            name: 'Base salary',
            amount: totals.baseEarnings,
            source: 'compensation',
          },
          ...components.map((c) => ({
            kind: c.kind,
            name: c.name,
            amount: c.amount,
            source: c.source,
          })),
        ];
        for (const r of rows) {
          await tx.insert(payrollEntryComponents).values({
            tenantId: scope.tenantId,
            payrollEntryId: entry!.id,
            kind: r.kind,
            name: r.name,
            amount: r.amount,
            source: r.source,
          });
        }

        gross = sum([gross, totals.grossPay]);
        ded = sum([ded, totals.deductionsTotal]);
        inc = sum([inc, totals.incentivesTotal]);
        reimb = sum([reimb, totals.reimbursementsTotal]);
        net = sum([net, totals.netPay]);
      }

      await tx
        .update(payrollPeriods)
        .set({
          status: 'PROCESSING',
          grossTotal: gross,
          deductionTotal: ded,
          incentiveTotal: inc,
          reimbursementTotal: reimb,
          netTotal: net,
          updatedAt: new Date(),
        })
        .where(eq(payrollPeriods.id, id));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.payroll.processed',
        entityType: 'payroll_period',
        entityId: id,
        actor: userActor(scope),
        metadata: { employeeCount: emps.length, netTotal: net },
      });
    });
    return this.detail(scope, id);
  }

  async finalize(scope: HrScope, id: string): Promise<PayrollPeriodDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const period = await this.lock(tx, scope.tenantId, id);
      if (!canTransitionPayroll(period.status as PayrollPeriodStatus, 'FINALIZED')) {
        throw new AppError('HR_INVALID_STATE', { details: { from: period.status } });
      }
      const entries = await tx
        .select()
        .from(payrollEntries)
        .where(
          and(eq(payrollEntries.tenantId, scope.tenantId), eq(payrollEntries.payrollPeriodId, id)),
        );
      if (entries.length === 0)
        throw new AppError('HR_INVALID_STATE', { details: { hint: 'process the payroll first' } });

      for (const e of entries) {
        const comps = await tx
          .select()
          .from(payrollEntryComponents)
          .where(
            and(
              eq(payrollEntryComponents.tenantId, scope.tenantId),
              eq(payrollEntryComponents.payrollEntryId, e.id),
            ),
          );
        // freeze the full computed breakdown onto the entry
        await tx
          .update(payrollEntries)
          .set({
            snapshot: {
              frozenAt: new Date().toISOString(),
              components: comps.map((c) => ({
                kind: c.kind,
                name: c.name,
                amount: c.amount,
                source: c.source,
              })),
              totals: {
                baseEarnings: e.baseEarnings,
                allowancesTotal: e.allowancesTotal,
                incentivesTotal: e.incentivesTotal,
                reimbursementsTotal: e.reimbursementsTotal,
                deductionsTotal: e.deductionsTotal,
                grossPay: e.grossPay,
                netPay: e.netPay,
              },
            },
            updatedAt: new Date(),
          })
          .where(eq(payrollEntries.id, e.id));
      }

      // tie the consumed incentives to this period so they are not re-used
      await tx
        .update(incentives)
        .set({ payrollPeriodId: id, status: 'PAID', updatedAt: new Date() })
        .where(
          and(
            eq(incentives.tenantId, scope.tenantId),
            eq(incentives.status, 'APPROVED'),
            sql`${incentives.payrollPeriodId} is null`,
            inArray(
              incentives.employeeId,
              entries.map((e) => e.employeeId),
            ),
          ),
        );

      await tx
        .update(payrollPeriods)
        .set({
          status: 'FINALIZED',
          finalizedAt: new Date(),
          finalizedByMembershipId: scope.actorMembershipId,
          updatedAt: new Date(),
        })
        .where(eq(payrollPeriods.id, id));

      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.payroll.finalized',
        entityType: 'payroll_period',
        entityId: id,
        actor: userActor(scope),
        metadata: { employeeCount: entries.length, netTotal: period.netTotal },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'hr.payroll.finalized',
        payload: { payrollPeriodId: id, employeeCount: entries.length },
        actorMembershipId: scope.actorMembershipId,
      });
    });
    return this.detail(scope, id);
  }

  async recordPayment(
    scope: HrScope,
    id: string,
    body: RecordPayrollPaymentDto,
  ): Promise<PayrollPeriodDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const period = await this.lock(tx, scope.tenantId, id);
      if (
        period.status !== 'FINALIZED' &&
        period.status !== 'PAYMENT_PROCESSING' &&
        period.status !== 'PARTIALLY_PAID'
      ) {
        throw new AppError('HR_INVALID_STATE', { details: { from: period.status } });
      }
      const [entry] = await tx
        .select()
        .from(payrollEntries)
        .where(
          and(
            eq(payrollEntries.tenantId, scope.tenantId),
            eq(payrollEntries.payrollPeriodId, id),
            eq(payrollEntries.id, body.payrollEntryId),
          ),
        )
        .for('update')
        .limit(1);
      if (!entry) throw new AppError('HR_PAYROLL_ENTRY_NOT_FOUND');
      const failed = body.status === 'FAILED';

      await tx.insert(payrollPayments).values({
        tenantId: scope.tenantId,
        payrollEntryId: body.payrollEntryId,
        amount: body.amount,
        paymentMethod: body.paymentMethod as 'BANK_TRANSFER',
        paymentDate: body.paymentDate.slice(0, 10),
        paymentReference: body.paymentReference ?? null,
        transactionRef: body.transactionRef ?? null,
        status: failed ? 'FAILED' : 'PAID',
        failureReason: failed ? (body.failureReason ?? null) : null,
        processedByMembershipId: scope.actorMembershipId,
      });

      if (!failed) {
        const newPaid = sum([entry.paidAmount, body.amount]);
        const fullyPaid = Number(newPaid) + 0.005 >= Number(entry.netPay);
        await tx
          .update(payrollEntries)
          .set({
            paidAmount: newPaid,
            paymentStatus: fullyPaid ? 'PAID' : 'PARTIALLY_PAID',
            updatedAt: new Date(),
          })
          .where(eq(payrollEntries.id, body.payrollEntryId));
      } else {
        await tx
          .update(payrollEntries)
          .set({ paymentStatus: 'FAILED', updatedAt: new Date() })
          .where(eq(payrollEntries.id, body.payrollEntryId));
      }

      // recompute the period roll-up
      const all = await tx
        .select({ status: payrollEntries.paymentStatus })
        .from(payrollEntries)
        .where(
          and(eq(payrollEntries.tenantId, scope.tenantId), eq(payrollEntries.payrollPeriodId, id)),
        );
      const allPaid = all.every((e) => e.status === 'PAID');
      const anyPaid = all.some((e) => e.status === 'PAID' || e.status === 'PARTIALLY_PAID');
      const periodStatus: PayrollPeriodStatus = allPaid
        ? 'PAID'
        : anyPaid
          ? 'PARTIALLY_PAID'
          : 'PAYMENT_PROCESSING';
      await tx
        .update(payrollPeriods)
        .set({ status: periodStatus, updatedAt: new Date() })
        .where(eq(payrollPeriods.id, id));

      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'hr.payroll.payment_recorded',
        entityType: 'payroll_entry',
        entityId: body.payrollEntryId,
        actor: userActor(scope),
        metadata: {
          payrollPeriodId: id,
          amount: body.amount,
          method: body.paymentMethod,
          reference: body.paymentReference ?? null,
          failed,
        },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'hr.payroll.payment_recorded',
        payload: { payrollPeriodId: id, payrollEntryId: body.payrollEntryId, failed },
        actorMembershipId: scope.actorMembershipId,
      });
    });
    return this.detail(scope, id);
  }

  // ---- reads / payslip -----------------------------

  getPeriod(scope: HrScope, id: string): Promise<PayrollPeriodDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(payrollPeriods)
        .where(and(eq(payrollPeriods.tenantId, scope.tenantId), eq(payrollPeriods.id, id)))
        .limit(1);
      if (!row) throw new AppError('HR_PAYROLL_NOT_FOUND');
      const counts = await this.entryCounts(tx, scope.tenantId, [id]);
      return this.toDto(row, counts.get(id));
    });
  }

  detail(scope: HrScope, id: string): Promise<PayrollPeriodDetailDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(payrollPeriods)
        .where(and(eq(payrollPeriods.tenantId, scope.tenantId), eq(payrollPeriods.id, id)))
        .limit(1);
      if (!row) throw new AppError('HR_PAYROLL_NOT_FOUND');
      const entries = await this.loadEntries(tx, scope.tenantId, id);
      const counts = await this.entryCounts(tx, scope.tenantId, [id]);
      return { ...this.toDto(row, counts.get(id)), entries };
    });
  }

  /** Payroll history for one employee — finalized entries, immutable. */
  historyFor(scope: HrScope, employeeId: string): Promise<PayrollHistoryItemDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({
          periodName: payrollPeriods.name,
          payDate: payrollPeriods.payDate,
          netPay: payrollEntries.netPay,
          currency: payrollEntries.currency,
          paymentStatus: payrollEntries.paymentStatus,
          entryId: payrollEntries.id,
        })
        .from(payrollEntries)
        .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollEntries.payrollPeriodId))
        .where(
          and(
            eq(payrollEntries.tenantId, scope.tenantId),
            eq(payrollEntries.employeeId, employeeId),
            inArray(payrollPeriods.status, [
              'FINALIZED',
              'PAYMENT_PROCESSING',
              'PARTIALLY_PAID',
              'PAID',
            ]),
          ),
        )
        .orderBy(desc(payrollPeriods.periodStart));
      const paymentRefs = await tx
        .select({ entryId: payrollPayments.payrollEntryId, ref: payrollPayments.paymentReference })
        .from(payrollPayments)
        .where(
          and(
            eq(payrollPayments.tenantId, scope.tenantId),
            inArray(
              payrollPayments.payrollEntryId,
              rows.map((r) => r.entryId),
            ),
            eq(payrollPayments.status, 'PAID'),
          ),
        );
      const refByEntry = new Map(paymentRefs.map((p) => [p.entryId, p.ref]));
      return rows.map((r) => ({
        periodName: r.periodName,
        payDate: r.payDate,
        netPay: r.netPay,
        currency: r.currency,
        paymentStatus: r.paymentStatus,
        paymentReference: refByEntry.get(r.entryId) ?? null,
        payrollEntryId: r.entryId,
      }));
    });
  }

  /** Branded payslip PDF for one payroll entry. Caller (controller) enforces
   *  that a self-service employee only requests their own entry. */
  async payslip(scope: HrScope, entryId: string): Promise<{ filename: string; body: Buffer }> {
    const data = await withTenantContext(getDb(), scope, async (tx) => {
      const [entry] = await tx
        .select({ e: payrollEntries, p: payrollPeriods })
        .from(payrollEntries)
        .innerJoin(payrollPeriods, eq(payrollPeriods.id, payrollEntries.payrollPeriodId))
        .where(and(eq(payrollEntries.tenantId, scope.tenantId), eq(payrollEntries.id, entryId)))
        .limit(1);
      if (!entry) throw new AppError('HR_PAYROLL_ENTRY_NOT_FOUND');
      const comps = await tx
        .select()
        .from(payrollEntryComponents)
        .where(
          and(
            eq(payrollEntryComponents.tenantId, scope.tenantId),
            eq(payrollEntryComponents.payrollEntryId, entryId),
          ),
        );
      const [payment] = await tx
        .select()
        .from(payrollPayments)
        .where(
          and(
            eq(payrollPayments.tenantId, scope.tenantId),
            eq(payrollPayments.payrollEntryId, entryId),
            eq(payrollPayments.status, 'PAID'),
          ),
        )
        .orderBy(desc(payrollPayments.paymentDate))
        .limit(1);
      return { entry: entry.e, period: entry.p, components: comps, payment: payment ?? null };
    });
    const def = buildPayslipDocument(data);
    return this.documents.render(scope, def);
  }

  // ---- internals -----------------------------------

  private async loadEntries(
    tx: Tx,
    tenantId: string,
    periodId: string,
  ): Promise<PayrollEntryDto[]> {
    const entries = await tx
      .select()
      .from(payrollEntries)
      .where(
        and(eq(payrollEntries.tenantId, tenantId), eq(payrollEntries.payrollPeriodId, periodId)),
      )
      .orderBy(payrollEntries.employeeName);
    if (entries.length === 0) return [];
    const comps = await tx
      .select()
      .from(payrollEntryComponents)
      .where(
        and(
          eq(payrollEntryComponents.tenantId, tenantId),
          inArray(
            payrollEntryComponents.payrollEntryId,
            entries.map((e) => e.id),
          ),
        ),
      );
    const byEntry = new Map<string, schema.PayrollEntryComponentRow[]>();
    for (const c of comps) {
      const arr = byEntry.get(c.payrollEntryId) ?? [];
      arr.push(c);
      byEntry.set(c.payrollEntryId, arr);
    }
    return entries.map((e) => ({
      id: e.id,
      employeeId: e.employeeId,
      employeeNumber: e.employeeNumber,
      employeeName: e.employeeName,
      currency: e.currency,
      baseEarnings: e.baseEarnings,
      allowancesTotal: e.allowancesTotal,
      incentivesTotal: e.incentivesTotal,
      reimbursementsTotal: e.reimbursementsTotal,
      deductionsTotal: e.deductionsTotal,
      grossPay: e.grossPay,
      netPay: e.netPay,
      paymentStatus: e.paymentStatus,
      paidAmount: e.paidAmount,
      components: (byEntry.get(e.id) ?? []).map((c) => ({
        kind: c.kind,
        name: c.name,
        amount: c.amount,
      })),
    }));
  }

  private async entryCounts(
    tx: Tx,
    tenantId: string,
    ids: string[],
  ): Promise<Map<string, { total: number; paid: number; pending: number; failed: number }>> {
    if (ids.length === 0) return new Map();
    const rows = await tx
      .select({
        pid: payrollEntries.payrollPeriodId,
        status: payrollEntries.paymentStatus,
        n: sql<number>`count(*)::int`,
      })
      .from(payrollEntries)
      .where(
        and(eq(payrollEntries.tenantId, tenantId), inArray(payrollEntries.payrollPeriodId, ids)),
      )
      .groupBy(payrollEntries.payrollPeriodId, payrollEntries.paymentStatus);
    const map = new Map<string, { total: number; paid: number; pending: number; failed: number }>();
    for (const r of rows) {
      const c = map.get(r.pid) ?? { total: 0, paid: 0, pending: 0, failed: 0 };
      c.total += r.n;
      if (r.status === 'PAID') c.paid += r.n;
      else if (r.status === 'FAILED') c.failed += r.n;
      else c.pending += r.n;
      map.set(r.pid, c);
    }
    return map;
  }

  private toDto(
    r: schema.PayrollPeriodRow,
    counts: { total: number; paid: number; pending: number; failed: number } | undefined,
  ): PayrollPeriodDto {
    return {
      id: r.id,
      name: r.name,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      payDate: r.payDate,
      currency: r.currency,
      status: r.status,
      grossTotal: r.grossTotal,
      deductionTotal: r.deductionTotal,
      incentiveTotal: r.incentiveTotal,
      reimbursementTotal: r.reimbursementTotal,
      netTotal: r.netTotal,
      employeeCount: counts?.total ?? 0,
      paidCount: counts?.paid ?? 0,
      pendingCount: counts?.pending ?? 0,
      failedCount: counts?.failed ?? 0,
      finalizedAt: r.finalizedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private async lock(tx: Tx, tenantId: string, id: string): Promise<schema.PayrollPeriodRow> {
    const [row] = await tx
      .select()
      .from(payrollPeriods)
      .where(and(eq(payrollPeriods.tenantId, tenantId), eq(payrollPeriods.id, id)))
      .for('update')
      .limit(1);
    if (!row) throw new AppError('HR_PAYROLL_NOT_FOUND');
    return row;
  }
}
