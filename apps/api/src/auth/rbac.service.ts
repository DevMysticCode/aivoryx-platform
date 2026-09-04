import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';

const { membershipRoles, permissions, rolePermissions, roles } = schema;

export interface MembershipRoleSummary {
  key: string;
  name: string;
  permissions: string[];
}

/**
 * RBAC resolution (ADR 0029). Reads run inside a tenant-context transaction, so
 * Row Level Security scopes `membership_roles` / `role_permissions` / `roles` to
 * the active tenant automatically — a role or grant from another tenant is
 * simply invisible and cannot authorize anything.
 */
@Injectable()
export class RbacService {
  /** The set of permission keys granted to a membership through its roles. */
  async permissionsForMembership(input: {
    membershipId: string;
    tenantId: string;
    userId: string;
  }): Promise<Set<string>> {
    const rows = await withTenantContext(
      getDb(),
      { tenantId: input.tenantId, userId: input.userId },
      (tx) =>
        tx
          .select({ key: permissions.key })
          .from(membershipRoles)
          .innerJoin(rolePermissions, eq(rolePermissions.roleId, membershipRoles.roleId))
          .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
          .where(eq(membershipRoles.membershipId, input.membershipId)),
    );
    return new Set(rows.map((r) => r.key));
  }

  /** Roles (with their permission keys) assigned to a membership. */
  async rolesForMembership(input: {
    membershipId: string;
    tenantId: string;
    userId: string;
  }): Promise<MembershipRoleSummary[]> {
    const rows = await withTenantContext(
      getDb(),
      { tenantId: input.tenantId, userId: input.userId },
      (tx) =>
        tx
          .select({
            roleKey: roles.key,
            roleName: roles.name,
            permissionKey: permissions.key,
          })
          .from(membershipRoles)
          .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
          .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
          .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
          .where(eq(membershipRoles.membershipId, input.membershipId)),
    );

    const byRole = new Map<string, MembershipRoleSummary>();
    for (const row of rows) {
      let entry = byRole.get(row.roleKey);
      if (!entry) {
        entry = { key: row.roleKey, name: row.roleName, permissions: [] };
        byRole.set(row.roleKey, entry);
      }
      if (row.permissionKey) entry.permissions.push(row.permissionKey);
    }
    return [...byRole.values()];
  }
}
