import { Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { DocumentRenderService } from '../documents/document-render.service.js';
import { buildReceiptDocument } from '../documents/builders.js';
import { pageBounds, type Paged, type TenantScope } from './common.js';
import { guardMoney, isCheckViolation, isUniqueViolation, normaliseCurrency } from './common.js';
import { assertPositiveMoney } from './money.js';
import { nextNumber } from './numbering.js';
import { withIdempotency } from './idempotency.js';
import { recalcInvoiceAndEmit, toAllocationDto, toPaymentDto } from './finance-shared.js';
import { recalcPayment } from './projections.js';
import { renderReceiptDoc } from './finance-doc.js';
import { PaymentAllocationService } from './allocations.service.js';
import type {
  ListPaymentsQueryDto,
  PaymentDetailDto,
  PaymentDto,
  RecordPaymentDto,
} from './finance.dto.js';

const { payments, paymentAllocations, invoices, customers } = schema;

/**
 * Payments — recording customer payments (Phase 9, ADR 0038). A payment is
 * authoritative and is never deleted: RECORDED → REVERSED / CANCELLED. It may
 * be recorded before any invoice is known (fully unallocated) and allocated
 * later. Reversal is safe under concurrency (single `FOR UPDATE` lock, guarded
 * by the RECORDED status) and undoes every active allocation transactionally.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly allocations: PaymentAllocationService,
    private readonly documents: DocumentRenderService,
    private readonly audit: AuditService,
  ) {}

  async list(scope: TenantScope, query: ListPaymentsQueryDto): Promise<Paged<PaymentDto>> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [eq(payments.tenantId, scope.tenantId)];
      if (query.status) conds.push(eq(payments.status, query.status as 'RECORDED'));
      if (query.customerId) conds.push(eq(payments.customerId, query.customerId));
      if (query.unallocatedOnly)
        conds.push(sql`${payments.amount} - ${payments.allocatedAmount} > 0`);
      const where = and(...conds);

      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(payments)
        .where(where);
      const rows = await tx
        .select({ p: payments, customerName: customers.name })
        .from(payments)
        .leftJoin(customers, eq(payments.customerId, customers.id))
        .where(where)
        .orderBy(desc(payments.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        items: rows.map((r) => toPaymentDto(r.p, r.customerName)),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  async get(scope: TenantScope, id: string): Promise<PaymentDetailDto> {
    return withTenantContext(getDb(), scope, (tx) => this.detail(tx, scope, id));
  }

  private async detail(tx: Tx, scope: TenantScope, id: string): Promise<PaymentDetailDto> {
    const [row] = await tx
      .select({ p: payments, customerName: customers.name })
      .from(payments)
      .leftJoin(customers, eq(payments.customerId, customers.id))
      .where(and(eq(payments.tenantId, scope.tenantId), eq(payments.id, id)))
      .limit(1);
    if (!row) throw new AppError('PAYMENT_NOT_FOUND');

    const allocRows = await tx
      .select({ a: paymentAllocations, invoiceNumber: invoices.number })
      .from(paymentAllocations)
      .innerJoin(invoices, eq(paymentAllocations.invoiceId, invoices.id))
      .where(
        and(eq(paymentAllocations.tenantId, scope.tenantId), eq(paymentAllocations.paymentId, id)),
      )
      .orderBy(desc(paymentAllocations.createdAt));

    return {
      ...toPaymentDto(row.p, row.customerName),
      allocations: allocRows.map((r) => toAllocationDto(r.a, row.p.number, r.invoiceNumber)),
    };
  }

  async renderReceipt(scope: TenantScope, id: string): Promise<string> {
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
      return renderReceiptDoc(detail, {
        businessName: tenant?.name ?? 'Aivoryx',
        customer: cust ?? null,
      });
    });
  }

  /** Branded PDF receipt (Phase 10). Tenant-scoped load + tenant branding. */
  async renderReceiptPdf(
    scope: TenantScope,
    id: string,
  ): Promise<{ filename: string; body: Buffer }> {
    const detail = await this.get(scope, id);
    return this.documents.render(scope, buildReceiptDocument(detail));
  }

  async record(
    scope: TenantScope,
    body: RecordPaymentDto,
    idempotencyKey?: string,
  ): Promise<PaymentDetailDto> {
    const currency = normaliseCurrency(body.currency);
    const amount = guardMoney(() => assertPositiveMoney(body.amount));

    return withTenantContext(getDb(), scope, async (tx) => {
      const created = await withIdempotency(
        tx,
        scope.tenantId,
        idempotencyKey,
        'payment.record',
        async () => {
          const [c] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.tenantId, scope.tenantId), eq(customers.id, body.customerId)))
            .limit(1);
          if (!c) throw new AppError('CUSTOMER_NOT_FOUND');

          const number = await nextNumber(tx, scope.tenantId, 'payment');
          let payment: schema.PaymentRow;
          try {
            const [row] = await tx
              .insert(payments)
              .values({
                tenantId: scope.tenantId,
                number,
                customerId: body.customerId,
                paymentDate: body.paymentDate.slice(0, 10),
                amount,
                currency,
                method: (body.method as 'BANK_TRANSFER') ?? 'BANK_TRANSFER',
                reference: body.reference ?? null,
                notes: body.notes ?? null,
                providerReference: body.providerReference ?? null,
                status: 'RECORDED',
                createdByMembershipId: scope.actorMembershipId,
              })
              .returning();
            payment = row!;
          } catch (err) {
            if (isUniqueViolation(err))
              throw new AppError('DUPLICATE_CODE', { details: { number } });
            if (isCheckViolation(err)) throw new AppError('FINANCE_INVALID_AMOUNT');
            throw err;
          }

          await this.outbox.emit(tx, {
            tenantId: scope.tenantId,
            type: 'payment.recorded',
            payload: {
              paymentId: payment.id,
              number,
              customerId: body.customerId,
              amount,
              currency,
            },
            actorMembershipId: scope.actorMembershipId,
          });

          await this.audit.record(tx, {
            tenantId: scope.tenantId,
            action: 'finance.payment.recorded',
            entityType: 'payment',
            entityId: payment.id,
            actor: userActor(scope),
            metadata: {
              number,
              customerId: body.customerId,
              amount,
              currency,
              method: payment.method,
            },
          });

          if (body.allocations && body.allocations.length > 0) {
            await this.allocations.allocateWithin(
              tx,
              scope,
              payment,
              body.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
            );
            await this.audit.record(tx, {
              tenantId: scope.tenantId,
              action: 'finance.payment.allocated',
              entityType: 'payment',
              entityId: payment.id,
              actor: userActor(scope),
              metadata: {
                number,
                allocations: body.allocations.map((a) => ({
                  invoiceId: a.invoiceId,
                  amount: a.amount,
                })),
              },
            });
          }
          return { id: payment.id };
        },
        async (existingId) => ({ id: existingId }),
      );
      return this.detail(tx, scope, created.id);
    });
  }

  async reverse(
    scope: TenantScope,
    id: string,
    reason: string | undefined,
    idempotencyKey?: string,
  ): Promise<PaymentDetailDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await withIdempotency(
        tx,
        scope.tenantId,
        idempotencyKey,
        'payment.reverse',
        async () => {
          const [payment] = await tx
            .select()
            .from(payments)
            .where(and(eq(payments.tenantId, scope.tenantId), eq(payments.id, id)))
            .for('update')
            .limit(1);
          if (!payment) throw new AppError('PAYMENT_NOT_FOUND');
          if (payment.status === 'REVERSED') return { id: payment.id }; // idempotent
          if (payment.status !== 'RECORDED') {
            throw new AppError('PAYMENT_INVALID_STATE', { details: { status: payment.status } });
          }

          const active = await tx
            .select()
            .from(paymentAllocations)
            .where(
              and(
                eq(paymentAllocations.tenantId, scope.tenantId),
                eq(paymentAllocations.paymentId, id),
                isNull(paymentAllocations.reversedAt),
              ),
            );

          await tx
            .update(payments)
            .set({
              status: 'REVERSED',
              reversedAt: new Date(),
              reversedByMembershipId: scope.actorMembershipId,
              reversalReason: reason ?? null,
              updatedAt: new Date(),
            })
            .where(and(eq(payments.tenantId, scope.tenantId), eq(payments.id, id)));

          for (const alloc of active) {
            await tx
              .update(paymentAllocations)
              .set({ reversedAt: new Date() })
              .where(
                and(
                  eq(paymentAllocations.tenantId, scope.tenantId),
                  eq(paymentAllocations.id, alloc.id),
                ),
              );
            const [inv] = await tx
              .select({ status: invoices.status })
              .from(invoices)
              .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, alloc.invoiceId)))
              .limit(1);
            await recalcInvoiceAndEmit(
              tx,
              scope,
              this.outbox,
              alloc.invoiceId,
              inv?.status ?? 'ISSUED',
            );
          }
          await recalcPayment(tx, scope.tenantId, id);

          await this.outbox.emit(tx, {
            tenantId: scope.tenantId,
            type: 'payment.reversed',
            payload: { paymentId: id, number: payment.number, amount: payment.amount },
            actorMembershipId: scope.actorMembershipId,
          });
          await this.audit.record(tx, {
            tenantId: scope.tenantId,
            action: 'finance.payment.reversed',
            entityType: 'payment',
            entityId: id,
            actor: userActor(scope),
            metadata: {
              number: payment.number,
              amount: payment.amount,
              reason: reason ?? null,
              reversedAllocations: active.length,
            },
            changes: { status: { from: 'RECORDED', to: 'REVERSED' } },
          });
          return { id: payment.id };
        },
        async (existingId) => ({ id: existingId }),
      );
      return this.detail(tx, scope, id);
    });
  }
}
