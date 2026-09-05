import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';
import { PLATFORM_ROLE_KEYS } from '@aivoryx/shared';

const { membershipRoles, roles, tenantInvitations, userTenantMemberships, users } = schema;

export interface MemberRoleView {
  key: string;
  name: string;
}

export interface MemberView {
  membershipId: string;
  userId: string;
  email: string;
  name: string | null;
  status: 'active' | 'suspended' | 'invited';
  roles: MemberRoleView[];
  joinedAt: string;
  invitationPending: boolean;
}

/** Find a role by its key within a tenant (RLS already scopes `roles`). */
export async function findRoleByKey(
  tx: Tx,
  tenantId: string,
  key: string,
): Promise<{ id: string; key: string; name: string } | undefined> {
  const [row] = await tx
    .select({ id: roles.id, key: roles.key, name: roles.name })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.key, key)))
    .limit(1);
  return row;
}

/**
 * How many memberships in this tenant are BOTH `active` AND hold the
 * `TENANT_ADMIN` role — optionally excluding one membership (the one about to
 * change). Used to protect the last usable administrator.
 */
export async function countUsableTenantAdmins(
  tx: Tx,
  tenantId: string,
  excludeMembershipId?: string,
): Promise<number> {
  const conditions = [
    eq(userTenantMemberships.tenantId, tenantId),
    eq(userTenantMemberships.status, 'active'),
    eq(roles.key, PLATFORM_ROLE_KEYS.tenantAdmin),
  ];
  if (excludeMembershipId) {
    conditions.push(sql`${userTenantMemberships.id} <> ${excludeMembershipId}`);
  }
  const [row] = await tx
    .select({ n: sql<number>`count(distinct ${userTenantMemberships.id})::int` })
    .from(userTenantMemberships)
    .innerJoin(membershipRoles, eq(membershipRoles.membershipId, userTenantMemberships.id))
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(and(...conditions));
  return row?.n ?? 0;
}

/** The role keys a membership currently holds. */
export async function getMembershipRoleKeys(tx: Tx, membershipId: string): Promise<string[]> {
  const rows = await tx
    .select({ key: roles.key })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(eq(membershipRoles.membershipId, membershipId));
  return rows.map((r) => r.key);
}

function assembleMembers(
  rows: Array<{
    membershipId: string;
    userId: string;
    email: string;
    name: string | null;
    status: 'active' | 'suspended' | 'invited';
    joinedAt: Date;
    roleKey: string | null;
    roleName: string | null;
    pendingInvitationId: string | null;
  }>,
): MemberView[] {
  const byId = new Map<string, MemberView>();
  for (const row of rows) {
    let entry = byId.get(row.membershipId);
    if (!entry) {
      entry = {
        membershipId: row.membershipId,
        userId: row.userId,
        email: row.email,
        name: row.name,
        status: row.status,
        roles: [],
        joinedAt: row.joinedAt.toISOString(),
        invitationPending: row.pendingInvitationId !== null,
      };
      byId.set(row.membershipId, entry);
    }
    if (row.roleKey && !entry.roles.some((r) => r.key === row.roleKey)) {
      entry.roles.push({ key: row.roleKey, name: row.roleName ?? row.roleKey });
    }
  }
  return [...byId.values()];
}

const memberSelect = {
  membershipId: userTenantMemberships.id,
  userId: userTenantMemberships.userId,
  email: users.email,
  name: users.name,
  status: userTenantMemberships.status,
  joinedAt: userTenantMemberships.createdAt,
  roleKey: roles.key,
  roleName: roles.name,
  pendingInvitationId: tenantInvitations.id,
} as const;

const pendingInvitationJoin = and(
  eq(tenantInvitations.membershipId, userTenantMemberships.id),
  eq(tenantInvitations.status, 'pending'),
);

/** Every member of a tenant with roles + pending-invitation flag. */
export async function loadMemberViews(tx: Tx, tenantId: string): Promise<MemberView[]> {
  const rows = await tx
    .select(memberSelect)
    .from(userTenantMemberships)
    .innerJoin(users, eq(users.id, userTenantMemberships.userId))
    .leftJoin(membershipRoles, eq(membershipRoles.membershipId, userTenantMemberships.id))
    .leftJoin(roles, eq(roles.id, membershipRoles.roleId))
    .leftJoin(tenantInvitations, pendingInvitationJoin)
    .where(eq(userTenantMemberships.tenantId, tenantId));
  return assembleMembers(rows);
}

/** A single member, or undefined (RLS + the explicit tenant filter both scope it). */
export async function loadMemberView(
  tx: Tx,
  tenantId: string,
  membershipId: string,
): Promise<MemberView | undefined> {
  const rows = await tx
    .select(memberSelect)
    .from(userTenantMemberships)
    .innerJoin(users, eq(users.id, userTenantMemberships.userId))
    .leftJoin(membershipRoles, eq(membershipRoles.membershipId, userTenantMemberships.id))
    .leftJoin(roles, eq(roles.id, membershipRoles.roleId))
    .leftJoin(tenantInvitations, pendingInvitationJoin)
    .where(
      and(eq(userTenantMemberships.tenantId, tenantId), eq(userTenantMemberships.id, membershipId)),
    );
  return assembleMembers(rows)[0];
}

/** Resolve a set of role keys to their ids in the tenant, or the first missing key. */
export async function resolveRoleKeys(
  tx: Tx,
  tenantId: string,
  keys: string[],
): Promise<{ ids: Array<{ id: string; key: string }>; missing?: string }> {
  if (keys.length === 0) return { ids: [] };
  const found = await tx
    .select({ id: roles.id, key: roles.key })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), inArray(roles.key, keys)));
  const foundKeys = new Set(found.map((r) => r.key));
  const missing = keys.find((k) => !foundKeys.has(k));
  return { ids: found, missing };
}
