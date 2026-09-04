import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { PERMISSION_DEFINITIONS } from '@aivoryx/shared';
import type { AdminMembershipDto, AdminRoleDto, CataloguePermissionDto } from './admin.dto.js';

const { membershipRoles, permissions, rolePermissions, roles, userTenantMemberships, users } =
  schema;

interface TenantScope {
  tenantId: string;
  userId: string;
}

/**
 * Thin read surface over the security tables, used to exercise the guard + RLS
 * end to end. Every query runs inside a tenant-context transaction, so Row
 * Level Security is the isolation boundary; the explicit `tenant_id` filters are
 * belt-and-braces correctness, not the security mechanism (TENANCY.md).
 */
@Injectable()
export class AdminService {
  async listMemberships(scope: TenantScope): Promise<AdminMembershipDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({
          id: userTenantMemberships.id,
          userId: userTenantMemberships.userId,
          userEmail: users.email,
          status: userTenantMemberships.status,
          roleKey: roles.key,
        })
        .from(userTenantMemberships)
        .innerJoin(users, eq(users.id, userTenantMemberships.userId))
        .leftJoin(membershipRoles, eq(membershipRoles.membershipId, userTenantMemberships.id))
        .leftJoin(roles, eq(roles.id, membershipRoles.roleId))
        .where(eq(userTenantMemberships.tenantId, scope.tenantId));

      const byId = new Map<string, AdminMembershipDto>();
      for (const row of rows) {
        let entry = byId.get(row.id);
        if (!entry) {
          entry = {
            id: row.id,
            userId: row.userId,
            userEmail: row.userEmail,
            status: row.status,
            roleKeys: [],
          };
          byId.set(row.id, entry);
        }
        if (row.roleKey && !entry.roleKeys.includes(row.roleKey)) entry.roleKeys.push(row.roleKey);
      }
      return [...byId.values()];
    });
  }

  async listRoles(scope: TenantScope): Promise<AdminRoleDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({
          id: roles.id,
          key: roles.key,
          name: roles.name,
          permissionKey: permissions.key,
        })
        .from(roles)
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(roles.tenantId, scope.tenantId));

      const byId = new Map<string, AdminRoleDto>();
      for (const row of rows) {
        let entry = byId.get(row.id);
        if (!entry) {
          entry = { id: row.id, key: row.key, name: row.name, permissionKeys: [] };
          byId.set(row.id, entry);
        }
        if (row.permissionKey && !entry.permissionKeys.includes(row.permissionKey)) {
          entry.permissionKeys.push(row.permissionKey);
        }
      }
      return [...byId.values()];
    });
  }

  /** The global catalogue — read straight from the shared source of truth. */
  listCataloguePermissions(): CataloguePermissionDto[] {
    return PERMISSION_DEFINITIONS.map((p) => ({ key: p.key, description: p.description }));
  }

  /** Count a role's permissions inside a tenant — used by a cross-tenant RLS test. */
  async countRolePermissions(scope: TenantScope, roleId: string): Promise<number> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({ permissionId: rolePermissions.permissionId })
        .from(rolePermissions)
        .where(
          and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.tenantId, scope.tenantId)),
        );
      return rows.length;
    });
  }
}
