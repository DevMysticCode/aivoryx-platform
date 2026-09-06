import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { DocumentRenderService } from '../documents/document-render.service.js';
import { buildCreditNoteDocument } from '../documents/builders.js';
import { pageBounds, type Paged, type TenantScope } from './common.js';
import { guardMoney, isCheckViolation, isUniqueViolation, normaliseCurrency } from './common.js';
import { assertPositiveMoney, dec, invoiceOutstanding } from './money.js';
import { isValidCreditNoteTransition } from './lifecycles.js';
import { nextNumber } from './numbering.js';
import { withIdempotency } from './idempotency.js';
import { recalcInvoiceAndEmit, toCreditNoteDto } from './finance-shared.js';
import type { CreateCreditNoteDto, CreditNoteDto, ListCreditNotesQueryDto } from './finance.dto.js';

const { creditNotes, invoices, customers } = schema;

/**
 * Credit notes / adjustments (Phase 9, ADR 0038). A deliberately minimal, lump
 * adjustment: number, customer, optional invoice, reason, amount, currency,
 * status. DRAFT → ISSUED / CANCELLED. An issued credit note reduces the linked
 * invoice's receivable (transactional projection); cancelling it restores the
 * receivable. Once issued the amount / customer / invoice link are immutable —
 * cancel and raise a new one to correct.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly documents: DocumentRenderService,
  ) {}

  /** Branded PDF of the credit note (Phase 10). Tenant-scoped load + branding. */
  async renderPdf(scope: TenantScope, id: string): Promise<{ filename: string; body: Buffer }> {
    const detail = await this.get(scope, id);
    return this.documents.render(scope, buildCreditNoteDocument(detail));
  }

  async list(scope: TenantScope, query: ListCreditNotesQueryDto): Promise<Paged<CreditNoteDto>> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds: SQL[] = [eq(creditNotes.tenantId, scope.tenantId)];
      if (query.status) conds.push(eq(creditNotes.status, query.status as 'DRAFT'));
      if (query.customerId) conds.push(eq(creditNotes.customerId, query.customerId));
      const where = and(...conds);

      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(creditNotes)
        .where(where);
      const rows = await tx
        .select({ cn: creditNotes, customerName: customers.name, invoiceNumber: invoices.number })
        .from(creditNotes)
        .leftJoin(customers, eq(creditNotes.customerId, customers.id))
        .leftJoin(invoices, eq(creditNotes.invoiceId, invoices.id))
        .where(where)
        .orderBy(desc(creditNotes.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows.map((r) =>
          toCreditNoteDto(r.cn, { customerName: r.customerName, invoiceNumber: r.invoiceNumber }),
        ),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  async get(scope: TenantScope, id: string): Promise<CreditNoteDto> {
    return withTenantContext(getDb(), scope, (tx) => this.detail(tx, scope, id));
  }

  private async detail(tx: Tx, scope: TenantScope, id: string): Promise<CreditNoteDto> {
    const [row] = await tx
      .select({ cn: creditNotes, customerName: customers.name, invoiceNumber: invoices.number })
      .from(creditNotes)
      .leftJoin(customers, eq(creditNotes.customerId, customers.id))
      .leftJoin(invoices, eq(creditNotes.invoiceId, invoices.id))
      .where(and(eq(creditNotes.tenantId, scope.tenantId), eq(creditNotes.id, id)))
      .limit(1);
    if (!row) throw new AppError('CREDIT_NOTE_NOT_FOUND');
    return toCreditNoteDto(row.cn, {
      customerName: row.customerName,
      invoiceNumber: row.invoiceNumber,
    });
  }

  async create(
    scope: TenantScope,
    body: CreateCreditNoteDto,
    idempotencyKey?: string,
  ): Promise<CreditNoteDto> {
    const currency = normaliseCurrency(body.currency);
    const amount = guardMoney(() => assertPositiveMoney(body.amount));

    return withTenantContext(getDb(), scope, async (tx) => {
      const created = await withIdempotency(
        tx,
        scope.tenantId,
        idempotencyKey,
        'credit_note.create',
        async () => {
          const [c] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.tenantId, scope.tenantId), eq(customers.id, body.customerId)))
            .limit(1);
          if (!c) throw new AppError('CUSTOMER_NOT_FOUND');

          if (body.invoiceId) {
            const [inv] = await tx
              .select({
                id: invoices.id,
                currency: invoices.currency,
                customerId: invoices.customerId,
              })
              .from(invoices)
              .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, body.invoiceId)))
              .limit(1);
            if (!inv) throw new AppError('INVOICE_NOT_FOUND');
            if (inv.currency !== currency) {
              throw new AppError('FINANCE_CURRENCY_MISMATCH', {
                details: { invoiceCurrency: inv.currency, creditNoteCurrency: currency },
              });
            }
            if (inv.customerId !== body.customerId) {
              throw new AppError('CREDIT_NOTE_INVALID_STATE', {
                message: 'The invoice belongs to a different customer.',
              });
            }
          }

          const number = await nextNumber(tx, scope.tenantId, 'credit_note');
          try {
            const [cn] = await tx
              .insert(creditNotes)
              .values({
                tenantId: scope.tenantId,
                number,
                customerId: body.customerId,
                invoiceId: body.invoiceId ?? null,
                projectId: body.projectId ?? null,
                status: 'DRAFT',
                currency,
                issueDate: body.issueDate ?? null,
                reason: body.reason.trim(),
                amount,
                notes: body.notes ?? null,
                createdByMembershipId: scope.actorMembershipId,
              })
              .returning();
            await this.outbox.emit(tx, {
              tenantId: scope.tenantId,
              type: 'credit_note.created',
              payload: { creditNoteId: cn!.id, number, customerId: body.customerId },
              actorMembershipId: scope.actorMembershipId,
            });
            return { id: cn!.id };
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

  async issue(scope: TenantScope, id: string, idempotencyKey?: string): Promise<CreditNoteDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await withIdempotency(
        tx,
        scope.tenantId,
        idempotencyKey,
        'credit_note.issue',
        async () => {
          const cn = await this.lock(tx, scope, id);
          if (cn.status === 'ISSUED') return { id: cn.id }; // idempotent
          if (!isValidCreditNoteTransition(cn.status, 'ISSUED')) {
            throw new AppError('CREDIT_NOTE_INVALID_STATE', { details: { status: cn.status } });
          }

          if (cn.invoiceId) {
            const [inv] = await tx
              .select()
              .from(invoices)
              .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, cn.invoiceId)))
              .for('update')
              .limit(1);
            if (!inv) throw new AppError('INVOICE_NOT_FOUND');
            const outstanding = invoiceOutstanding(
              inv.grandTotal,
              inv.amountPaid,
              inv.amountCredited,
            );
            if (dec.gt(cn.amount, outstanding)) {
              throw new AppError('CREDIT_NOTE_EXCEEDS_INVOICE', {
                details: { outstanding, amount: cn.amount },
              });
            }
            await tx
              .update(creditNotes)
              .set({
                status: 'ISSUED',
                issueDate: cn.issueDate ?? new Date().toISOString().slice(0, 10),
                issuedAt: new Date(),
                issuedByMembershipId: scope.actorMembershipId,
                updatedAt: new Date(),
              })
              .where(and(eq(creditNotes.tenantId, scope.tenantId), eq(creditNotes.id, id)));
            try {
              await recalcInvoiceAndEmit(tx, scope, this.outbox, cn.invoiceId, inv.status);
            } catch (err) {
              if (isCheckViolation(err)) throw new AppError('CREDIT_NOTE_EXCEEDS_INVOICE');
              throw err;
            }
          } else {
            await tx
              .update(creditNotes)
              .set({
                status: 'ISSUED',
                issueDate: cn.issueDate ?? new Date().toISOString().slice(0, 10),
                issuedAt: new Date(),
                issuedByMembershipId: scope.actorMembershipId,
                updatedAt: new Date(),
              })
              .where(and(eq(creditNotes.tenantId, scope.tenantId), eq(creditNotes.id, id)));
          }

          await this.outbox.emit(tx, {
            tenantId: scope.tenantId,
            type: 'credit_note.issued',
            payload: { creditNoteId: id, number: cn.number, invoiceId: cn.invoiceId },
            actorMembershipId: scope.actorMembershipId,
          });
          return { id: cn.id };
        },
        async (existingId) => ({ id: existingId }),
      );
      return this.detail(tx, scope, id);
    });
  }

  async cancel(scope: TenantScope, id: string, reason: string | undefined): Promise<CreditNoteDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const cn = await this.lock(tx, scope, id);
      if (cn.status === 'CANCELLED') return this.detail(tx, scope, id);
      if (!isValidCreditNoteTransition(cn.status, 'CANCELLED')) {
        throw new AppError('CREDIT_NOTE_INVALID_STATE', { details: { status: cn.status } });
      }
      const wasIssued = cn.status === 'ISSUED';
      await tx
        .update(creditNotes)
        .set({
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledByMembershipId: scope.actorMembershipId,
          cancelReason: reason ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(creditNotes.tenantId, scope.tenantId), eq(creditNotes.id, id)));

      if (wasIssued && cn.invoiceId) {
        const [inv] = await tx
          .select({ status: invoices.status })
          .from(invoices)
          .where(and(eq(invoices.tenantId, scope.tenantId), eq(invoices.id, cn.invoiceId)))
          .limit(1);
        await recalcInvoiceAndEmit(tx, scope, this.outbox, cn.invoiceId, inv?.status ?? 'ISSUED');
      }
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'credit_note.cancelled',
        payload: { creditNoteId: id, number: cn.number },
        actorMembershipId: scope.actorMembershipId,
      });
      return this.detail(tx, scope, id);
    });
  }

  private async lock(tx: Tx, scope: TenantScope, id: string): Promise<schema.CreditNoteRow> {
    const [row] = await tx
      .select()
      .from(creditNotes)
      .where(and(eq(creditNotes.tenantId, scope.tenantId), eq(creditNotes.id, id)))
      .for('update')
      .limit(1);
    if (!row) throw new AppError('CREDIT_NOTE_NOT_FOUND');
    return row;
  }
}
