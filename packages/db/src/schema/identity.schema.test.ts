import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  membershipRoles,
  permissions,
  rolePermissions,
  roles,
  sessions,
  tenants,
  userTenantMemberships,
  users,
} from './index.js';

/**
 * Structural assertions on the identity/tenancy/RBAC schema. Pure (no database):
 * runs everywhere, including CI, and locks in the constraints that authentication
 * and authorization will rely on (ADR 0026). Behavioural checks against a live
 * PostgreSQL are in `identity.constraints.test.ts`.
 */

const cfg = (t: Parameters<typeof getTableConfig>[0]) => getTableConfig(t);
const colNames = (t: Parameters<typeof getTableConfig>[0]) =>
  cfg(t)
    .columns.map((c) => c.name)
    .sort();
const fk = (t: Parameters<typeof getTableConfig>[0], name: string) => {
  const found = cfg(t).foreignKeys.find((f) => f.getName() === name);
  if (!found) throw new Error(`no FK ${name} on ${cfg(t).name}`);
  const ref = found.reference();
  return {
    columns: ref.columns.map((c) => c.name),
    foreignColumns: ref.foreignColumns.map((c) => c.name),
    onDelete: found.onDelete,
  };
};
const hasIndex = (t: Parameters<typeof getTableConfig>[0], name: string) =>
  cfg(t).indexes.some((i) => i.config.name === name);
const uniqueNames = (t: Parameters<typeof getTableConfig>[0]) =>
  cfg(t).uniqueConstraints.map((u) => u.name);

describe('identity schema — table set', () => {
  it('defines exactly the eight Task-1 tables', () => {
    expect(
      [
        tenants,
        users,
        userTenantMemberships,
        sessions,
        roles,
        permissions,
        rolePermissions,
        membershipRoles,
      ].map((t) => cfg(t).name),
    ).toEqual([
      'tenants',
      'users',
      'user_tenant_memberships',
      'sessions',
      'roles',
      'permissions',
      'role_permissions',
      'membership_roles',
    ]);
  });
});

describe('users', () => {
  it('has identity + Argon2id-ready password columns and no tenant_id', () => {
    expect(colNames(users)).toEqual([
      'created_at',
      'email',
      'email_verified_at',
      'id',
      'name',
      'password_hash',
      'password_updated_at',
      'status',
      'updated_at',
    ]);
  });

  it('email column is nullable-free but password_hash is nullable (pre-set users)', () => {
    const cols = Object.fromEntries(cfg(users).columns.map((c) => [c.name, c]));
    expect(cols.email.notNull).toBe(true);
    expect(cols.password_hash.notNull).toBe(false);
  });

  it('enforces case-insensitive unique email via a lower(email) unique index', () => {
    const idx = cfg(users).indexes.find((i) => i.config.name === 'users_email_lower_uq');
    expect(idx?.config.unique).toBe(true);
  });
});

describe('tenants', () => {
  it('has a unique slug and a status, and is not tenant-owned', () => {
    expect(colNames(tenants)).toEqual(['created_at', 'id', 'name', 'slug', 'status', 'updated_at']);
    expect(
      cfg(tenants).indexes.some((i) => i.config.name === 'tenants_slug_uq' && i.config.unique),
    ).toBe(true);
  });
});

describe('user_tenant_memberships', () => {
  it('links user + tenant (not a tenant_id on users)', () => {
    expect(colNames(userTenantMemberships)).toEqual([
      'created_at',
      'id',
      'status',
      'tenant_id',
      'updated_at',
      'user_id',
    ]);
  });

  it('one membership per (user, tenant)', () => {
    expect(uniqueNames(userTenantMemberships)).toContain('user_tenant_memberships_user_tenant_uq');
  });

  it('exposes (id, tenant_id) and (user_id, id) as composite FK targets', () => {
    expect(uniqueNames(userTenantMemberships)).toEqual(
      expect.arrayContaining([
        'user_tenant_memberships_id_tenant_uq',
        'user_tenant_memberships_user_id_id_uq',
      ]),
    );
  });

  it('cascades from user and tenant, and is indexed both ways', () => {
    expect(fk(userTenantMemberships, 'user_tenant_memberships_user_id_users_id_fk').onDelete).toBe(
      'cascade',
    );
    expect(
      fk(userTenantMemberships, 'user_tenant_memberships_tenant_id_tenants_id_fk').onDelete,
    ).toBe('cascade');
    expect(hasIndex(userTenantMemberships, 'user_tenant_memberships_tenant_idx')).toBe(true);
    expect(hasIndex(userTenantMemberships, 'user_tenant_memberships_user_idx')).toBe(true);
  });
});

describe('sessions', () => {
  it('belongs to a user, stores a token hash, references one active membership, has expiry + revocation', () => {
    expect(colNames(sessions)).toEqual([
      'active_membership_id',
      'created_at',
      'expires_at',
      'id',
      'ip',
      'last_seen_at',
      'revoked_at',
      'token_hash',
      'user_agent',
      'user_id',
    ]);
  });

  it('active_membership_id is nullable (a session may have no tenant selected)', () => {
    const col = cfg(sessions).columns.find((c) => c.name === 'active_membership_id');
    expect(col?.notNull).toBe(false);
  });

  it('token_hash is unique and user_id + expires_at + active_membership_id are indexed', () => {
    expect(
      cfg(sessions).indexes.some(
        (i) => i.config.name === 'sessions_token_hash_uq' && i.config.unique,
      ),
    ).toBe(true);
    expect(hasIndex(sessions, 'sessions_user_idx')).toBe(true);
    expect(hasIndex(sessions, 'sessions_expires_at_idx')).toBe(true);
    expect(hasIndex(sessions, 'sessions_active_membership_idx')).toBe(true);
  });

  it('is deleted with its user', () => {
    expect(fk(sessions, 'sessions_user_id_users_id_fk').onDelete).toBe('cascade');
  });

  it('binds the active membership to the session user via a composite FK', () => {
    expect(fk(sessions, 'sessions_active_membership_fk')).toMatchObject({
      columns: ['user_id', 'active_membership_id'],
      foreignColumns: ['user_id', 'id'],
      onDelete: 'cascade',
    });
  });
});

describe('roles + permissions', () => {
  it('roles are per-tenant with a tenant-unique key', () => {
    expect(colNames(roles)).toEqual([
      'created_at',
      'description',
      'id',
      'key',
      'kind', // Phase 13 (ADR 0042): 'profile' | 'permission_set' | 'custom'
      'name',
      'tenant_id',
      'updated_at',
    ]);
    expect(uniqueNames(roles)).toEqual(
      expect.arrayContaining(['roles_tenant_key_uq', 'roles_id_tenant_uq']),
    );
  });

  it('permissions are a global catalogue keyed by a unique string', () => {
    expect(colNames(permissions)).toEqual(['created_at', 'description', 'id', 'key', 'updated_at']);
    expect(uniqueNames(permissions)).toContain('permissions_key_uq');
  });
});

describe('role_permissions', () => {
  it('is a composite-PK join with a denormalised tenant_id', () => {
    expect(colNames(rolePermissions)).toEqual([
      'created_at',
      'permission_id',
      'role_id',
      'tenant_id',
    ]);
    expect(cfg(rolePermissions).primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
      'role_id',
      'permission_id',
    ]);
  });

  it('(role_id, tenant_id) FK cascades from roles; permission_id FK restricts', () => {
    expect(fk(rolePermissions, 'role_permissions_role_fk')).toMatchObject({
      columns: ['role_id', 'tenant_id'],
      foreignColumns: ['id', 'tenant_id'],
      onDelete: 'cascade',
    });
    expect(fk(rolePermissions, 'role_permissions_permission_id_permissions_id_fk').onDelete).toBe(
      'restrict',
    );
  });
});

describe('membership_roles', () => {
  it('is a composite-PK join carrying tenant_id for cross-tenant integrity', () => {
    expect(colNames(membershipRoles)).toEqual([
      'created_at',
      'data_scope', // Phase 13 (ADR 0042): OWN | TEAM | DEPARTMENT | COMPANY
      'membership_id',
      'role_id',
      'tenant_id',
    ]);
    expect(cfg(membershipRoles).primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
      'membership_id',
      'role_id',
    ]);
  });

  it('both FKs are composite on tenant_id so a membership and its role share a tenant', () => {
    expect(fk(membershipRoles, 'membership_roles_membership_fk')).toMatchObject({
      columns: ['membership_id', 'tenant_id'],
      foreignColumns: ['id', 'tenant_id'],
      onDelete: 'cascade',
    });
    expect(fk(membershipRoles, 'membership_roles_role_fk')).toMatchObject({
      columns: ['role_id', 'tenant_id'],
      foreignColumns: ['id', 'tenant_id'],
      onDelete: 'restrict',
    });
  });
});
