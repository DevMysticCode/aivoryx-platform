import { sql } from 'drizzle-orm';
import { index, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';
import { tenants, users } from './identity.js';

/**
 * Subscription abstraction (Phase 14 §29-31) — architectural readiness for
 * future billing, not billing itself. `plan_key` / a plan's `solution_key`
 * are code-defined catalogues (`@aivoryx/shared`), never rows in this table.
 * `tenant_subscriptions` records only which plan a tenant currently has and
 * its commercial status; it is NOT consulted for authorization — that stays
 * `tenant_module_entitlements`, set once during provisioning from the plan's
 * solution and independently adjustable afterwards.
 */

/**
 * Platform access & module entitlements (Phase 13, ADR 0042).
 *
 * Two new concepts, plus small additive columns on the existing RBAC tables
 * (`roles.kind`, `membership_roles.data_scope` — see `rbac.ts`):
 *
 * 1. `platform_admins` — a GLOBAL table (not tenant-owned). A row grants a user
 *    Aivoryx platform administration: managing workspaces and their module
 *    entitlements. A platform admin is NOT automatically a tenant business user.
 *
 * 2. `tenant_module_entitlements` — TENANT-OWNED. Which product modules a
 *    workspace may use. The module catalogue itself is code
 *    (`@aivoryx/shared` `MODULE_DEFINITIONS`), not a table — there is nothing
 *    tenant-configurable about it, and a DB catalogue would just drift.
 *
 * The authorization order is fixed:
 *   tenant module entitlement → user profile/permission sets → data scope → allow/deny.
 */

const entityTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
};

// --- platform_admins (GLOBAL — no tenant) ----------------------------

export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** the platform admin who granted this, or null when seeded */
    grantedByUserId: uuid('granted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    note: text('note'),
    ...entityTimestamps,
  },
  (t) => [unique('platform_admins_user_uq').on(t.userId)],
);

// --- tenant_module_entitlements (TENANT-OWNED) ----------------------

export const moduleEntitlementState = pgEnum('module_entitlement_state', ['ENABLED', 'DISABLED']);

export const tenantModuleEntitlements = pgTable(
  'tenant_module_entitlements',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** stable module key from the code catalogue (CRM, HR, FIELD, …) */
    moduleKey: text('module_key').notNull(),
    state: moduleEntitlementState('state').notNull().default('DISABLED'),
    enabledAt: timestamp('enabled_at', { withTimezone: true }),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
    /** the platform-admin user id that last changed this entitlement */
    provisionedByUserId: uuid('provisioned_by_user_id'),
    note: text('note'),
    ...entityTimestamps,
  },
  (t) => [
    unique('tenant_module_entitlements_tenant_module_uq').on(t.tenantId, t.moduleKey),
    index('tenant_module_entitlements_tenant_idx').on(t.tenantId),
  ],
);

// --- tenant_subscriptions (TENANT-OWNED) -----------------------------

export const subscriptionStatus = pgEnum('subscription_status', ['active', 'canceled', 'expired']);

export const tenantSubscriptions = pgTable(
  'tenant_subscriptions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** stable plan key from the code catalogue (`@aivoryx/shared` PLAN_DEFINITIONS) */
    planKey: text('plan_key').notNull(),
    status: subscriptionStatus('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    renewsAt: timestamp('renews_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** opaque reference into a future billing provider — never interpreted here */
    billingProviderRef: text('billing_provider_ref'),
    ...entityTimestamps,
  },
  (t) => [
    // One subscription row per tenant for now — a history table is future work
    // if/when actual plan changes over time need to be tracked (§30).
    unique('tenant_subscriptions_tenant_uq').on(t.tenantId),
    index('tenant_subscriptions_tenant_idx').on(t.tenantId),
  ],
);

// --- row types --------------------------------------------------------

export type PlatformAdminRow = typeof platformAdmins.$inferSelect;
export type NewPlatformAdminRow = typeof platformAdmins.$inferInsert;
export type TenantModuleEntitlementRow = typeof tenantModuleEntitlements.$inferSelect;
export type NewTenantModuleEntitlementRow = typeof tenantModuleEntitlements.$inferInsert;
export type TenantSubscriptionRow = typeof tenantSubscriptions.$inferSelect;
export type NewTenantSubscriptionRow = typeof tenantSubscriptions.$inferInsert;
