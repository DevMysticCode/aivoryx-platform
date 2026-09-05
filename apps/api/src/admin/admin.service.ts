import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { PERMISSION_DEFINITIONS } from '@aivoryx/shared';
import type { AdminRoleDto, CataloguePermissionDto } from './admin.dto.js';

const { permissions, rolePermissions, roles } = schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
}

/**
 * Role & catalogue reads for the tenant-admin surface. Runs inside
 * `withTenantContext`, so RLS scopes `roles` / `role_permissions` to the active
 * tenant — a role from another tenant is invisible.
 */
@Injectable()
export class AdminService {
  async listRoles(scope: TenantScope): Promise<AdminRoleDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({
          id: roles.id,
          key: roles.key,
          name: roles.name,
          description: roles.description,
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
          entry = {
            id: row.id,
            key: row.key,
            name: row.name,
            description: row.description,
            permissionKeys: [],
          };
          byId.set(row.id, entry);
        }
        if (row.permissionKey && !entry.permissionKeys.includes(row.permissionKey)) {
          entry.permissionKeys.push(row.permissionKey);
        }
      }
      for (const entry of byId.values()) entry.permissionKeys.sort();
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
