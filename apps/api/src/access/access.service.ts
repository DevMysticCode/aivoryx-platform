import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, newUuidV7, schema, withTenantContext, type Tx, type DataScope } from '@aivoryx/db';
import {
  AppError,
  MODULE_DEFINITIONS,
  PERMISSION_KEYS,
  describePermission,
  moduleForPermission,
  type ModuleKey,
} from '@aivoryx/shared';
import { AuditService, userActor } from '../audit/audit.service.js';
import { EntitlementService } from '../entitlements/entitlement.service.js';

const { membershipRoles, permissions, rolePermissions, roles, userTenantMemberships, users } =
  schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
  actorMembershipId: string;
}

type RoleKindConfigurable = 'profile' | 'permission_set';

export interface AccessRoleDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  kind: RoleKindConfigurable;
  permissionKeys: string[];
  /** how many memberships hold this role */
  assignedCount: number;
}

export interface EffectiveModuleAccessDto {
  moduleKey: ModuleKey;
  displayName: string;
  entitled: boolean;
  dataScope: DataScope | null;
  permissions: {
    key: string;
    resource: string;
    action: string;
    description: string;
    granted: boolean;
  }[];
}

export interface EffectiveAccessDto {
  membershipId: string;
  userName: string | null;
  userEmail: string;
  profile: { id: string; name: string; dataScope: DataScope } | null;
  permissionSets: { id: string; name: string }[];
  modules: EffectiveModuleAccessDto[];
  /** platform/identity permissions the member holds (module = none) */
  platformPermissions: string[];
}

/**
 * Tenant-side access configuration (Phase 13, ADR 0042). Profiles and permission
 * sets are `roles` rows with a `kind` — there is NO second authorization model.
 * A tenant may only put permissions belonging to an ENTITLED module (or a
 * platform permission) into a profile/permission set; the effective-access
 * summary always intersects a member's granted permissions with the tenant's
 * module entitlements, so entitlement always precedes permission.
 *
 * Runs inside `withTenantContext`, so RLS scopes every read/write to the active
 * tenant. Depends only on `@aivoryx/db`, `@aivoryx/shared`, `AuditService` and
 * the platform `EntitlementService` — never a business module.
 */
@Injectable()
export class AccessService {
  constructor(
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementService,
  ) {}

  // ---- catalogue (entitlement-filtered) ---------------------------

  /** The permissions a tenant may configure: platform permissions + every
   *  permission of an entitled module. */
  async availablePermissions(scope: TenantScope): Promise<
    {
      key: string;
      module: ModuleKey | null;
      resource: string;
      action: string;
      description: string;
    }[]
  > {
    const entitled = await this.entitlements.getEnabledModules(scope);
    return PERMISSION_KEYS.filter((k) => {
      const m = moduleForPermission(k);
      return m === null || entitled.has(m);
    }).map((k) => {
      const d = describePermission(k);
      return { ...d, module: moduleForPermission(k) };
    });
  }

  // ---- profiles & permission sets --------------------------------

  listRoles(scope: TenantScope, kind: RoleKindConfigurable): Promise<AccessRoleDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({
          id: roles.id,
          key: roles.key,
          name: roles.name,
          description: roles.description,
          kind: roles.kind,
          permissionKey: permissions.key,
        })
        .from(roles)
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(and(eq(roles.tenantId, scope.tenantId), eq(roles.kind, kind)));

      const counts = await tx
        .select({ roleId: membershipRoles.roleId })
        .from(membershipRoles)
        .where(eq(membershipRoles.tenantId, scope.tenantId));
      const countByRole = new Map<string, number>();
      for (const c of counts) countByRole.set(c.roleId, (countByRole.get(c.roleId) ?? 0) + 1);

      const byId = new Map<string, AccessRoleDto>();
      for (const r of rows) {
        let e = byId.get(r.id);
        if (!e) {
          e = {
            id: r.id,
            key: r.key,
            name: r.name,
            description: r.description,
            kind: r.kind as RoleKindConfigurable,
            permissionKeys: [],
            assignedCount: countByRole.get(r.id) ?? 0,
          };
          byId.set(r.id, e);
        }
        if (r.permissionKey) e.permissionKeys.push(r.permissionKey);
      }
      return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async createRole(
    scope: TenantScope,
    input: {
      kind: RoleKindConfigurable;
      name: string;
      description?: string | null;
      permissionKeys: string[];
    },
  ): Promise<AccessRoleDto> {
    await this.assertPermissionsAvailable(scope, input.permissionKeys);
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      const key = await this.uniqueKey(tx, scope.tenantId, input.name);
      const [role] = await tx
        .insert(roles)
        .values({
          id: newUuidV7(),
          tenantId: scope.tenantId,
          key,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          kind: input.kind,
        })
        .returning({ id: roles.id });
      const roleId = role!.id;
      await this.setRolePermissions(tx, scope.tenantId, roleId, input.permissionKeys);
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'identity.role.created',
        entityType: 'role',
        entityId: roleId,
        actor: userActor(scope),
        metadata: {
          kind: input.kind,
          name: input.name,
          permissionCount: input.permissionKeys.length,
        },
      });
      return roleId;
    });
    return this.getRole(scope, id);
  }

  async updateRole(
    scope: TenantScope,
    roleId: string,
    input: { name?: string; description?: string | null; permissionKeys?: string[] },
  ): Promise<AccessRoleDto> {
    if (input.permissionKeys) await this.assertPermissionsAvailable(scope, input.permissionKeys);
    await withTenantContext(getDb(), scope, async (tx) => {
      const role = await this.requireConfigurableRole(tx, scope.tenantId, roleId);
      await tx
        .update(roles)
        .set({
          name: input.name?.trim() ?? role.name,
          description:
            input.description === undefined ? role.description : input.description?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(roles.id, roleId));
      if (input.permissionKeys) {
        await this.setRolePermissions(tx, scope.tenantId, roleId, input.permissionKeys);
      }
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'identity.role.updated',
        entityType: 'role',
        entityId: roleId,
        actor: userActor(scope),
        metadata: { name: input.name ?? role.name },
      });
    });
    return this.getRole(scope, roleId);
  }

  async deleteRole(scope: TenantScope, roleId: string): Promise<void> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await this.requireConfigurableRole(tx, scope.tenantId, roleId);
      const [inUse] = await tx
        .select({ roleId: membershipRoles.roleId })
        .from(membershipRoles)
        .where(eq(membershipRoles.roleId, roleId))
        .limit(1);
      if (inUse) throw new AppError('ACCESS_PROFILE_IN_USE');
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      await tx.delete(roles).where(eq(roles.id, roleId));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'identity.role.deleted',
        entityType: 'role',
        entityId: roleId,
        actor: userActor(scope),
      });
    });
  }

  // ---- member assignments ---------------------------------------

  async assignProfile(
    scope: TenantScope,
    membershipId: string,
    roleId: string,
    scopeValue: DataScope,
  ): Promise<EffectiveAccessDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await this.requireMembership(tx, scope.tenantId, membershipId);
      const role = await this.requireConfigurableRole(tx, scope.tenantId, roleId);
      if (role.kind !== 'profile') throw new AppError('ACCESS_ROLE_KIND_INVALID');

      // one profile per member: drop any existing profile-kind assignment
      const existingProfiles = await tx
        .select({ roleId: membershipRoles.roleId })
        .from(membershipRoles)
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
        .where(and(eq(membershipRoles.membershipId, membershipId), eq(roles.kind, 'profile')));
      if (existingProfiles.length > 0) {
        await tx.delete(membershipRoles).where(
          and(
            eq(membershipRoles.membershipId, membershipId),
            inArray(
              membershipRoles.roleId,
              existingProfiles.map((p) => p.roleId),
            ),
          ),
        );
      }
      await tx
        .insert(membershipRoles)
        .values({ membershipId, roleId, tenantId: scope.tenantId, dataScope: scopeValue })
        .onConflictDoUpdate({
          target: [membershipRoles.membershipId, membershipRoles.roleId],
          set: { dataScope: scopeValue },
        });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'tenant.member.profile_assigned',
        entityType: 'membership',
        entityId: membershipId,
        actor: userActor(scope),
        metadata: { profile: role.name, dataScope: scopeValue },
      });
    });
    return this.effectiveAccess(scope, membershipId);
  }

  async addPermissionSet(
    scope: TenantScope,
    membershipId: string,
    roleId: string,
  ): Promise<EffectiveAccessDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await this.requireMembership(tx, scope.tenantId, membershipId);
      const role = await this.requireConfigurableRole(tx, scope.tenantId, roleId);
      if (role.kind !== 'permission_set') throw new AppError('ACCESS_ROLE_KIND_INVALID');
      await tx
        .insert(membershipRoles)
        .values({ membershipId, roleId, tenantId: scope.tenantId })
        .onConflictDoNothing();
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'tenant.member.role_added',
        entityType: 'membership',
        entityId: membershipId,
        actor: userActor(scope),
        metadata: { permissionSet: role.name },
      });
    });
    return this.effectiveAccess(scope, membershipId);
  }

  async removePermissionSet(
    scope: TenantScope,
    membershipId: string,
    roleId: string,
  ): Promise<EffectiveAccessDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const role = await this.requireConfigurableRole(tx, scope.tenantId, roleId);
      await tx
        .delete(membershipRoles)
        .where(
          and(eq(membershipRoles.membershipId, membershipId), eq(membershipRoles.roleId, roleId)),
        );
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'tenant.member.role_removed',
        entityType: 'membership',
        entityId: membershipId,
        actor: userActor(scope),
        metadata: { permissionSet: role.name },
      });
    });
    return this.effectiveAccess(scope, membershipId);
  }

  // ---- effective access ----------------------------------------

  async effectiveAccess(scope: TenantScope, membershipId: string): Promise<EffectiveAccessDto> {
    const entitled = await this.entitlements.getEnabledModules(scope);
    return withTenantContext(getDb(), scope, async (tx) => {
      const [member] = await tx
        .select({ id: userTenantMemberships.id, email: users.email, name: users.name })
        .from(userTenantMemberships)
        .innerJoin(users, eq(users.id, userTenantMemberships.userId))
        .where(eq(userTenantMemberships.id, membershipId))
        .limit(1);
      if (!member) throw new AppError('AUTH_MEMBERSHIP_INVALID');

      const assigned = await tx
        .select({
          roleId: roles.id,
          roleName: roles.name,
          kind: roles.kind,
          dataScope: membershipRoles.dataScope,
          permissionKey: permissions.key,
        })
        .from(membershipRoles)
        .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(membershipRoles.membershipId, membershipId));

      const grantedRaw = new Set<string>();
      let profile: { id: string; name: string; dataScope: DataScope } | null = null;
      const permissionSets = new Map<string, string>();
      for (const row of assigned) {
        if (row.permissionKey) grantedRaw.add(row.permissionKey);
        if (row.kind === 'profile') {
          profile = { id: row.roleId, name: row.roleName, dataScope: row.dataScope };
        } else if (row.kind === 'permission_set') {
          permissionSets.set(row.roleId, row.roleName);
        }
      }

      // effective = granted ∩ (platform permission OR entitled module)
      const effective = new Set(
        [...grantedRaw].filter((k) => {
          const m = moduleForPermission(k);
          return m === null || entitled.has(m);
        }),
      );

      const modules: EffectiveModuleAccessDto[] = MODULE_DEFINITIONS.map((m) => {
        const modPerms = PERMISSION_KEYS.filter((k) => moduleForPermission(k) === m.key);
        const isEntitled = entitled.has(m.key);
        return {
          moduleKey: m.key,
          displayName: m.displayName,
          entitled: isEntitled,
          dataScope: isEntitled ? (profile?.dataScope ?? 'COMPANY') : null,
          permissions: modPerms.map((k) => {
            const d = describePermission(k);
            return { ...d, granted: isEntitled && effective.has(k) };
          }),
        };
      });

      const platformPermissions = [...effective]
        .filter((k) => moduleForPermission(k) === null)
        .sort();

      return {
        membershipId,
        userName: member.name ?? null,
        userEmail: member.email,
        profile,
        permissionSets: [...permissionSets.entries()].map(([id, name]) => ({ id, name })),
        modules,
        platformPermissions,
      };
    });
  }

  // ---- internals ---------------------------------------------

  private getRole(scope: TenantScope, roleId: string): Promise<AccessRoleDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({
          id: roles.id,
          key: roles.key,
          name: roles.name,
          description: roles.description,
          kind: roles.kind,
          permissionKey: permissions.key,
        })
        .from(roles)
        .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
        .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
        .where(eq(roles.id, roleId));
      if (rows.length === 0) throw new AppError('ACCESS_PROFILE_NOT_FOUND');
      const first = rows[0]!;
      return {
        id: first.id,
        key: first.key,
        name: first.name,
        description: first.description,
        kind: first.kind as RoleKindConfigurable,
        permissionKeys: rows.map((r) => r.permissionKey).filter((k): k is string => !!k),
        assignedCount: 0,
      };
    });
  }

  private async assertPermissionsAvailable(scope: TenantScope, keys: string[]): Promise<void> {
    const entitled = await this.entitlements.getEnabledModules(scope);
    for (const k of keys) {
      const m = moduleForPermission(k);
      if (m !== null && !entitled.has(m)) {
        throw new AppError('ACCESS_PERMISSION_NOT_AVAILABLE', {
          details: { permission: k, module: m },
        });
      }
    }
  }

  private async setRolePermissions(
    tx: Tx,
    tenantId: string,
    roleId: string,
    keys: string[],
  ): Promise<void> {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    if (keys.length === 0) return;
    const rows = await tx
      .select({ id: permissions.id })
      .from(permissions)
      .where(inArray(permissions.key, [...new Set(keys)]));
    if (rows.length > 0) {
      await tx
        .insert(rolePermissions)
        .values(rows.map((p) => ({ roleId, tenantId, permissionId: p.id })))
        .onConflictDoNothing();
    }
  }

  private async requireConfigurableRole(
    tx: Tx,
    tenantId: string,
    roleId: string,
  ): Promise<{ id: string; name: string; description: string | null; kind: string }> {
    const [role] = await tx
      .select({ id: roles.id, name: roles.name, description: roles.description, kind: roles.kind })
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId)))
      .limit(1);
    if (!role) throw new AppError('ACCESS_PROFILE_NOT_FOUND');
    if (role.kind !== 'profile' && role.kind !== 'permission_set') {
      throw new AppError('ACCESS_ROLE_KIND_INVALID');
    }
    return role;
  }

  private async requireMembership(tx: Tx, tenantId: string, membershipId: string): Promise<void> {
    const [m] = await tx
      .select({ id: userTenantMemberships.id })
      .from(userTenantMemberships)
      .where(
        and(
          eq(userTenantMemberships.id, membershipId),
          eq(userTenantMemberships.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!m) throw new AppError('AUTH_MEMBERSHIP_INVALID');
  }

  private async uniqueKey(tx: Tx, tenantId: string, name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'role';
    for (let i = 0; i < 50; i += 1) {
      const key = i === 0 ? base : `${base}_${i + 1}`;
      const [clash] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, tenantId), eq(roles.key, key)))
        .limit(1);
      if (!clash) return key;
    }
    return `${base}_${newUuidV7().slice(0, 8)}`;
  }
}
