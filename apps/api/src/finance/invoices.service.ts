import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, ilike, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { pageBounds, type Paged, type TenantScope } from './common.js';
import { guardMoney, isCheckViolation, isUniqueViolation, normaliseCurrency } from './common.js';
import {
  assertNonNegativeMoney,
  dec,
  invoiceOutstanding,
  invoiceTotals,
  lineAmounts,
  type LineDiscountType,
} from './money.js';
import { invoiceIsEditable, isValidInvoiceTransition } from './lifecycles.js';
import { deriveOverdue } from './overdue.js';
import { nextNumber } from './numbering.js';
import { withIdempotency } from './idempotency.js';
import { renderInvoiceDoc } from './finance-doc.js';
import { toAllocationDto, toInvoiceDto, toInvoiceLineDto, toPaymentDto } from './finance-shared.js';
import type {
  CreateInvoiceDto,
  CreateInvoiceFromQuotationDto,
  FinanceOverviewDto,
  CustomerFinancialViewDto,
  FinancialSummaryDto,
  InvoiceDetailDto,
  InvoiceDto,
  InvoiceLineInputDto,
  IssueInvoiceDto,
  ListInvoicesQueryDto,
  UpdateInvoiceDto,
} from './finance.dto.js';

const {
  invoices,
  invoiceLines,
  payments,
  paymentAllocations,
  customers,
  projects,
  quotations,
  quotationRevisions,
  quotationLines,
} = schema;

interface LineDraft {
  description: string;
  reference: string | null;
  productId: string | null;
  unitLabel: string | null;
  quantity: string;
  unitPrice: string;
  discountType: LineDiscountType;
  discountValue: string;
  taxName: string | null;
  taxRate: string;
}

/**
 * Invoices — operational invoicing (Phase 9, ADR 0038). A draft invoice is
 * fully editable; issuing freezes its financial snapshot. `amount_paid` /
 * `amount_credited` are transactional projections (see `projections.ts`);
 * `outstanding` and `overdue` are always derived, never stored. Finance events
 * go to the shared transactional outbox.
 */
@Injectable()
export class InvoicesService {
  constructor(private readonly outbox: OutboxService) {}

  // ---- reads -----------------------------------------------------

  async list(scope: TenantScope, query: ListInvoicesQueryDto): Promise<Paged<InvoiceDto>> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [eq(invoices.tenantId, scope.tenantId)];
      if (query.status) conds.push(eq(invoices.status, query.status as 'DRAFT'));
      if (query.customerId) conds.push(eq(invoices.customerId, query.customerId));
      if (query.projectId) conds.push(eq(invoices.projectId, query.projectId));
      if (query.from) conds.push(sql`${invoices.issueDate} >= ${query.from}`);
      if (query.to) conds.push(sql`${invoices.issueDate} <= ${query.to}`);
      if (query.q?.trim()) conds.push(ilike(invoices.number, `%${query.q.trim()}%`));
      if (query.overdue) {
        conds.push(inArray(invoices.status, ['ISSUED', 'PARTIALLY_PAID']));
        conds.push(sql`${invoices.dueDate} < now()::date`);
        conds.push(
          sql`${invoices.grandTotal} - ${invoices.amountPaid} - ${invoices.amountCredited} > 0`,
        );
      }
      const where = and(...conds);

      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(invoices)
        .where(where);

      const rows = await tx
        .select({
          inv: invoices,
          customerName: customers.name,
          projectNumber: projects.number,
        })
        .from(invoices)
        .leftJoin(customers, eq(invoices.customerId, customers.id))
        .leftJoin(projects, eq(invoices.projectId, projects.id))
        .where(where)
        .orderBy(desc(invoices.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        items: rows.map((r) =>
          toInvoiceDto(r.inv, { customerName: r.customerName, projectNumber: r.projectNumber }),
        ),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  async get(scope: TenantScope, id: string): Promise<InvoiceDetailDto> {
    return withTenantContext(getDb(), scope, (tx) => this.detail(tx, scope, id));
  }

  private async detail(tx: Tx, scope: TenantScope, id: string): Promise<InvoiceDetailDto> {
    const [row] = await tx
      .select({ inv: invoices, customerName: customers.name, projectNumber: projects.number })
      .from(invoices)
      .leftJoin(customers, eq(invoices.customerId, customers.id))
      .leftJoin(projects, eq(invoices.projectId, projects.id))
      .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, id)))
      .limit(1);
    if (!row) throw new AppError('INVOICE_NOT_FOUND');

    const lines = await tx
      .select()
      .from(invoiceLines)
      .where(and(eq(invoiceLines.tenantId, scope.tenantId), eq(invoiceLines.invoiceId, id)))
      .orderBy(invoiceLines.lineNo);

    const allocRows = await tx
      .select({ a: paymentAllocations, paymentNumber: payments.number })
      .from(paymentAllocations)
      .innerJoin(payments, eq(paymentAllocations.paymentId, payments.id))
      .where(
        and(eq(paymentAllocations.tenantId, scope.tenantId), eq(paymentAllocations.invoiceId, id)),
      )
      .orderBy(desc(paymentAllocations.createdAt));

    return {
      ...toInvoiceDto(row.inv, {
        customerName: row.customerName,
        projectNumber: row.projectNumber,
      }),
      lines: lines.map(toInvoiceLineDto),
      allocations: allocRows.map((r) => toAllocationDto(r.a, r.paymentNumber, row.inv.number)),
    };
  }

  async renderPrintable(scope: TenantScope, id: string): Promise<string> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const detail = await this.detail(tx, scope, id);
      const [tenant] = await tx
        .select({ name: schema.tenants.name })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, scope.tenantId))
        .limit(1);
      const [cust] = await tx
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, scope.tenantId), eq(customers.id, detail.customerId)))
        .limit(1);
      return renderInvoiceDoc(detail, {
        businessName: tenant?.name ?? 'Aivoryx',
        customer: cust ?? null,
      });
    });
  }

  // ---- writes ---------------------------------------------------

  async create(
    scope: TenantScope,
    body: CreateInvoiceDto,
    idempotencyKey?: string,
  ): Promise<InvoiceDetailDto> {
    const currency = normaliseCurrency(body.currency);
    const drafts = this.toLineDrafts(body.lines);
    if (drafts.length === 0) throw new AppError('INVOICE_NO_LINES');

    return withTenantContext(getDb(), scope, async (tx) => {
      const created = await withIdempotency(
        tx,
        scope.tenantId,
        idempotencyKey,
        'invoice.create',
        async () => {
          await this.assertCustomer(tx, scope, body.customerId);
          if (body.projectId) await this.assertProject(tx, scope, body.projectId);
          const quotationId = body.quotationId
            ? await this.assertQuotation(tx, scope, body.quotationId)
            : null;

          const totals = invoiceTotals(drafts);
          const number = await nextNumber(tx, scope.tenantId, 'invoice');
          try {
            const [inv] = await tx
              .insert(invoices)
              .values({
                tenantId: scope.tenantId,
                number,
                customerId: body.customerId,
                projectId: body.projectId ?? null,
                quotationId,
                source: quotationId ? 'quotation' : body.projectId ? 'project' : 'manual',
                status: 'DRAFT',
                currency,
                issueDate: body.issueDate ?? null,
                dueDate: body.dueDate ?? null,
                notes: body.notes ?? null,
                reference: body.reference ?? null,
                subtotal: totals.subtotal,
                discountTotal: totals.discountTotal,
                taxTotal: totals.taxTotal,
                grandTotal: totals.grandTotal,
                createdByMembershipId: scope.actorMembershipId,
              })
              .returning();
            await this.writeLines(tx, scope, inv!.id, drafts);
            await this.outbox.emit(tx, {
              tenantId: scope.tenantId,
              type: 'invoice.created',
              payload: { invoiceId: inv!.id, number, customerId: body.customerId },
              actorMembershipId: scope.actorMembershipId,
            });
            return { id: inv!.id };
          } catch (err) {
            if (isUniqueViolation(err))
              throw new AppError('DUPLICATE_CODE', { details: { number } });
            if (isCheckViolation(err)) throw new AppError('FINANCE_INVALID_AMOUNT');
            throw err;
          }
        },
        async (existingId) => ({ id: existingId }),
      );
      return this.detail(tx, scope, created.id);
    });
  }

  async createFromQuotation(
    scope: TenantScope,
    body: CreateInvoiceFromQuotationDto,
    idempotencyKey?: string,
  ): Promise<InvoiceDetailDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const created = await withIdempotency(
        tx,
        scope.tenantId,
        idempotencyKey,
        'invoice.create_from_quotation',
        async () => {
          const [q] = await tx
            .select()
            .from(quotations)
            .where(
              and(eq(quotations.tenantId, scope.tenantId), eq(quotations.id, body.quotationId)),
            )
            .limit(1);
          if (!q) throw new AppError('QUOTATION_NOT_FOUND');
          if (!['ACCEPTED', 'BOOKED'].includes(q.status)) {
            throw new AppError('INVOICE_INVALID_STATE', {
              message: 'Only an accepted or booked quotation can be invoiced.',
              details: { quotationStatus: q.status },
            });
          }
          if (!q.customerId) {
            throw new AppError('INVOICE_INVALID_STATE', {
              message:
                'This quotation has no linked customer yet. Book it first, or invoice the customer directly.',
            });
          }
          const [rev] = await tx
            .select({ id: quotationRevisions.id })
            .from(quotationRevisions)
            .where(
              and(
                eq(quotationRevisions.tenantId, scope.tenantId),
                eq(quotationRevisions.quotationId, q.id),
                eq(quotationRevisions.revisionNo, q.currentRevisionNo),
              ),
            )
            .limit(1);
          const revLines = rev
            ? await tx
                .select()
                .from(quotationLines)
                .where(
                  and(
                    eq(quotationLines.tenantId, scope.tenantId),
                    eq(quotationLines.revisionId, rev.id),
                  ),
                )
                .orderBy(quotationLines.lineNo)
            : [];
          if (revLines.length === 0) throw new AppError('INVOICE_NO_LINES');

          const drafts: LineDraft[] = revLines.map((l) => ({
            description: l.description,
            reference: null,
            productId: l.productId,
            unitLabel: l.unitLabel,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            discountType: 'AMOUNT' as const,
            discountValue: l.discount,
            taxName: null,
            taxRate: l.taxRate,
          }));
          const totals = invoiceTotals(drafts);
          const number = await nextNumber(tx, scope.tenantId, 'invoice');
          const [inv] = await tx
            .insert(invoices)
            .values({
              tenantId: scope.tenantId,
              number,
              customerId: q.customerId,
              projectId: q.projectId ?? null,
              quotationId: q.id,
              source: 'quotation',
              status: 'DRAFT',
              currency: 'INR',
              dueDate: body.dueDate ?? null,
              subtotal: totals.subtotal,
              discountTotal: totals.discountTotal,
              taxTotal: totals.taxTotal,
              grandTotal: totals.grandTotal,
              createdByMembershipId: scope.actorMembershipId,
            })
            .returning();
          await this.writeLines(tx, scope, inv!.id, drafts);
          await this.outbox.emit(tx, {
            tenantId: scope.tenantId,
            type: 'invoice.created',
            payload: { invoiceId: inv!.id, number, customerId: q.customerId, quotationId: q.id },
            actorMembershipId: scope.actorMembershipId,
          });
          return { id: inv!.id };
        },
        async (existingId) => ({ id: existingId }),
      );
      return this.detail(tx, scope, created.id);
    });
  }

  async update(scope: TenantScope, id: string, body: UpdateInvoiceDto): Promise<InvoiceDetailDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const inv = await this.lockInvoice(tx, scope, id);
      if (!invoiceIsEditable(inv.status)) {
        throw new AppError('INVOICE_IMMUTABLE', { details: { status: inv.status } });
      }
      if (body.projectId) await this.assertProject(tx, scope, body.projectId);

      const set: Partial<schema.NewInvoiceRow> = { updatedAt: new Date() };
      if (body.issueDate !== undefined) set.issueDate = body.issueDate;
      if (body.dueDate !== undefined) set.dueDate = body.dueDate;
      if (body.notes !== undefined) set.notes = body.notes;
      if (body.reference !== undefined) set.reference = body.reference;
      if (body.projectId !== undefined) set.projectId = body.projectId;

      if (body.lines) {
        const drafts = this.toLineDrafts(body.lines);
        if (drafts.length === 0) throw new AppError('INVOICE_NO_LINES');
        const totals = invoiceTotals(drafts);
        set.subtotal = totals.subtotal;
        set.discountTotal = totals.discountTotal;
        set.taxTotal = totals.taxTotal;
        set.grandTotal = totals.grandTotal;
        await tx
          .delete(invoiceLines)
          .where(and(eq(invoiceLines.tenantId, scope.tenantId), eq(invoiceLines.invoiceId, id)));
        await this.writeLines(tx, scope, id, drafts);
      }

      try {
        await tx
          .update(invoices)
          .set(set)
          .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, id)));
      } catch (err) {
        if (isCheckViolation(err)) throw new AppError('FINANCE_INVALID_AMOUNT');
        throw err;
      }
      return this.detail(tx, scope, id);
    });
  }

  async issue(
    scope: TenantScope,
    id: string,
    body: IssueInvoiceDto,
    idempotencyKey?: string,
  ): Promise<InvoiceDetailDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await withIdempotency(
        tx,
        scope.tenantId,
        idempotencyKey,
        'invoice.issue',
        async () => {
          const inv = await this.lockInvoice(tx, scope, id);
          if (inv.status === 'ISSUED' || inv.status === 'PARTIALLY_PAID' || inv.status === 'PAID') {
            return { id: inv.id }; // idempotent — already issued
          }
          if (!isValidInvoiceTransition(inv.status, 'ISSUED')) {
            throw new AppError('INVOICE_INVALID_STATE', { details: { status: inv.status } });
          }
          const [lc] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(invoiceLines)
            .where(and(eq(invoiceLines.tenantId, scope.tenantId), eq(invoiceLines.invoiceId, id)));
          if ((lc?.n ?? 0) === 0) throw new AppError('INVOICE_NO_LINES');

          const today = new Date().toISOString().slice(0, 10);
          await tx
            .update(invoices)
            .set({
              status: 'ISSUED',
              issueDate: body.issueDate ?? inv.issueDate ?? today,
              dueDate: body.dueDate ?? inv.dueDate,
              issuedAt: new Date(),
              issuedByMembershipId: scope.actorMembershipId,
              updatedAt: new Date(),
            })
            .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, id)));
          await this.outbox.emit(tx, {
            tenantId: scope.tenantId,
            type: 'invoice.issued',
            payload: {
              invoiceId: id,
              number: inv.number,
              customerId: inv.customerId,
              outstanding: inv.grandTotal,
            },
            actorMembershipId: scope.actorMembershipId,
          });
          return { id: inv.id };
        },
        async (existingId) => ({ id: existingId }),
      );
      return this.detail(tx, scope, id);
    });
  }

  async cancel(
    scope: TenantScope,
    id: string,
    body: { mode?: 'CANCELLED' | 'VOID'; reason?: string },
  ): Promise<InvoiceDetailDto> {
    const target = body.mode ?? 'CANCELLED';
    return withTenantContext(getDb(), scope, async (tx) => {
      const inv = await this.lockInvoice(tx, scope, id);
      if (inv.status === target) return this.detail(tx, scope, id);
      if (!isValidInvoiceTransition(inv.status, target)) {
        throw new AppError('INVOICE_INVALID_STATE', { details: { status: inv.status, target } });
      }
      if (target === 'CANCELLED') {
        const [alloc] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(paymentAllocations)
          .where(
            and(
              eq(paymentAllocations.tenantId, scope.tenantId),
              eq(paymentAllocations.invoiceId, id),
              isNull(paymentAllocations.reversedAt),
            ),
          );
        if ((alloc?.n ?? 0) > 0) throw new AppError('INVOICE_HAS_ALLOCATIONS');
      }
      await tx
        .update(invoices)
        .set({
          status: target,
          cancelledAt: new Date(),
          cancelledByMembershipId: scope.actorMembershipId,
          cancelReason: body.reason ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, id)));
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: target === 'VOID' ? 'invoice.voided' : 'invoice.cancelled',
        payload: { invoiceId: id, number: inv.number },
        actorMembershipId: scope.actorMembershipId,
      });
      return this.detail(tx, scope, id);
    });
  }

  /**
   * Emit `invoice.overdue` once per invoice, the first time it is observed
   * overdue. Correctness never depends on this running — overdue is derived —
   * it only lets Phase 8 react. A scheduler may call this periodically; it is
   * idempotent (guarded by `overdue_notified_at`).
   */
  async overdueSweep(scope: TenantScope): Promise<{ notified: number }> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const candidates = await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.tenantId, scope.tenantId),
            inArray(invoices.status, ['ISSUED', 'PARTIALLY_PAID']),
            isNull(invoices.overdueNotifiedAt),
            lte(invoices.dueDate, sql`now()::date`),
            gt(
              sql`${invoices.grandTotal} - ${invoices.amountPaid} - ${invoices.amountCredited}`,
              sql`0`,
            ),
          ),
        )
        .limit(500);

      let notified = 0;
      for (const inv of candidates) {
        const od = deriveOverdue({
          status: inv.status,
          dueDate: inv.dueDate,
          outstanding: invoiceOutstanding(inv.grandTotal, inv.amountPaid, inv.amountCredited),
        });
        if (!od.overdue) continue;
        await tx
          .update(invoices)
          .set({ overdueNotifiedAt: new Date() })
          .where(
            and(
              eq(invoices.tenantId, scope.tenantId),
              eq(invoices.id, inv.id),
              isNull(invoices.overdueNotifiedAt),
            ),
          );
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'invoice.overdue',
          payload: {
            invoiceId: inv.id,
            number: inv.number,
            daysOverdue: od.daysOverdue,
            outstanding: invoiceOutstanding(inv.grandTotal, inv.amountPaid, inv.amountCredited),
          },
        });
        notified += 1;
      }
      return { notified };
    });
  }

  // ---- financial summaries -------------------------------------

  async overview(scope: TenantScope): Promise<FinanceOverviewDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await this.summaryRows(tx, scope, []);
      return { byCurrency: rows };
    });
  }

  async customerFinancialView(
    scope: TenantScope,
    customerId: string,
  ): Promise<CustomerFinancialViewDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.assertCustomer(tx, scope, customerId);
      const summaries = await this.summaryRows(tx, scope, [eq(invoices.customerId, customerId)]);
      const summary = summaries[0] ?? this.emptySummary('INR');

      const recentInvoices = await tx
        .select({ inv: invoices })
        .from(invoices)
        .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.customerId, customerId)))
        .orderBy(desc(invoices.createdAt))
        .limit(5);
      const recentPayments = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.tenantId, scope.tenantId), eq(payments.customerId, customerId)))
        .orderBy(desc(payments.createdAt))
        .limit(5);

      return {
        ...summary,
        recentInvoices: recentInvoices.map((r) => toInvoiceDto(r.inv)),
        recentPayments: recentPayments.map((p) => toPaymentDto(p)),
      };
    });
  }

  async projectFinancialSummary(
    scope: TenantScope,
    projectId: string,
  ): Promise<FinancialSummaryDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await this.summaryRows(tx, scope, [eq(invoices.projectId, projectId)]);
      return rows[0] ?? this.emptySummary('INR');
    });
  }

  private async summaryRows(
    tx: Tx,
    scope: TenantScope,
    extra: SQL[],
  ): Promise<FinancialSummaryDto[]> {
    const where = and(
      eq(invoices.tenantId, scope.tenantId),
      inArray(invoices.status, ['ISSUED', 'PARTIALLY_PAID', 'PAID']),
      ...extra,
    );
    const rows = await tx
      .select({
        currency: invoices.currency,
        invoiced: sql<string>`coalesce(sum(${invoices.grandTotal}), 0)::text`,
        paid: sql<string>`coalesce(sum(${invoices.amountPaid}), 0)::text`,
        credited: sql<string>`coalesce(sum(${invoices.amountCredited}), 0)::text`,
        outstanding: sql<string>`coalesce(sum(${invoices.grandTotal} - ${invoices.amountPaid} - ${invoices.amountCredited}), 0)::text`,
        overdue: sql<string>`coalesce(sum(case when ${invoices.status} in ('ISSUED','PARTIALLY_PAID') and ${invoices.dueDate} < now()::date and (${invoices.grandTotal} - ${invoices.amountPaid} - ${invoices.amountCredited}) > 0 then (${invoices.grandTotal} - ${invoices.amountPaid} - ${invoices.amountCredited}) else 0 end), 0)::text`,
        invoiceCount: sql<number>`count(*)::int`,
        overdueCount: sql<number>`sum(case when ${invoices.status} in ('ISSUED','PARTIALLY_PAID') and ${invoices.dueDate} < now()::date and (${invoices.grandTotal} - ${invoices.amountPaid} - ${invoices.amountCredited}) > 0 then 1 else 0 end)::int`,
      })
      .from(invoices)
      .where(where)
      .groupBy(invoices.currency);
    return rows.map((r) => ({
      currency: r.currency,
      invoicedTotal: money2(r.invoiced),
      paidTotal: money2(r.paid),
      creditedTotal: money2(r.credited),
      outstandingTotal: money2(r.outstanding),
      overdueTotal: money2(r.overdue),
      invoiceCount: r.invoiceCount,
      overdueCount: r.overdueCount,
    }));
  }

  private emptySummary(currency: string): FinancialSummaryDto {
    return {
      currency,
      invoicedTotal: '0.00',
      paidTotal: '0.00',
      creditedTotal: '0.00',
      outstandingTotal: '0.00',
      overdueTotal: '0.00',
      invoiceCount: 0,
      overdueCount: 0,
    };
  }

  // ---- helpers ------------------------------------------------

  private async lockInvoice(tx: Tx, scope: TenantScope, id: string): Promise<schema.InvoiceRow> {
    const [row] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, id)))
      .for('update')
      .limit(1);
    if (!row) throw new AppError('INVOICE_NOT_FOUND');
    return row;
  }

  private toLineDrafts(lines: InvoiceLineInputDto[]): LineDraft[] {
    return lines.map((l, i) =>
      guardMoney(() => {
        const quantity = assertNonNegativeMoney(l.quantity, '9999999999.9999');
        const unitPrice = assertNonNegativeMoney(l.unitPrice);
        const discountType = (l.discountType as LineDiscountType) ?? 'AMOUNT';
        const discountValue = assertNonNegativeMoney(l.discountValue ?? '0');
        const taxRate = assertNonNegativeMoney(l.taxRate ?? '0', '100');
        if (!l.description?.trim()) {
          throw new RangeError(`line ${i + 1} needs a description`);
        }
        return {
          description: l.description.trim(),
          reference: l.reference?.trim() || null,
          productId: l.productId ?? null,
          unitLabel: l.unitLabel?.trim() || null,
          quantity,
          unitPrice,
          discountType,
          discountValue,
          taxName: l.taxName?.trim() || null,
          taxRate,
        };
      }),
    );
  }

  private async writeLines(
    tx: Tx,
    scope: TenantScope,
    invoiceId: string,
    drafts: LineDraft[],
  ): Promise<void> {
    const values = drafts.map((d, i) => {
      const a = lineAmounts(d);
      return {
        tenantId: scope.tenantId,
        invoiceId,
        lineNo: i + 1,
        productId: d.productId,
        reference: d.reference,
        description: d.description,
        unitLabel: d.unitLabel,
        quantity: d.quantity,
        unitPrice: d.unitPrice,
        discountType: d.discountType,
        discountValue: d.discountValue,
        taxName: d.taxName,
        taxRate: d.taxRate,
        lineSubtotal: a.lineSubtotal,
        lineDiscount: a.lineDiscount,
        lineTaxable: a.lineTaxable,
        lineTax: a.lineTax,
        lineTotal: a.lineTotal,
      };
    });
    if (values.length > 0) await tx.insert(invoiceLines).values(values);
  }

  private async assertCustomer(tx: Tx, scope: TenantScope, customerId: string): Promise<void> {
    const [c] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, scope.tenantId), eq(customers.id, customerId)))
      .limit(1);
    if (!c) throw new AppError('CUSTOMER_NOT_FOUND');
  }

  private async assertProject(tx: Tx, scope: TenantScope, projectId: string): Promise<void> {
    const [p] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.tenantId, scope.tenantId), eq(projects.id, projectId)))
      .limit(1);
    if (!p) throw new AppError('PROJECT_NOT_FOUND');
  }

  private async assertQuotation(tx: Tx, scope: TenantScope, quotationId: string): Promise<string> {
    const [q] = await tx
      .select({ id: quotations.id })
      .from(quotations)
      .where(and(eq(quotations.tenantId, scope.tenantId), eq(quotations.id, quotationId)))
      .limit(1);
    if (!q) throw new AppError('QUOTATION_NOT_FOUND');
    return q.id;
  }
}

/** Normalise a NUMERIC-text aggregate to a 2dp money string. */
function money2(value: string): string {
  const neg = value.startsWith('-');
  const [i, f = ''] = (neg ? value.slice(1) : value).split('.');
  const body = `${i}.${(f + '00').slice(0, 2)}`;
  return neg && !dec.isZero(body) ? `-${body}` : body;
}
