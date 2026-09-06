import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';
import { tenants, userTenantMemberships } from './identity.js';
import { leads } from './crm.js';
import { products, projects } from './supply.js';

/**
 * Commercial — Customers, Quotations & Project Booking (Phase 6, ADR 0035).
 *
 * The commercial bridge between a qualified CRM lead and an operationally
 * activated Phase 5 project: a lead is quoted, the quotation is accepted, and
 * booking atomically promotes the lead to a customer, creates/activates the
 * existing `projects` row, and links everything together.
 *
 * Built ON the existing platform — no second customer/tenant/product/project/
 * custom-field/permission/outbox/storage mechanism. Money is PostgreSQL
 * NUMERIC throughout (never JS floats); callers do fixed-point decimal math on
 * strings via `apps/api/src/supply/decimal.ts`.
 *
 * Commercial history is protected: once a quotation revision is sent it is
 * frozen, and a new revision is created rather than mutating the old one.
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

// --- enums -------------------------------------------------------------

/** A commercial party. `prospect` before a deal is booked, `active` after. */
export const customerStatus = pgEnum('customer_status', ['prospect', 'active', 'inactive']);

/**
 * `DRAFT → SENT → ACCEPTED → BOOKED`, plus `DRAFT|SENT → CANCELLED` and
 * `SENT → EXPIRED`. Enforced by a pure function (`commercial/lifecycles.ts`),
 * not a workflow engine. `send` is an internal state transition — it does not
 * email the customer (ADR 0035).
 */
export const quotationStatus = pgEnum('quotation_status', [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'BOOKED',
  'CANCELLED',
  'EXPIRED',
]);

/**
 * A revision's own frozen state. Only a `draft` revision is editable; `sent`,
 * `accepted` and `superseded` revisions are immutable commercial history.
 */
export const quotationRevisionStatus = pgEnum('quotation_revision_status', [
  'draft',
  'sent',
  'accepted',
  'superseded',
]);

export const quotationActivityType = pgEnum('quotation_activity_type', [
  'created',
  'updated',
  'revised',
  'sent',
  'accepted',
  'cancelled',
  'expired',
  'booked',
]);

// --- customers -------------------------------------------------------

export const customers = pgTable(
  'customers',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    normalizedPhone: text('normalized_phone'),
    email: text('email'),
    normalizedEmail: text('normalized_email'),
    addressLine: text('address_line'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),
    /** operational site — may differ from the billing address */
    siteAddressLine: text('site_address_line'),
    siteCity: text('site_city'),
    siteState: text('site_state'),
    sitePostalCode: text('site_postal_code'),
    siteCountry: text('site_country'),
    taxReference: text('tax_reference'),
    notes: text('notes'),
    status: customerStatus('status').notNull().default('prospect'),
    /** the CRM lead this customer was promoted from, when applicable */
    leadId: uuid('lead_id'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('customers_tenant_number_uq').on(t.tenantId, t.number),
    unique('customers_id_tenant_uq').on(t.id, t.tenantId),
    index('customers_tenant_status_idx').on(t.tenantId, t.status),
    index('customers_tenant_lead_idx').on(t.tenantId, t.leadId),
    index('customers_tenant_phone_idx')
      .on(t.tenantId, t.normalizedPhone)
      .where(sql`normalized_phone is not null`),
    index('customers_tenant_email_idx')
      .on(t.tenantId, t.normalizedEmail)
      .where(sql`normalized_email is not null`),
    foreignKey({
      name: 'customers_lead_fk',
      columns: [t.leadId, t.tenantId],
      foreignColumns: [leads.id, leads.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'customers_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- quotations ----------------------------------------------------

export const quotations = pgTable(
  'quotations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    /** every quotation originates from a CRM lead */
    leadId: uuid('lead_id').notNull(),
    /** set when the customer is promoted/linked (at or before booking) */
    customerId: uuid('customer_id'),
    /** set at booking — the operationally activated Phase 5 project */
    projectId: uuid('project_id'),
    status: quotationStatus('status').notNull().default('DRAFT'),
    /** the revision number currently in force; the editable one iff status = DRAFT */
    currentRevisionNo: integer('current_revision_no').notNull().default(1),
    bookedAt: timestamp('booked_at', { withTimezone: true }),
    bookedByMembershipId: uuid('booked_by_membership_id'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('quotations_tenant_number_uq').on(t.tenantId, t.number),
    unique('quotations_id_tenant_uq').on(t.id, t.tenantId),
    index('quotations_tenant_status_idx').on(t.tenantId, t.status),
    index('quotations_tenant_lead_idx').on(t.tenantId, t.leadId),
    index('quotations_tenant_customer_idx').on(t.tenantId, t.customerId),
    index('quotations_tenant_created_idx').on(t.tenantId, t.createdAt),
    // at most one quotation may own a given project
    uniqueIndex('quotations_tenant_project_uq')
      .on(t.tenantId, t.projectId)
      .where(sql`project_id is not null`),
    foreignKey({
      name: 'quotations_lead_fk',
      columns: [t.leadId, t.tenantId],
      foreignColumns: [leads.id, leads.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'quotations_customer_fk',
      columns: [t.customerId, t.tenantId],
      foreignColumns: [customers.id, customers.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'quotations_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'quotations_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'quotations_booked_by_fk',
      columns: [t.bookedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- quotation revisions -----------------------------------------

/**
 * An immutable priced snapshot. A quotation gets revision 1 on creation; each
 * `revise` freezes the current revision (`superseded`) and appends the next
 * number. Totals are stored (not only derived) so historical pricing is fixed
 * even if a product's catalogue price later changes.
 */
export const quotationRevisions = pgTable(
  'quotation_revisions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    quotationId: uuid('quotation_id').notNull(),
    revisionNo: integer('revision_no').notNull(),
    status: quotationRevisionStatus('status').notNull().default('draft'),
    issueDate: timestamp('issue_date', { withTimezone: true }),
    validityDate: timestamp('validity_date', { withTimezone: true }),
    notes: text('notes'),
    /** Σ(qty × unit_price) before discount */
    subtotal: numeric('subtotal', MONEY).notNull().default('0'),
    /** Σ line discount */
    discountTotal: numeric('discount_total', MONEY).notNull().default('0'),
    /** Σ line tax (on the post-discount net) */
    taxTotal: numeric('tax_total', MONEY).notNull().default('0'),
    /** subtotal − discount_total + tax_total */
    total: numeric('total', MONEY).notNull().default('0'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByMembershipId: uuid('accepted_by_membership_id'),
    acceptanceNote: text('acceptance_note'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('quotation_revisions_tenant_quotation_no_uq').on(
      t.tenantId,
      t.quotationId,
      t.revisionNo,
    ),
    unique('quotation_revisions_id_tenant_uq').on(t.id, t.tenantId),
    index('quotation_revisions_tenant_quotation_idx').on(t.tenantId, t.quotationId),
    check('quotation_revisions_no_positive', sql`"revision_no" >= 1`),
    check(
      'quotation_revisions_money_nonneg',
      sql`"subtotal" >= 0 and "discount_total" >= 0 and "tax_total" >= 0 and "total" >= 0`,
    ),
    foreignKey({
      name: 'quotation_revisions_quotation_fk',
      columns: [t.quotationId, t.tenantId],
      foreignColumns: [quotations.id, quotations.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'quotation_revisions_accepted_by_fk',
      columns: [t.acceptedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'quotation_revisions_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- quotation lines -------------------------------------------

/**
 * A priced line on one revision. `productId` is optional: an existing catalogue
 * product may be referenced, but service/labour/custom lines are represented by
 * a free-text `description` with no product — the product catalogue is never
 * polluted with one-off items.
 */
export const quotationLines = pgTable(
  'quotation_lines',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    revisionId: uuid('revision_id').notNull(),
    lineNo: integer('line_no').notNull(),
    /** optional catalogue reference; null for service/custom lines */
    productId: uuid('product_id'),
    description: text('description').notNull(),
    /** free-text unit label snapshot (PCS, hrs, …) */
    unitLabel: text('unit_label'),
    quantity: numeric('quantity', QTY).notNull().default('0'),
    unitPrice: numeric('unit_price', MONEY).notNull().default('0'),
    discount: numeric('discount', MONEY).notNull().default('0'),
    /** rate, e.g. 0.18 for 18% */
    taxRate: numeric('tax_rate', RATE).notNull().default('0'),
    lineNet: numeric('line_net', MONEY).notNull().default('0'),
    lineTax: numeric('line_tax', MONEY).notNull().default('0'),
    lineTotal: numeric('line_total', MONEY).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('quotation_lines_tenant_revision_line_uq').on(t.tenantId, t.revisionId, t.lineNo),
    index('quotation_lines_tenant_revision_idx').on(t.tenantId, t.revisionId),
    check('quotation_lines_qty_nonneg', sql`"quantity" >= 0`),
    check(
      'quotation_lines_money_nonneg',
      sql`"unit_price" >= 0 and "discount" >= 0 and "tax_rate" >= 0`,
    ),
    foreignKey({
      name: 'quotation_lines_revision_fk',
      columns: [t.revisionId, t.tenantId],
      foreignColumns: [quotationRevisions.id, quotationRevisions.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'quotation_lines_product_fk',
      columns: [t.productId, t.tenantId],
      foreignColumns: [products.id, products.tenantId],
    }).onDelete('set null'),
  ],
);

// --- quotation activities (timeline) -------------------------

export const quotationActivities = pgTable(
  'quotation_activities',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    quotationId: uuid('quotation_id').notNull(),
    type: quotationActivityType('type').notNull(),
    actorMembershipId: uuid('actor_membership_id'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('quotation_activities_tenant_quotation_idx').on(t.tenantId, t.quotationId, t.createdAt),
    foreignKey({
      name: 'quotation_activities_quotation_fk',
      columns: [t.quotationId, t.tenantId],
      foreignColumns: [quotations.id, quotations.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'quotation_activities_actor_fk',
      columns: [t.actorMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- quotation attachments (existing object storage) --------

/** METADATA ONLY; bytes live in object storage. Mirrors `dispatch_attachments`. */
export const quotationAttachments = pgTable(
  'quotation_attachments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    quotationId: uuid('quotation_id').notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename'),
    contentType: text('content_type').notNull(),
    fileSize: integer('file_size').notNull(),
    uploadedByMembershipId: uuid('uploaded_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('quotation_attachments_tenant_quotation_idx').on(t.tenantId, t.quotationId),
    foreignKey({
      name: 'quotation_attachments_quotation_fk',
      columns: [t.quotationId, t.tenantId],
      foreignColumns: [quotations.id, quotations.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'quotation_attachments_uploaded_by_fk',
      columns: [t.uploadedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- row types ------------------------------------------------

export type CustomerRow = typeof customers.$inferSelect;
export type NewCustomerRow = typeof customers.$inferInsert;
export type QuotationRow = typeof quotations.$inferSelect;
export type NewQuotationRow = typeof quotations.$inferInsert;
export type QuotationRevisionRow = typeof quotationRevisions.$inferSelect;
export type NewQuotationRevisionRow = typeof quotationRevisions.$inferInsert;
export type QuotationLineRow = typeof quotationLines.$inferSelect;
export type NewQuotationLineRow = typeof quotationLines.$inferInsert;
export type QuotationActivityRow = typeof quotationActivities.$inferSelect;
export type NewQuotationActivityRow = typeof quotationActivities.$inferInsert;
export type QuotationAttachmentRow = typeof quotationAttachments.$inferSelect;
export type NewQuotationAttachmentRow = typeof quotationAttachments.$inferInsert;
