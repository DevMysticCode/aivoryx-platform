import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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

/**
 * Procurement, Inventory & Logistics (Phase 5, ADR 0034). A generic,
 * provider-neutral supply-chain layer built ON the existing platform — no
 * second user/tenant/permission/custom-field/outbox/storage mechanism.
 *
 * `projects` bridges the CRM lead to operations. Nothing here is solar-
 * specific: products/categories/units/suppliers/warehouses/stock are generic.
 * Stock is accounted through an append-only `stock_movements` ledger; a
 * `stock_levels` row is a maintained projection used for fast reads AND for
 * row-level locking that serializes concurrent movement writes.
 *
 * Quantities and money are PostgreSQL NUMERIC (never JS floats): drizzle
 * surfaces them as strings and callers do decimal math on strings.
 */

const QTY = { precision: 18, scale: 4 } as const;
const MONEY = { precision: 18, scale: 2 } as const;

const entityTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
};

// --- enums ---------------------------------------------------------------

/**
 * `DRAFT → APPROVED → PROCUREMENT → READY_FOR_DISPATCH → IN_PROGRESS →
 * COMPLETED`, plus `ON_HOLD` (reversible) and `CANCELLED` (terminal). See
 * ADR 0034 for the transition graph — enforced by a pure function, not a
 * workflow engine.
 */
export const projectStatus = pgEnum('project_status', [
  'DRAFT',
  'APPROVED',
  'PROCUREMENT',
  'READY_FOR_DISPATCH',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
]);

export const projectActivityType = pgEnum('project_activity_type', [
  'created',
  'approved',
  'status_changed',
  'on_hold',
  'resumed',
  'cancelled',
  'material_added',
  'material_updated',
  'material_removed',
  'allocated',
  'released',
  'purchase_order_linked',
  'goods_received',
  'dispatch_created',
  'dispatched',
  'delivered',
]);

export const warehouseType = pgEnum('warehouse_type', ['main', 'regional', 'transit', 'site']);

/**
 * The seven movement kinds from the phase brief. `on_hand_delta` /
 * `reserved_delta` on each row carry the actual effect; `type` is the
 * descriptive label.
 *
 *   RECEIPT      on_hand +q
 *   ALLOCATION   reserved +q                 (does not touch on_hand)
 *   RELEASE      reserved -q
 *   DISPATCH     on_hand -q, reserved -q     (allocated stock physically leaves)
 *   RETURN       on_hand +q
 *   ADJUSTMENT   on_hand ±q
 *   TRANSFER_OUT on_hand -q                  (paired with a TRANSFER_IN row)
 *   TRANSFER_IN  on_hand +q
 */
export const stockMovementType = pgEnum('stock_movement_type', [
  'RECEIPT',
  'ALLOCATION',
  'RELEASE',
  'DISPATCH',
  'RETURN',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
]);

export const purchaseOrderStatus = pgEnum('purchase_order_status', [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
]);

export const dispatchStatus = pgEnum('dispatch_status', [
  'DRAFT',
  'DISPATCHED',
  'DELIVERED',
  'CANCELLED',
]);

// --- units of measure --------------------------------------------------

/** Tenant-configurable units (PCS, M, KG, SET, …). Generic — not solar. */
export const units = pgTable(
  'units',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...entityTimestamps,
  },
  (t) => [
    unique('units_tenant_code_uq').on(t.tenantId, t.code),
    unique('units_id_tenant_uq').on(t.id, t.tenantId),
  ],
);

// --- product categories ----------------------------------------------

export const productCategories = pgTable(
  'product_categories',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...entityTimestamps,
  },
  (t) => [
    unique('product_categories_tenant_code_uq').on(t.tenantId, t.code),
    unique('product_categories_id_tenant_uq').on(t.id, t.tenantId),
  ],
);

// --- products --------------------------------------------------------

export const products = pgTable(
  'products',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    categoryId: uuid('category_id'),
    unitId: uuid('unit_id').notNull(),
    brand: text('brand'),
    model: text('model'),
    /** reorder threshold for low-stock reporting; nullable = not tracked */
    reorderLevel: numeric('reorder_level', QTY),
    isActive: boolean('is_active').notNull().default(true),
    ...entityTimestamps,
  },
  (t) => [
    unique('products_tenant_sku_uq').on(t.tenantId, t.sku),
    unique('products_id_tenant_uq').on(t.id, t.tenantId),
    index('products_tenant_category_idx').on(t.tenantId, t.categoryId),
    index('products_tenant_active_idx').on(t.tenantId, t.isActive),
    foreignKey({
      name: 'products_category_fk',
      columns: [t.categoryId, t.tenantId],
      foreignColumns: [productCategories.id, productCategories.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'products_unit_fk',
      columns: [t.unitId, t.tenantId],
      foreignColumns: [units.id, units.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- suppliers ------------------------------------------------------

export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    contactName: text('contact_name'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    addressLine: text('address_line'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),
    taxReference: text('tax_reference'),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    ...entityTimestamps,
  },
  (t) => [
    unique('suppliers_tenant_code_uq').on(t.tenantId, t.code),
    unique('suppliers_id_tenant_uq').on(t.id, t.tenantId),
    index('suppliers_tenant_active_idx').on(t.tenantId, t.isActive),
  ],
);

// --- warehouses ---------------------------------------------------

export const warehouses = pgTable(
  'warehouses',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: warehouseType('type').notNull().default('main'),
    addressLine: text('address_line'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),
    isActive: boolean('is_active').notNull().default(true),
    ...entityTimestamps,
  },
  (t) => [
    unique('warehouses_tenant_code_uq').on(t.tenantId, t.code),
    unique('warehouses_id_tenant_uq').on(t.id, t.tenantId),
    index('warehouses_tenant_active_idx').on(t.tenantId, t.isActive),
  ],
);

// --- projects (CRM ↔ operations bridge) --------------------------------

export const projects = pgTable(
  'projects',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').notNull(),
    number: text('number').notNull(),
    customerName: text('customer_name'),
    status: projectStatus('status').notNull().default('DRAFT'),
    /** operational site — snapshotted from the lead, editable */
    siteAddressLine: text('site_address_line'),
    siteCity: text('site_city'),
    siteState: text('site_state'),
    sitePostalCode: text('site_postal_code'),
    siteCountry: text('site_country'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByMembershipId: uuid('approved_by_membership_id'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('projects_tenant_number_uq').on(t.tenantId, t.number),
    unique('projects_id_tenant_uq').on(t.id, t.tenantId),
    index('projects_tenant_status_idx').on(t.tenantId, t.status),
    index('projects_tenant_lead_idx').on(t.tenantId, t.leadId),
    foreignKey({
      name: 'projects_lead_fk',
      columns: [t.leadId, t.tenantId],
      foreignColumns: [leads.id, leads.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'projects_approved_by_fk',
      columns: [t.approvedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'projects_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

export const projectActivities = pgTable(
  'project_activities',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    type: projectActivityType('type').notNull(),
    actorMembershipId: uuid('actor_membership_id'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('project_activities_tenant_project_idx').on(t.tenantId, t.projectId, t.createdAt),
    foreignKey({
      name: 'project_activities_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_activities_actor_fk',
      columns: [t.actorMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

/**
 * A project's bill of materials. `required` is planned; `allocated`,
 * `dispatched`, `delivered` are running totals maintained transactionally by
 * the allocation / dispatch / delivery flows — never edited directly.
 */
export const projectMaterials = pgTable(
  'project_materials',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    productId: uuid('product_id').notNull(),
    requiredQty: numeric('required_qty', QTY).notNull().default('0'),
    allocatedQty: numeric('allocated_qty', QTY).notNull().default('0'),
    dispatchedQty: numeric('dispatched_qty', QTY).notNull().default('0'),
    deliveredQty: numeric('delivered_qty', QTY).notNull().default('0'),
    notes: text('notes'),
    ...entityTimestamps,
  },
  (t) => [
    unique('project_materials_tenant_project_product_uq').on(t.tenantId, t.projectId, t.productId),
    unique('project_materials_id_tenant_uq').on(t.id, t.tenantId),
    index('project_materials_tenant_project_idx').on(t.tenantId, t.projectId),
    check(
      'project_materials_qty_nonneg',
      sql`
      "required_qty" >= 0 and "allocated_qty" >= 0
      and "dispatched_qty" >= 0 and "delivered_qty" >= 0
    `,
    ),
    foreignKey({
      name: 'project_materials_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'project_materials_product_fk',
      columns: [t.productId, t.tenantId],
      foreignColumns: [products.id, products.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- inventory: stock levels + movement ledger ------------------------

/**
 * Maintained projection of on-hand / reserved per (warehouse, product).
 * Rebuildable by summing `stock_movements`. Every movement write locks the
 * matching row `FOR UPDATE` first, which serializes concurrent writers and
 * makes the negative-stock / over-allocation checks race-free.
 */
export const stockLevels = pgTable(
  'stock_levels',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    onHand: numeric('on_hand', QTY).notNull().default('0'),
    reserved: numeric('reserved', QTY).notNull().default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('stock_levels_tenant_wh_product_uq').on(t.tenantId, t.warehouseId, t.productId),
    index('stock_levels_tenant_product_idx').on(t.tenantId, t.productId),
    check(
      'stock_levels_nonneg',
      sql`"on_hand" >= 0 and "reserved" >= 0 and "reserved" <= "on_hand"`,
    ),
    foreignKey({
      name: 'stock_levels_warehouse_fk',
      columns: [t.warehouseId, t.tenantId],
      foreignColumns: [warehouses.id, warehouses.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'stock_levels_product_fk',
      columns: [t.productId, t.tenantId],
      foreignColumns: [products.id, products.tenantId],
    }).onDelete('cascade'),
  ],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    type: stockMovementType('type').notNull(),
    /** effect on the matching stock_levels row (signed) */
    onHandDelta: numeric('on_hand_delta', QTY).notNull().default('0'),
    reservedDelta: numeric('reserved_delta', QTY).notNull().default('0'),
    /** absolute quantity moved, always positive — for human-readable ledgers */
    quantity: numeric('quantity', QTY).notNull(),
    /** optional project the movement relates to (allocation / dispatch) */
    projectId: uuid('project_id'),
    /** what caused this movement, e.g. goods_receipt / allocation / dispatch / adjustment / transfer */
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    /** client-supplied retry key — makes allocate/release/adjust/transfer idempotent */
    idempotencyKey: text('idempotency_key'),
    notes: text('notes'),
    createdByMembershipId: uuid('created_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('stock_movements_tenant_wh_product_idx').on(t.tenantId, t.warehouseId, t.productId),
    index('stock_movements_tenant_project_idx').on(t.tenantId, t.projectId),
    index('stock_movements_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('stock_movements_reference_idx').on(t.tenantId, t.referenceType, t.referenceId),
    uniqueIndex('stock_movements_tenant_idempotency_uq')
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    foreignKey({
      name: 'stock_movements_warehouse_fk',
      columns: [t.warehouseId, t.tenantId],
      foreignColumns: [warehouses.id, warehouses.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_movements_product_fk',
      columns: [t.productId, t.tenantId],
      foreignColumns: [products.id, products.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'stock_movements_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'stock_movements_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- procurement: purchase orders + goods receipts ------------------

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    projectId: uuid('project_id'),
    status: purchaseOrderStatus('status').notNull().default('DRAFT'),
    orderDate: timestamp('order_date', { withTimezone: true }),
    expectedDate: timestamp('expected_date', { withTimezone: true }),
    notes: text('notes'),
    subtotal: numeric('subtotal', MONEY).notNull().default('0'),
    taxTotal: numeric('tax_total', MONEY).notNull().default('0'),
    discountTotal: numeric('discount_total', MONEY).notNull().default('0'),
    total: numeric('total', MONEY).notNull().default('0'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedByMembershipId: uuid('approved_by_membership_id'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('purchase_orders_tenant_number_uq').on(t.tenantId, t.number),
    unique('purchase_orders_id_tenant_uq').on(t.id, t.tenantId),
    index('purchase_orders_tenant_status_idx').on(t.tenantId, t.status),
    index('purchase_orders_tenant_supplier_idx').on(t.tenantId, t.supplierId),
    index('purchase_orders_tenant_project_idx').on(t.tenantId, t.projectId),
    index('purchase_orders_tenant_order_date_idx').on(t.tenantId, t.orderDate),
    foreignKey({
      name: 'purchase_orders_supplier_fk',
      columns: [t.supplierId, t.tenantId],
      foreignColumns: [suppliers.id, suppliers.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'purchase_orders_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'purchase_orders_approved_by_fk',
      columns: [t.approvedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'purchase_orders_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    productId: uuid('product_id').notNull(),
    lineNo: integer('line_no').notNull(),
    orderedQty: numeric('ordered_qty', QTY).notNull(),
    receivedQty: numeric('received_qty', QTY).notNull().default('0'),
    unitPrice: numeric('unit_price', MONEY).notNull().default('0'),
    taxRate: numeric('tax_rate', { precision: 7, scale: 4 }).notNull().default('0'),
    discount: numeric('discount', MONEY).notNull().default('0'),
    lineTotal: numeric('line_total', MONEY).notNull().default('0'),
    ...entityTimestamps,
  },
  (t) => [
    unique('purchase_order_lines_po_line_uq').on(t.tenantId, t.purchaseOrderId, t.lineNo),
    unique('purchase_order_lines_id_tenant_uq').on(t.id, t.tenantId),
    index('purchase_order_lines_tenant_po_idx').on(t.tenantId, t.purchaseOrderId),
    check(
      'purchase_order_lines_qty_valid',
      sql`"ordered_qty" > 0 and "received_qty" >= 0 and "received_qty" <= "ordered_qty"`,
    ),
    foreignKey({
      name: 'purchase_order_lines_po_fk',
      columns: [t.purchaseOrderId, t.tenantId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'purchase_order_lines_product_fk',
      columns: [t.productId, t.tenantId],
      foreignColumns: [products.id, products.tenantId],
    }).onDelete('restrict'),
  ],
);

export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    purchaseOrderId: uuid('purchase_order_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    notes: text('notes'),
    /** client-supplied retry key — makes "receive" idempotent per PO */
    idempotencyKey: text('idempotency_key'),
    receivedByMembershipId: uuid('received_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('goods_receipts_tenant_number_uq').on(t.tenantId, t.number),
    unique('goods_receipts_id_tenant_uq').on(t.id, t.tenantId),
    unique('goods_receipts_tenant_idempotency_uq').on(t.tenantId, t.idempotencyKey),
    index('goods_receipts_tenant_po_idx').on(t.tenantId, t.purchaseOrderId),
    foreignKey({
      name: 'goods_receipts_po_fk',
      columns: [t.purchaseOrderId, t.tenantId],
      foreignColumns: [purchaseOrders.id, purchaseOrders.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goods_receipts_warehouse_fk',
      columns: [t.warehouseId, t.tenantId],
      foreignColumns: [warehouses.id, warehouses.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goods_receipts_received_by_fk',
      columns: [t.receivedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

export const goodsReceiptLines = pgTable(
  'goods_receipt_lines',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    goodsReceiptId: uuid('goods_receipt_id').notNull(),
    purchaseOrderLineId: uuid('purchase_order_line_id').notNull(),
    productId: uuid('product_id').notNull(),
    receivedQty: numeric('received_qty', QTY).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('goods_receipt_lines_tenant_gr_idx').on(t.tenantId, t.goodsReceiptId),
    check('goods_receipt_lines_qty_pos', sql`"received_qty" > 0`),
    foreignKey({
      name: 'goods_receipt_lines_gr_fk',
      columns: [t.goodsReceiptId, t.tenantId],
      foreignColumns: [goodsReceipts.id, goodsReceipts.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'goods_receipt_lines_pol_fk',
      columns: [t.purchaseOrderLineId, t.tenantId],
      foreignColumns: [purchaseOrderLines.id, purchaseOrderLines.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'goods_receipt_lines_product_fk',
      columns: [t.productId, t.tenantId],
      foreignColumns: [products.id, products.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- logistics: dispatches + deliveries ---------------------------

export const dispatches = pgTable(
  'dispatches',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    number: text('number').notNull(),
    projectId: uuid('project_id').notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    status: dispatchStatus('status').notNull().default('DRAFT'),
    destinationAddress: text('destination_address'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    notes: text('notes'),
    deliveryNotes: text('delivery_notes'),
    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('dispatches_tenant_number_uq').on(t.tenantId, t.number),
    unique('dispatches_id_tenant_uq').on(t.id, t.tenantId),
    index('dispatches_tenant_status_idx').on(t.tenantId, t.status),
    index('dispatches_tenant_project_idx').on(t.tenantId, t.projectId),
    index('dispatches_tenant_warehouse_idx').on(t.tenantId, t.warehouseId),
    index('dispatches_tenant_dispatched_idx').on(t.tenantId, t.dispatchedAt),
    foreignKey({
      name: 'dispatches_project_fk',
      columns: [t.projectId, t.tenantId],
      foreignColumns: [projects.id, projects.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'dispatches_warehouse_fk',
      columns: [t.warehouseId, t.tenantId],
      foreignColumns: [warehouses.id, warehouses.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'dispatches_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

export const dispatchLines = pgTable(
  'dispatch_lines',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dispatchId: uuid('dispatch_id').notNull(),
    productId: uuid('product_id').notNull(),
    projectMaterialId: uuid('project_material_id').notNull(),
    lineNo: integer('line_no').notNull(),
    quantity: numeric('quantity', QTY).notNull(),
    deliveredQty: numeric('delivered_qty', QTY).notNull().default('0'),
    ...entityTimestamps,
  },
  (t) => [
    unique('dispatch_lines_dispatch_line_uq').on(t.tenantId, t.dispatchId, t.lineNo),
    index('dispatch_lines_tenant_dispatch_idx').on(t.tenantId, t.dispatchId),
    check(
      'dispatch_lines_qty_valid',
      sql`"quantity" > 0 and "delivered_qty" >= 0 and "delivered_qty" <= "quantity"`,
    ),
    foreignKey({
      name: 'dispatch_lines_dispatch_fk',
      columns: [t.dispatchId, t.tenantId],
      foreignColumns: [dispatches.id, dispatches.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'dispatch_lines_product_fk',
      columns: [t.productId, t.tenantId],
      foreignColumns: [products.id, products.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'dispatch_lines_project_material_fk',
      columns: [t.projectMaterialId, t.tenantId],
      foreignColumns: [projectMaterials.id, projectMaterials.tenantId],
    }).onDelete('restrict'),
  ],
);

/**
 * Delivery-confirmation photo/document metadata. Bytes live in the object
 * storage service (`apps/api/src/storage`) — mirrors `visit_attachments`.
 */
export const dispatchAttachments = pgTable(
  'dispatch_attachments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dispatchId: uuid('dispatch_id').notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename'),
    contentType: text('content_type').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    uploadedByMembershipId: uuid('uploaded_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('dispatch_attachments_object_key_uq').on(t.objectKey),
    index('dispatch_attachments_tenant_dispatch_idx').on(t.tenantId, t.dispatchId),
    foreignKey({
      name: 'dispatch_attachments_dispatch_fk',
      columns: [t.dispatchId, t.tenantId],
      foreignColumns: [dispatches.id, dispatches.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'dispatch_attachments_uploaded_by_fk',
      columns: [t.uploadedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- row types --------------------------------------------------------

export type UnitRow = typeof units.$inferSelect;
export type NewUnitRow = typeof units.$inferInsert;
export type ProductCategoryRow = typeof productCategories.$inferSelect;
export type NewProductCategoryRow = typeof productCategories.$inferInsert;
export type ProductRow = typeof products.$inferSelect;
export type NewProductRow = typeof products.$inferInsert;
export type SupplierRow = typeof suppliers.$inferSelect;
export type NewSupplierRow = typeof suppliers.$inferInsert;
export type WarehouseRow = typeof warehouses.$inferSelect;
export type NewWarehouseRow = typeof warehouses.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type ProjectActivityRow = typeof projectActivities.$inferSelect;
export type NewProjectActivityRow = typeof projectActivities.$inferInsert;
export type ProjectMaterialRow = typeof projectMaterials.$inferSelect;
export type NewProjectMaterialRow = typeof projectMaterials.$inferInsert;
export type StockLevelRow = typeof stockLevels.$inferSelect;
export type NewStockLevelRow = typeof stockLevels.$inferInsert;
export type StockMovementRow = typeof stockMovements.$inferSelect;
export type NewStockMovementRow = typeof stockMovements.$inferInsert;
export type PurchaseOrderRow = typeof purchaseOrders.$inferSelect;
export type NewPurchaseOrderRow = typeof purchaseOrders.$inferInsert;
export type PurchaseOrderLineRow = typeof purchaseOrderLines.$inferSelect;
export type NewPurchaseOrderLineRow = typeof purchaseOrderLines.$inferInsert;
export type GoodsReceiptRow = typeof goodsReceipts.$inferSelect;
export type NewGoodsReceiptRow = typeof goodsReceipts.$inferInsert;
export type GoodsReceiptLineRow = typeof goodsReceiptLines.$inferSelect;
export type NewGoodsReceiptLineRow = typeof goodsReceiptLines.$inferInsert;
export type DispatchRow = typeof dispatches.$inferSelect;
export type NewDispatchRow = typeof dispatches.$inferInsert;
export type DispatchLineRow = typeof dispatchLines.$inferSelect;
export type NewDispatchLineRow = typeof dispatchLines.$inferInsert;
export type DispatchAttachmentRow = typeof dispatchAttachments.$inferSelect;
export type NewDispatchAttachmentRow = typeof dispatchAttachments.$inferInsert;
