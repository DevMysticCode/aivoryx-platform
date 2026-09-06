import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { guardMoney, isCheckViolation, isUniqueViolation, type TenantScope } from './common.js';
import { assertPositiveMoney, dec, invoiceOutstanding, paymentUnallocated } from './money.js';
import { invoiceAcceptsAllocation } from './lifecycles.js';
import { recalcInvoiceAndEmit } from './finance-shared.js';
import { recalcPayment } from './projections.js';
import { withIdempotency } from './idempotency.js';

const { invoices, payments, paymentAllocations } = schema;

export interface AllocationRequest {
  invoiceId: string;
  amount: string;
}

/**
 * Payment allocation (Phase 9, ADR 0038). A payment and an invoice are separate
 * concepts; a `payment_allocations` row links them. One payment can be split
 * across many invoices and one invoice can receive many payments. Allocation is
 * financially strict: it can never push an invoice's outstanding below zero or a
 * payment's unallocated below zero (validated here AND enforced by DB CHECKs),
 * and it always runs under `FOR UPDATE` locks (payment first, then invoice) so
 * concurrent requests serialise.
 */
@Injectable()
export class PaymentAllocationService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async allocate(
    scope: TenantScope,
    paymentId: string,
    requests: AllocationRequest[],
    idempotencyKey?: string,
  ): Promise<{ paymentId: string }> {
    return withTenantContext(getDb(), scope, (tx) =>
      withIdempotency(
        tx,
        scope.tenantId,
        idempotencyKey,
        'payment.allocate',
        async () => {
          const payment = await this.lockPayment(tx, scope, paymentId);
          if (payment.status !== 'RECORDED') {
            throw new AppError('PAYMENT_INVALID_STATE', { details: { status: payment.status } });
          }
          for (const req of requests) {
            await this.allocateOne(tx, scope, payment, req);
          }
          await this.audit.record(tx, {
            tenantId: scope.tenantId,
            action: 'finance.payment.allocated',
            entityType: 'payment',
            entityId: paymentId,
            actor: userActor(scope),
            metadata: {
              number: payment.number,
              allocations: requests.map((r) => ({ invoiceId: r.invoiceId, amount: r.amount })),
            },
          });
          return { id: paymentId };
        },
        async () => ({ id: paymentId }),
      ).then(() => ({ paymentId })),
    );
  }

  /** Used inside the record-payment transaction to attach same-request allocations. */
  async allocateWithin(
    tx: Tx,
    scope: TenantScope,
    payment: schema.PaymentRow,
    requests: AllocationRequest[],
  ): Promise<void> {
    for (const req of requests) {
      await this.allocateOne(tx, scope, payment, req);
    }
  }

  private async allocateOne(
    tx: Tx,
    scope: TenantScope,
    payment: schema.PaymentRow,
    req: AllocationRequest,
  ): Promise<void> {
    const amount = guardMoney(() => assertPositiveMoney(req.amount));

    const [inv] = await tx
      .select()
      .from(invoices)
      .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, req.invoiceId)))
      .for('update')
      .limit(1);
    if (!inv) throw new AppError('INVOICE_NOT_FOUND');
    if (!invoiceAcceptsAllocation(inv.status)) {
      throw new AppError('ALLOCATION_INVOICE_NOT_OPEN', { details: { status: inv.status } });
    }
    if (inv.currency !== payment.currency) {
      throw new AppError('FINANCE_CURRENCY_MISMATCH', {
        details: { invoiceCurrency: inv.currency, paymentCurrency: payment.currency },
      });
    }

    const outstanding = invoiceOutstanding(inv.grandTotal, inv.amountPaid, inv.amountCredited);
    if (dec.gt(amount, outstanding)) {
      throw new AppError('ALLOCATION_EXCEEDS_INVOICE', { details: { outstanding, amount } });
    }
    // re-read the payment's live allocated amount under the payment lock we hold
    const [freshPay] = await tx
      .select({ amount: payments.amount, allocatedAmount: payments.allocatedAmount })
      .from(payments)
      .where(and(eq(payments.tenantId, scope.tenantId), eq(payments.id, payment.id)))
      .limit(1);
    const unallocated = paymentUnallocated(
      freshPay?.amount ?? payment.amount,
      freshPay?.allocatedAmount ?? payment.allocatedAmount,
    );
    if (dec.gt(amount, unallocated)) {
      throw new AppError('ALLOCATION_EXCEEDS_PAYMENT', { details: { unallocated, amount } });
    }

    try {
      await tx.insert(paymentAllocations).values({
        tenantId: scope.tenantId,
        paymentId: payment.id,
        invoiceId: req.invoiceId,
        amount,
        createdByMembershipId: scope.actorMembershipId,
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError('ALLOCATION_DUPLICATE');
      if (isCheckViolation(err)) throw new AppError('ALLOCATION_EXCEEDS_INVOICE');
      throw err;
    }

    const prevStatus = inv.status;
    await recalcInvoiceAndEmit(tx, scope, this.outbox, req.invoiceId, prevStatus);
    await recalcPayment(tx, scope.tenantId, payment.id);
    await this.outbox.emit(tx, {
      tenantId: scope.tenantId,
      type: 'payment.allocated',
      payload: {
        paymentId: payment.id,
        invoiceId: req.invoiceId,
        amount,
      },
      actorMembershipId: scope.actorMembershipId,
    });
  }

  private async lockPayment(tx: Tx, scope: TenantScope, id: string): Promise<schema.PaymentRow> {
    const [row] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, scope.tenantId), eq(payments.id, id)))
      .for('update')
      .limit(1);
    if (!row) throw new AppError('PAYMENT_NOT_FOUND');
    return row;
  }
}
