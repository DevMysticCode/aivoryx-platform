import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';
import { tenants, userTenantMemberships } from './identity.js';

/**
 * Phase 13 (ADR 0042) extends this model additively — no second authorization
 * system:
 *
 * - `roles.kind` distinguishes a **profile** (a baseline capability set, one
 *   per member), a **permission_set** (additive, a member may hold several),
 *   and a plain **custom** role (the pre-Phase-13 default). Resolution is
 *   unchanged: a member's effective permissions are the union across every
 *   assigned role regardless of kind.
 * - `membership_roles.data_scope` records how wide a role assignment reaches
 *   (OWN / TEAM / DEPARTMENT / COMPANY). Modules that honour a scope (CRM
 *   first) read it; modules with their own access boundary (Field, HR
 *   self-service) are unaffected.
 */
export const roleKind = pgEnum('role_kind', ['profile', 'permission_set', 'custom']);
export const dataScope = pgEnum('data_scope', ['OWN', 'TEAM', 'DEPARTMENT', 'COMPANY']);

/**
 * RBAC data model (Phase 2, Task 1) — schema only. No enforcement, no seed data.
 *
 *   membership ──< membership_roles >── role ──< role_permissions >── permission
 *
 * - `permissions` is a single global catalogue of stable
 *   `<module>.<resource>.<action>` keys (ADR 0011). Not tenant-owned.
 * - `roles` are per-tenant (`tenant_id` NOT NULL). Platform default roles are
 *   seeded into each tenant by a later task, not hardcoded here, and are never
 *   client-specific (ADR 0026).
 * - Roles are assigned per **membership** (`membership_roles`), i.e. per
 *   (user, tenant) — refining ADR 0011's `user_roles`. Scope-aware assignment
 *   (branch/department/team/self) is deferred until those entities exist; today
 *   every assignment is effectively tenant-scoped.
 * - `membership_roles` and `role_permissions` carry a denormalised `tenant_id`
 *   so their composite foreign keys structurally forbid cross-tenant wiring and
 *   so the later RLS task can apply a uniform policy.
 */

const createdAt = timestamp('created_at', { withTimezone: true })
  .notNull()
  .default(sql`now()`);

const entityTimestamps = {
  createdAt,
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
};

// --- permissions (global catalogue) -----------------------------------

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    /** stable machine key, e.g. `identity.user.read` */
    key: text('key').notNull(),
    description: text('description'),
    ...entityTimestamps,
  },
  (t) => [unique('permissions_key_uq').on(t.key)],
);

// --- roles (per tenant) ----------------------------------------------------

export const roles = pgTable(
  'roles',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** stable machine key unique within the tenant, e.g. `owner`, `admin`, `member` */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** profile | permission_set | custom (Phase 13, ADR 0042) */
    kind: roleKind('kind').notNull().default('custom'),
    ...entityTimestamps,
  },
  (t) => [
    unique('roles_tenant_key_uq').on(t.tenantId, t.key),
    // Composite target for membership_roles / role_permissions FKs.
    unique('roles_id_tenant_uq').on(t.id, t.tenantId),
    index('roles_tenant_idx').on(t.tenantId),
  ],
);

// --- role_permissions (role ⋈ permission, within a tenant) ------------

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'restrict' }),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.roleId, t.permissionId] }),
    foreignKey({
      name: 'role_permissions_role_fk',
      columns: [t.roleId, t.tenantId],
      foreignColumns: [roles.id, roles.tenantId],
    }).onDelete('cascade'),
    index('role_permissions_permission_idx').on(t.permissionId),
    index('role_permissions_tenant_idx').on(t.tenantId),
  ],
);

// --- membership_roles (membership ⋈ role, within a tenant) -----------

export const membershipRoles = pgTable(
  'membership_roles',
  {
    membershipId: uuid('membership_id').notNull(),
    roleId: uuid('role_id').notNull(),
    tenantId: uuid('tenant_id').notNull(),
    /** how wide this assignment reaches (Phase 13, ADR 0042). COMPANY = tenant-wide. */
    dataScope: dataScope('data_scope').notNull().default('COMPANY'),
    createdAt,
  },
  (t) => [
    primaryKey({ columns: [t.membershipId, t.roleId] }),
    foreignKey({
      name: 'membership_roles_membership_fk',
      columns: [t.membershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'membership_roles_role_fk',
      columns: [t.roleId, t.tenantId],
      foreignColumns: [roles.id, roles.tenantId],
    }).onDelete('restrict'),
    index('membership_roles_role_idx').on(t.roleId),
    index('membership_roles_tenant_idx').on(t.tenantId),
  ],
);

export type RoleKind = (typeof roleKind.enumValues)[number];
export type DataScope = (typeof dataScope.enumValues)[number];
export type PermissionRow = typeof permissions.$inferSelect;
export type NewPermissionRow = typeof permissions.$inferInsert;
export type RoleRow = typeof roles.$inferSelect;
export type NewRoleRow = typeof roles.$inferInsert;
export type RolePermissionRow = typeof rolePermissions.$inferSelect;
export type NewRolePermissionRow = typeof rolePermissions.$inferInsert;
export type MembershipRoleRow = typeof membershipRoles.$inferSelect;
export type NewMembershipRoleRow = typeof membershipRoles.$inferInsert;
