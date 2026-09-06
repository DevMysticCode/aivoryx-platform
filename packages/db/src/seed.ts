import { fileURLToPath } from 'node:url';
import { eq, inArray, sql } from 'drizzle-orm';
import { PERMISSION_DEFINITIONS, PLATFORM_ROLE_KEYS } from '@aivoryx/shared';
import { createDb, type DbHandle } from './client.js';
import { newUuidV7 } from './id.js';
import { membershipRoles, permissions, rolePermissions, roles } from './schema/index.js';
import { withTenantContext, type Tx } from './tx.js';

/**
 * Seed / provisioning helpers for the security subsystem (ADR 0029).
 *
 * - `seedPermissions` upserts the global permission catalogue (`packages/shared`
 *   is the source of truth). Runs against the privileged (owner) handle;
 *   `permissions` is a global table with no RLS.
 * - `provisionTenantAdmin` idempotently creates the generic `TENANT_ADMIN` role
 *   in a tenant, grants it the whole catalogue, and (optionally) assigns it to a
 *   membership. It runs inside a tenant-context transaction so RLS `WITH CHECK`
 *   passes even for the owner role (FORCE RLS).
 *
 * No business roles are ever seeded here.
 */

/** Upsert every catalogue permission. Returns the number of catalogue entries. */
export async function seedPermissions(handle: DbHandle): Promise<number> {
  const rows = PERMISSION_DEFINITIONS.map((def) => ({
    id: newUuidV7(),
    key: def.key,
    description: def.description,
  }));
  await handle.db
    .insert(permissions)
    .values(rows)
    .onConflictDoUpdate({
      target: permissions.key,
      set: { description: sql`excluded.description`, updatedAt: sql`now()` },
    });
  return rows.length;
}

export interface ProvisionTenantAdminInput {
  tenantId: string;
  /** the id used to set `app.user_id` for the RLS-scoped transaction */
  actingUserId: string;
  /** if given, the TENANT_ADMIN role is assigned to this membership */
  membershipId?: string;
}

export interface ProvisionTenantAdminResult {
  roleId: string;
  permissionCount: number;
}

/** Create (or update) the generic `TENANT_ADMIN` role for a tenant and grant it
 *  the full permission catalogue. Idempotent. */
export async function provisionTenantAdmin(
  handle: DbHandle,
  input: ProvisionTenantAdminInput,
): Promise<ProvisionTenantAdminResult> {
  return withTenantContext(
    handle,
    { tenantId: input.tenantId, userId: input.actingUserId },
    async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({
          id: newUuidV7(),
          tenantId: input.tenantId,
          key: PLATFORM_ROLE_KEYS.tenantAdmin,
          name: 'Workspace administrator',
          description: 'Full access to the workspace security and administration surface.',
        })
        .onConflictDoUpdate({
          target: [roles.tenantId, roles.key],
          set: { name: sql`excluded.name`, updatedAt: sql`now()` },
        })
        .returning({ id: roles.id });

      const roleId = role!.id;

      const catalogueKeys = PERMISSION_DEFINITIONS.map((p) => p.key);
      const permRows = await tx
        .select({ id: permissions.id })
        .from(permissions)
        .where(inArray(permissions.key, catalogueKeys));

      if (permRows.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(permRows.map((p) => ({ roleId, tenantId: input.tenantId, permissionId: p.id })))
          .onConflictDoNothing();
      }

      if (input.membershipId) {
        await tx
          .insert(membershipRoles)
          .values({ membershipId: input.membershipId, roleId, tenantId: input.tenantId })
          .onConflictDoNothing();
      }

      return { roleId, permissionCount: permRows.length };
    },
  );
}

/**
 * The `FIELD_AGENT` platform role (Phase 4, ADR 0033) — the second generic
 * role alongside `TENANT_ADMIN`. Deliberately narrow: enough to work an
 * assigned visit, create field-generated leads, and work an assigned
 * installation / defect (Phase 7, ADR 0036) — nothing administrative
 * (no `field.visits.create/assign/update`, no `field.agents.manage`, no
 * `crm.leads.read/update`, no `projects.execution.*` beyond installation
 * work, no `projects.installation.assign`, no `projects.qc.*`,
 * `projects.complete`, or handover/net-metering control). Assignment,
 * scheduling, QC, and project administration stay CRM/admin-only.
 */
const FIELD_AGENT_PERMISSION_KEYS = [
  'field.visits.read',
  'field.visits.checkin',
  'field.visits.survey',
  'field.visits.attachments',
  'field.visits.complete',
  'crm.leads.create',
  'crm.activities.create',
  'projects.installation.read',
  'projects.installation.update',
  'projects.installation.complete',
  'projects.defects.read',
  'projects.defects.update',
] as const;

export interface ProvisionFieldAgentRoleInput {
  tenantId: string;
  actingUserId: string;
  membershipId?: string;
}

export interface ProvisionFieldAgentRoleResult {
  roleId: string;
  permissionCount: number;
}

/**
 * Same as {@link provisionFieldAgentRole} but runs against an already-open,
 * already-tenant-scoped transaction — for callers (e.g. the field-agent
 * designation flow) that need this atomic with their own writes rather than
 * in a second, separate transaction.
 */
export async function provisionFieldAgentRoleTx(
  tx: Tx,
  input: ProvisionFieldAgentRoleInput,
): Promise<ProvisionFieldAgentRoleResult> {
  const [role] = await tx
    .insert(roles)
    .values({
      id: newUuidV7(),
      tenantId: input.tenantId,
      key: PLATFORM_ROLE_KEYS.fieldAgent,
      name: 'Field agent',
      description: 'Works assigned site visits: check-in/out, survey, photos, notes.',
    })
    .onConflictDoUpdate({
      target: [roles.tenantId, roles.key],
      set: { name: sql`excluded.name`, updatedAt: sql`now()` },
    })
    .returning({ id: roles.id });

  const roleId = role!.id;

  const permRows = await tx
    .select({ id: permissions.id })
    .from(permissions)
    .where(inArray(permissions.key, [...FIELD_AGENT_PERMISSION_KEYS]));

  if (permRows.length > 0) {
    await tx
      .insert(rolePermissions)
      .values(permRows.map((p) => ({ roleId, tenantId: input.tenantId, permissionId: p.id })))
      .onConflictDoNothing();
  }

  if (input.membershipId) {
    await tx
      .insert(membershipRoles)
      .values({ membershipId: input.membershipId, roleId, tenantId: input.tenantId })
      .onConflictDoNothing();
  }

  return { roleId, permissionCount: permRows.length };
}

/** Create (or update) the generic `FIELD_AGENT` role for a tenant and grant it
 *  its fixed, narrow permission set. Idempotent. */
export async function provisionFieldAgentRole(
  handle: DbHandle,
  input: ProvisionFieldAgentRoleInput,
): Promise<ProvisionFieldAgentRoleResult> {
  return withTenantContext(handle, { tenantId: input.tenantId, userId: input.actingUserId }, (tx) =>
    provisionFieldAgentRoleTx(tx, input),
  );
}

/** Remove a permission from a role (used by admin flows / tests). */
export async function revokePermissionFromRole(
  handle: DbHandle,
  input: { tenantId: string; actingUserId: string; roleId: string; permissionKey: string },
): Promise<void> {
  await withTenantContext(
    handle,
    { tenantId: input.tenantId, userId: input.actingUserId },
    async (tx) => {
      const [perm] = await tx
        .select({ id: permissions.id })
        .from(permissions)
        .where(eq(permissions.key, input.permissionKey));
      if (perm) {
        await tx
          .delete(rolePermissions)
          .where(
            sql`${rolePermissions.roleId} = ${input.roleId} and ${rolePermissions.permissionId} = ${perm.id}`,
          );
      }
    },
  );
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const handle = createDb({ poolMax: 1 });
  seedPermissions(handle)
    .then((n) => {
      console.warn(`[db] seeded ${n} permission catalogue entries`);
      return handle.close();
    })
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('[db] seed failed:', err);
      process.exit(1);
    });
}
