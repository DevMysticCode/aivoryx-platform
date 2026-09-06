import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';
import type { OutboxService } from '../admin/outbox.service.js';
import type { TenantScope } from './common.js';
import { deriveOverdue } from './overdue.js';
import { invoiceOutstanding } from './money.js';
import { recalcInvoice } from './projections.js';
import type {
  AllocationDto,
  CreditNoteDto,
  InvoiceDto,
  MoneyLineDto,
  PaymentDto,
} from './finance.dto.js';

const { invoices, invoiceLines, payments, paymentAllocations, creditNotes, customers } = schema;

/** Everything the invoice DTO needs beyond the row itself. */
export interface InvoiceExtras {
  customerName?: string | null;
  projectNumber?: string | null;
}

export function toInvoiceDto(
  row: schema.InvoiceRow,
  extras: InvoiceExtras = {},
  today: Date = new Date(),
): InvoiceDto {
  const outstanding = invoiceOutstanding(row.grandTotal, row.amountPaid, row.amountCredited);
  const od = deriveOverdue({ status: row.status, dueDate: row.dueDate, outstanding }, today);
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    customerName: extras.customerName ?? null,
    projectId: row.projectId,
    projectNumber: extras.projectNumber ?? null,
    quotationId: row.quotationId,
    source: row.source,
    status: row.status,
    currency: row.currency,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    notes: row.notes,
    reference: row.reference,
    subtotal: row.subtotal,
    discountTotal: row.discountTotal,
    taxTotal: row.taxTotal,
    grandTotal: row.grandTotal,
    amountPaid: row.amountPaid,
    amountCredited: row.amountCredited,
    amountOutstanding: outstanding,
    overdue: od.overdue,
    daysOverdue: od.daysOverdue,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toInvoiceLineDto(row: schema.InvoiceLineRow): MoneyLineDto {
  return {
    lineNo: row.lineNo,
    description: row.description,
    reference: row.reference,
    productId: row.productId,
    unitLabel: row.unitLabel,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    discountType: row.discountType,
    discountValue: row.discountValue,
    taxName: row.taxName,
    taxRate: row.taxRate,
    lineSubtotal: row.lineSubtotal,
    lineDiscount: row.lineDiscount,
    lineTaxable: row.lineTaxable,
    lineTax: row.lineTax,
    lineTotal: row.lineTotal,
  };
}

export function toPaymentDto(row: schema.PaymentRow, customerName?: string | null): PaymentDto {
  const unallocated = subtract2dp(row.amount, row.allocatedAmount);
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    customerName: customerName ?? null,
    paymentDate: row.paymentDate,
    amount: row.amount,
    currency: row.currency,
    method: row.method,
    reference: row.reference,
    notes: row.notes,
    status: row.status,
    allocatedAmount: row.allocatedAmount,
    unallocatedAmount: unallocated,
    reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
    reversalReason: row.reversalReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toCreditNoteDto(
  row: schema.CreditNoteRow,
  extras: { customerName?: string | null; invoiceNumber?: string | null } = {},
): CreditNoteDto {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    customerName: extras.customerName ?? null,
    invoiceId: row.invoiceId,
    invoiceNumber: extras.invoiceNumber ?? null,
    projectId: row.projectId,
    status: row.status,
    currency: row.currency,
    issueDate: row.issueDate,
    reason: row.reason,
    amount: row.amount,
    notes: row.notes,
    issuedAt: row.issuedAt ? row.issuedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAllocationDto(
  row: schema.PaymentAllocationRow,
  paymentNumber: string,
  invoiceNumber: string,
): AllocationDto {
  return {
    id: row.id,
    paymentId: row.paymentId,
    paymentNumber,
    invoiceId: row.invoiceId,
    invoiceNumber,
    amount: row.amount,
    reversed: row.reversedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Fixed-point 2dp subtraction floored at 0 (kept here to avoid a cyclic import). */
function subtract2dp(a: string, b: string): string {
  return invoiceOutstanding(a, b, '0');
}

/**
 * After mutating allocations / credit notes for an invoice, recompute its
 * projection and emit the derived lifecycle events on any status change. Used
 * by both the allocation and credit-note flows so the behaviour is identical.
 */
export async function recalcInvoiceAndEmit(
  tx: Tx,
  scope: TenantScope,
  outbox: OutboxService,
  invoiceId: string,
  prevStatus: schema.InvoiceRow['status'],
): Promise<{ status: schema.InvoiceRow['status']; outstanding: string }> {
  const money = await recalcInvoice(tx, scope.tenantId, invoiceId);
  if (money.status !== prevStatus) {
    if (money.status === 'PARTIALLY_PAID') {
      await outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'invoice.partially_paid',
        payload: { invoiceId },
        actorMembershipId: scope.actorMembershipId,
      });
    } else if (money.status === 'PAID') {
      await outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'invoice.paid',
        payload: { invoiceId },
        actorMembershipId: scope.actorMembershipId,
      });
    }
  }
  return { status: money.status, outstanding: money.outstanding };
}

/** Load an invoice row (tenant-scoped), or null. */
export async function loadInvoice(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<schema.InvoiceRow | null> {
  const [row] = await tx
    .select()
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)))
    .limit(1);
  return row ?? null;
}

export { invoices, invoiceLines, payments, paymentAllocations, creditNotes, customers };
