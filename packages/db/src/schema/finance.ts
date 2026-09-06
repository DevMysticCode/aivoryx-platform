import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';
import { tenants, userTenantMemberships } from './identity.js';
import { customers, quotations } from './commercial.js';
import { products, projects } from './supply.js';

/**
 * Finance — operational Invoicing & Payments (Phase 9, ADR 0038).
 *
 * A reusable operational finance layer, NOT an accounting system: there is no
 * general ledger, chart of accounts, journals, trial balance, P&L or statutory
 * accounting. Those belong in a dedicated provider (Zoho Books, Xero, …); the
 * records here are shaped so a future integration layer can map them.
 *
 * Built ON the existing platform — no second customer/tenant/project/product/
 * permission/outbox/storage mechanism. An invoice belongs to an existing
 * Phase 6 `customers` row and may reference a `projects` / `quotations` row.
 *
 * Money is PostgreSQL NUMERIC(18,2) throughout (never JS floats); callers do
 * fixed-point decimal math on strings via `apps/api/src/supply/decimal.ts`.
 *
 * Financial history is protected: an issued invoice's lines/totals are frozen,
 * payments are never deleted (REVERSED/CANCELLED lifecycle), and issued credit
 * notes are immutable.
 *
 * Source of truth for balances:
 *   invoice.amount_paid     = SUM(active payment_allocations for the invoice)
 *   invoice.amount_credited = SUM(issued credit_notes for the invoice)
 *   payment.allocated_amount= SUM(active payment_allocations for the payment)
 * These columns are transactional PROJECTIONS recomputed from the authoritative
 * allocation / credit-note rows inside the same locked transaction. Outstanding
 * / unallocated are derived (never stored). DB CHECKs guarantee the invariants
 * (paid+credited <= grand_total ; allocated <= amount) can never be violated.
 */

const MONEY = { precision: 18, scale: 2 } as const;
const QTY = { precision: 18, scale: 4 } as const;
const RATE = { precision: 9, scale: 6 } as const;

const entityTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
};

// --- enums -----------------------------------------------------------

export const invoiceStatus = pgEnum('invoice_status', [
  'DRAFT',
  'ISSUED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'VOID',
]);

/** Simple, generic line discount — a flat amount or a percent of the line gross. */
export const lineDiscountType = pgEnum('line_discount_type', ['AMOUNT', 'PERCENT']);

export const paymentStatus = pgEnum('payment_status', ['RECORDED', 'REVERSED', 'CANCELLED']);

/** Generic, vendor-neutral — no payment-gateway coupling. */
export const paymentMethod = pgEnum('payment_method', [
  'BANK_TRANSFER',
  'CASH',
  'CARD',
  'CHEQUE',
  'UPI',
  'OTHER',
]);

export const creditNoteStatus = pgEnum('credit_note_status', ['DRAFT', 'ISSUED', 'CANCELLED']);

/** Where an invoice originated. Not every invoice comes from a quotation. */
export const invoiceSource = pgEnum('invoice_source', ['manual', 'quotation', 'project']);

const CURRENCY_RE = sql`'^[A-Z]{3}$'`;

// --- finance_counters (generic tenant-scoped numbering) ---------------

/**
 * One row per (tenant, kind). Human-facing numbers are `${prefix}${value
 * padded to `padding`}` (e.g. `INV-000001`). Incremented atomically inside the
 * creating transaction (`... set value = value + 1 returning value` under the
 * row lock), so concurrent creates never collide. Generic enough for future
 * formats; deliberately NOT a full numbering-rule engine.
 */
export const financeCounters = pgTable(
  'finance_counters',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** 'invoice' | 'payment' | 'credit_note' */
    kind: text('kind').notNull(),
    prefix: text('prefix').notNull(),
    padding: integer('padding').notNull().default(6),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
    ...entityTimestamps,
  },
  (t) => [unique('finance_counters_tenant_kind_uq').on(t.tenantId, t.kind)],
);

// --- finance_idempotency (generic request idempotency) ---------------

/**
 * Explicit idempotency for mutating finance operations. A client sends an
 * `Idempotency-Key`; the first request inserts `(tenant_id, key)` and records
 * the resulting entity; a retry finds the row and the caller returns the same
 * entity instead of acting again. Not a timestamp-based scheme.
 */
export const financeIdempotency = pgTable(
  'finance_idempotency',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    operation: text('operation').notNull(),
    /** the id of the entity the first request produced/affected */
    resultRef: uuid('result_ref'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('finance_idempotency_tenant_key_uq').on(t.tenantId, t.key),
    index('finance_idempotency_tenant_created_idx').on(t.tenantId, t.createdAt),
  ],
);

// --- invoices ------------------------------------------------------

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    customerId: uuid('customer_id').notNull(),
    projectId: uuid('project_id'),
    quotationId: uuid('quotation_id'),
    source: invoiceSource('source').notNull().default('manual'),
    status: invoiceStatus('status').notNull().default('DRAFT'),
    currency: text('currency').notNull().default('INR'),
    issueDate: date('issue_date'),
    dueDate: date('due_date'),
    notes: text('notes'),
    reference: text('reference'),
    // frozen financial snapshots (recomputed from lines while DRAFT; frozen at issue)
    subtotal: numeric('subtotal', MONEY).notNull().default('0'),
    discountTotal: numeric('discount_total', MONEY).notNull().default('0'),
    taxTotal: numeric('tax_total', MONEY).notNull().default('0'),
    grandTotal: numeric('grand_total', MONEY).notNull().default('0'),
    // transactional projections from authoritative allocations / credit notes
    amountPaid: numeric('amount_paid', MONEY).notNull().default('0'),
    amountCredited: numeric('amount_credited', MONEY).notNull().default('0'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    issuedByMembershipId: uuid('issued_by_membership_id'),
    /** set once, the first time this invoice is observed overdue, to fire the event */
    overdueNotifiedAt: timestamp('overdue_notified_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByMembershipId: uuid('cancelled_by_membership_id'),
    cancelReason: text('cancel_reason'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('invoices_tenant_number_uq').on(t.tenantId, t.number),
    unique('invoices_id_tenant_uq').on(t.id, t.tenantId),
    index('invoices_tenant_status_idx').on(t.tenantId, t.status),
    index('invoices_tenant_customer_idx').on(t.tenantId, t.customerId),
    index('invoices_tenant_project_idx').on(t.tenantId, t.projectId),
    index('invoices_tenant_due_idx').on(t.tenantId, t.dueDate),
    check(
      'invoices_money_nonneg',
      sql`"subtotal" >= 0 and "tax_total" >= 0 and "grand_total" >= 0`,
    ),
    check('invoices_paid_nonneg', sql`"amount_paid" >= 0 and "amount_credited" >= 0`),
    // the core invariant: paid + credited can never exceed the invoice total
    check('invoices_not_overpaid', sql`"amount_paid" + "amount_credited" <= "grand_total"`),
    check('invoices_currency_iso', sql`"currency" ~ ${CURRENCY_RE}`),
    foreignKey({
      name: 'invoices_customer_fk',
      columns: [t.customerId, t.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'invoices_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'invoices_quotation_fk',
      columns: [t.quotationId, t.tenantId],
      foreignColumns: [quotations.id, quotations.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'invoices_issued_by_fk',
      columns: [t.issuedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'invoices_cancelled_by_fk',
      columns: [t.cancelledByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'invoices_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- invoice_lines (immutable once the invoice is issued) ------------

export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id').notNull(),
    lineNo: integer('line_no').notNull(),
    /** optional catalogue reference; null for service/custom lines */
    productId: uuid('product_id'),
    /** optional free-text project / material / work reference */
    reference: text('reference'),
    description: text('description').notNull(),
    unitLabel: text('unit_label'),
    quantity: numeric('quantity', QTY).notNull().default('0'),
    unitPrice: numeric('unit_price', MONEY).notNull().default('0'),
    discountType: lineDiscountType('discount_type').notNull().default('AMOUNT'),
    discountValue: numeric('discount_value', MONEY).notNull().default('0'),
    taxName: text('tax_name'),
    taxRate: numeric('tax_rate', RATE).notNull().default('0'),
    // per-line snapshots
    lineSubtotal: numeric('line_subtotal', MONEY).notNull().default('0'),
    lineDiscount: numeric('line_discount', MONEY).notNull().default('0'),
    lineTaxable: numeric('line_taxable', MONEY).notNull().default('0'),
    lineTax: numeric('line_tax', MONEY).notNull().default('0'),
    lineTotal: numeric('line_total', MONEY).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('invoice_lines_tenant_invoice_line_uq').on(t.tenantId, t.invoiceId, t.lineNo),
    index('invoice_lines_tenant_invoice_idx').on(t.tenantId, t.invoiceId),
    check('invoice_lines_qty_nonneg', sql`"quantity" >= 0`),
    check(
      'invoice_lines_money_nonneg',
      sql`"unit_price" >= 0 and "discount_value" >= 0 and "tax_rate" >= 0`,
    ),
    foreignKey({
      name: 'invoice_lines_invoice_fk',
      columns: [t.invoiceId, t.tenantId],
      foreignColumns: [invoices.id, invoices.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'invoice_lines_product_fk',
      columns: [t.productId, t.tenantId],
      foreignColumns: [products.id, products.tenantId],
    }).onDelete('set null'),
  ],
);

// --- payments (never deleted; RECORDED → REVERSED / CANCELLED) -------

export const payments = pgTable(
  'payments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    customerId: uuid('customer_id').notNull(),
    paymentDate: date('payment_date').notNull(),
    amount: numeric('amount', MONEY).notNull(),
    currency: text('currency').notNull().default('INR'),
    method: paymentMethod('method').notNull().default('BANK_TRANSFER'),
    reference: text('reference'),
    notes: text('notes'),
    status: paymentStatus('status').notNull().default('RECORDED'),
    /** opaque external / provider reference — kept out of core logic */
    providerReference: text('provider_reference'),
    /** transactional projection: SUM(active allocations) */
    allocatedAmount: numeric('allocated_amount', MONEY).notNull().default('0'),
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    reversedByMembershipId: uuid('reversed_by_membership_id'),
    reversalReason: text('reversal_reason'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('payments_tenant_number_uq').on(t.tenantId, t.number),
    unique('payments_id_tenant_uq').on(t.id, t.tenantId),
    index('payments_tenant_status_idx').on(t.tenantId, t.status),
    index('payments_tenant_customer_idx').on(t.tenantId, t.customerId),
    index('payments_tenant_date_idx').on(t.tenantId, t.paymentDate),
    check('payments_amount_pos', sql`"amount" > 0`),
    check(
      'payments_allocated_range',
      sql`"allocated_amount" >= 0 and "allocated_amount" <= "amount"`,
    ),
    check('payments_currency_iso', sql`"currency" ~ ${CURRENCY_RE}`),
    foreignKey({
      name: 'payments_customer_fk',
      columns: [t.customerId, t.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payments_reversed_by_fk',
      columns: [t.reversedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'payments_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- payment_allocations (authoritative link payment ↔ invoice) -----

export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id').notNull(),
    invoiceId: uuid('invoice_id').notNull(),
    amount: numeric('amount', MONEY).notNull(),
    /** null = active; set when the parent payment is reversed */
    reversedAt: timestamp('reversed_at', { withTimezone: true }),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    // at most one allocation per (payment, invoice) — makes concurrent
    // allocation of the same payment to the same invoice resolve to exactly one
    unique('payment_allocations_tenant_pay_inv_uq').on(t.tenantId, t.paymentId, t.invoiceId),
    index('payment_allocations_tenant_invoice_idx').on(t.tenantId, t.invoiceId),
    index('payment_allocations_tenant_payment_idx').on(t.tenantId, t.paymentId),
    check('payment_allocations_amount_pos', sql`"amount" > 0`),
    foreignKey({
      name: 'payment_allocations_payment_fk',
      columns: [t.paymentId, t.tenantId],
      foreignColumns: [payments.id, payments.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'payment_allocations_invoice_fk',
      columns: [t.invoiceId, t.tenantId],
      foreignColumns: [invoices.id, invoices.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'payment_allocations_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- credit_notes (single lump adjustment; DRAFT → ISSUED / CANCELLED) --

export const creditNotes = pgTable(
  'credit_notes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    customerId: uuid('customer_id').notNull(),
    /** the invoice this adjustment reduces, when applicable */
    invoiceId: uuid('invoice_id'),
    projectId: uuid('project_id'),
    status: creditNoteStatus('status').notNull().default('DRAFT'),
    currency: text('currency').notNull().default('INR'),
    issueDate: date('issue_date'),
    reason: text('reason').notNull(),
    amount: numeric('amount', MONEY).notNull(),
    notes: text('notes'),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    issuedByMembershipId: uuid('issued_by_membership_id'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByMembershipId: uuid('cancelled_by_membership_id'),
    cancelReason: text('cancel_reason'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('credit_notes_tenant_number_uq').on(t.tenantId, t.number),
    unique('credit_notes_id_tenant_uq').on(t.id, t.tenantId),
    index('credit_notes_tenant_status_idx').on(t.tenantId, t.status),
    index('credit_notes_tenant_customer_idx').on(t.tenantId, t.customerId),
    index('credit_notes_tenant_invoice_idx').on(t.tenantId, t.invoiceId),
    check('credit_notes_amount_pos', sql`"amount" > 0`),
    check('credit_notes_currency_iso', sql`"currency" ~ ${CURRENCY_RE}`),
    foreignKey({
      name: 'credit_notes_customer_fk',
      columns: [t.customerId, t.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'credit_notes_invoice_fk',
      columns: [t.invoiceId, t.tenantId],
      foreignColumns: [invoices.id, invoices.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'credit_notes_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'credit_notes_issued_by_fk',
      columns: [t.issuedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'credit_notes_cancelled_by_fk',
      columns: [t.cancelledByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'credit_notes_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- row types --------------------------------------------------------

export type FinanceCounterRow = typeof financeCounters.$inferSelect;
export type NewFinanceCounterRow = typeof financeCounters.$inferInsert;
export type FinanceIdempotencyRow = typeof financeIdempotency.$inferSelect;
export type NewFinanceIdempotencyRow = typeof financeIdempotency.$inferInsert;
export type InvoiceRow = typeof invoices.$inferSelect;
export type NewInvoiceRow = typeof invoices.$inferInsert;
export type InvoiceLineRow = typeof invoiceLines.$inferSelect;
export type NewInvoiceLineRow = typeof invoiceLines.$inferInsert;
export type PaymentRow = typeof payments.$inferSelect;
export type NewPaymentRow = typeof payments.$inferInsert;
export type PaymentAllocationRow = typeof paymentAllocations.$inferSelect;
export type NewPaymentAllocationRow = typeof paymentAllocations.$inferInsert;
export type CreditNoteRow = typeof creditNotes.$inferSelect;
export type NewCreditNoteRow = typeof creditNotes.$inferInsert;
