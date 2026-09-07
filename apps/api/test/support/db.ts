import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { hash as argon2Hash } from '@node-rs/argon2';
import { ensureIntegrationEnv } from './env.js';

/**
 * Integration DB support: reset + migrate + seed, and a fixture factory that
 * builds two tenants with users/memberships/roles for the security specs.
 *
 * All `@aivoryx/db` imports are dynamic so a CI run that skips the integration
 * suites never touches a database.
 */

const ALGORITHM_ARGON2ID = 2;

/** Drop and recreate the schema, run every migration, seed the permission catalogue. */
export async function resetDatabase(): Promise<void> {
  ensureIntegrationEnv();
  const db = await import('@aivoryx/db');
  await db.closeDb();

  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await admin.query('drop schema if exists public cascade');
    await admin.query('drop schema if exists drizzle cascade');
    await admin.query('create schema public');
  } finally {
    await admin.end();
  }

  await db.runMigrations();
  const handle = db.createDb({ poolMax: 1 });
  try {
    await db.seedPermissions(handle);
  } finally {
    await handle.close();
  }
}

export interface UserFixture {
  userId: string;
  email: string;
  password: string;
  membershipId: string;
}

export interface Fixtures {
  tenantA: string;
  tenantB: string;
  /** TENANT_ADMIN in A; also a role-less member of B */
  admin: UserFixture & { membershipIdInB: string };
  /** a SECOND TENANT_ADMIN in A — lets last-admin tests suspend/remove `admin` safely */
  secondAdmin: UserFixture;
  /** a member of A with no roles — safe target for suspend/remove/role tests */
  plainMember: UserFixture;
  /** only `memberships.read` in A */
  limited: UserFixture;
  /** TENANT_ADMIN in B */
  adminB: UserFixture;
  /** authenticates, but has no membership anywhere */
  noMembership: { userId: string; email: string; password: string };
  /** membership in A is suspended */
  suspended: UserFixture;
  /** membership in a suspended tenant */
  inSuspendedTenant: UserFixture;
  tenantAdminRoleA: string;
  tenantAdminRoleB: string;
  membersOnlyRoleA: string;
}

function uuid(): string {
  return randomUUID();
}

async function pw(): Promise<{ plain: string; hash: string }> {
  const plain = `Pw-${uuid()}`;
  const hash = await argon2Hash(plain, { algorithm: ALGORITHM_ARGON2ID });
  return { plain, hash };
}

/** Build a fresh fixture set. Assumes `resetDatabase()` has run. */
export async function makeFixtures(): Promise<Fixtures> {
  const db = await import('@aivoryx/db');
  const { MODULE_KEYS } = await import('@aivoryx/shared');
  // The shared fixtures deliberately entitle tenant A and tenant B to EVERY
  // module — the pre-Phase-13 business suites (CRM/Field/Supply/…/HR) assume it.
  // This is stated explicitly rather than left to a provisioning default; a
  // spec that needs a "not entitled" state uses `setTenantModules` /
  // `disableModule` / `createTenantWithModules` from this file (ADR 0042).
  const allModules = [...MODULE_KEYS];
  // Owner/superuser handle for setup — RLS is bypassed only for seeding.
  const handle = db.createDb({ poolMax: 3 });
  const c = await handle.pool.connect();
  try {
    const tenantA = uuid();
    const tenantB = uuid();
    const tenantSuspended = uuid();
    await c.query('insert into tenants (id, slug, name) values ($1,$2,$3),($4,$5,$6),($7,$8,$9)', [
      tenantA,
      `a-${tenantA.slice(0, 8)}`,
      'Tenant A',
      tenantB,
      `b-${tenantB.slice(0, 8)}`,
      'Tenant B',
      tenantSuspended,
      `s-${tenantSuspended.slice(0, 8)}`,
      'Suspended Tenant',
    ]);
    await c.query("update tenants set status='suspended' where id=$1", [tenantSuspended]);

    const mk = async (): Promise<{ userId: string; email: string; plain: string }> => {
      const userId = uuid();
      const email = `u-${userId.slice(0, 8)}@example.test`;
      const { plain, hash } = await pw();
      await c.query(
        'insert into users (id, email, password_hash, password_updated_at) values ($1,$2,$3, now())',
        [userId, email, hash],
      );
      return { userId, email, plain };
    };
    const addMembership = async (
      userId: string,
      tenantId: string,
      status = 'active',
    ): Promise<string> => {
      const id = uuid();
      await c.query(
        'insert into user_tenant_memberships (id, user_id, tenant_id, status) values ($1,$2,$3,$4)',
        [id, userId, tenantId, status],
      );
      return id;
    };

    const adminU = await mk();
    const adminMembershipA = await addMembership(adminU.userId, tenantA);
    const adminMembershipB = await addMembership(adminU.userId, tenantB);

    const secondAdminU = await mk();
    const secondAdminMembershipA = await addMembership(secondAdminU.userId, tenantA);

    const plainMemberU = await mk();
    const plainMemberMembershipA = await addMembership(plainMemberU.userId, tenantA);

    const limitedU = await mk();
    const limitedMembershipA = await addMembership(limitedU.userId, tenantA);

    const adminBU = await mk();
    const adminBMembershipB = await addMembership(adminBU.userId, tenantB);

    const noMemU = await mk();

    const suspendedU = await mk();
    const suspendedMembership = await addMembership(suspendedU.userId, tenantA, 'suspended');

    const inSuspTenantU = await mk();
    const inSuspTenantMembership = await addMembership(inSuspTenantU.userId, tenantSuspended);

    // roles: TENANT_ADMIN in A (full catalogue) + members-only role in A
    const admin = await db.provisionTenantAdmin(handle, {
      tenantId: tenantA,
      actingUserId: adminU.userId,
      membershipId: adminMembershipA,
      moduleKeys: allModules,
    });
    // second TENANT_ADMIN in A (idempotent role create, extra assignment)
    await db.provisionTenantAdmin(handle, {
      tenantId: tenantA,
      actingUserId: adminU.userId,
      membershipId: secondAdminMembershipA,
      moduleKeys: allModules,
    });
    const adminInB = await db.provisionTenantAdmin(handle, {
      tenantId: tenantB,
      actingUserId: adminBU.userId,
      membershipId: adminBMembershipB,
      moduleKeys: allModules,
    });

    const membersOnlyRoleA = uuid();
    await c.query('insert into roles (id, tenant_id, key, name) values ($1,$2,$3,$4)', [
      membersOnlyRoleA,
      tenantA,
      'MEMBERS_ONLY',
      'Members read only',
    ]);
    const permRow = await c.query("select id from permissions where key='memberships.read'");
    await c.query(
      'insert into role_permissions (role_id, tenant_id, permission_id) values ($1,$2,$3)',
      [membersOnlyRoleA, tenantA, permRow.rows[0].id],
    );
    await c.query(
      'insert into membership_roles (membership_id, role_id, tenant_id) values ($1,$2,$3)',
      [limitedMembershipA, membersOnlyRoleA, tenantA],
    );

    return {
      tenantA,
      tenantB,
      admin: {
        userId: adminU.userId,
        email: adminU.email,
        password: adminU.plain,
        membershipId: adminMembershipA,
        membershipIdInB: adminMembershipB,
      },
      secondAdmin: {
        userId: secondAdminU.userId,
        email: secondAdminU.email,
        password: secondAdminU.plain,
        membershipId: secondAdminMembershipA,
      },
      plainMember: {
        userId: plainMemberU.userId,
        email: plainMemberU.email,
        password: plainMemberU.plain,
        membershipId: plainMemberMembershipA,
      },
      limited: {
        userId: limitedU.userId,
        email: limitedU.email,
        password: limitedU.plain,
        membershipId: limitedMembershipA,
      },
      adminB: {
        userId: adminBU.userId,
        email: adminBU.email,
        password: adminBU.plain,
        membershipId: adminBMembershipB,
      },
      noMembership: { userId: noMemU.userId, email: noMemU.email, password: noMemU.plain },
      suspended: {
        userId: suspendedU.userId,
        email: suspendedU.email,
        password: suspendedU.plain,
        membershipId: suspendedMembership,
      },
      inSuspendedTenant: {
        userId: inSuspTenantU.userId,
        email: inSuspTenantU.email,
        password: inSuspTenantU.plain,
        membershipId: inSuspTenantMembership,
      },
      tenantAdminRoleA: admin.roleId,
      tenantAdminRoleB: adminInB.roleId,
      membersOnlyRoleA,
    };
  } finally {
    c.release();
    await handle.close();
  }
}

/** A raw connection for tests that must exercise RLS directly. Caller closes the pool. */
export async function rawPool(): Promise<pg.Pool> {
  ensureIntegrationEnv();
  return new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
}

// ── Phase 13 (ADR 0042) — module-entitlement fixture helpers ──────────
//
// Tests must be able to arrange BOTH "entitled" and "not entitled" states, so
// nothing here assumes a tenant has every module. These helpers write the
// `tenant_module_entitlements` row directly on a superuser connection — pure
// test *arrangement*. Dependency-rule and audit behaviour is exercised through
// the real platform API in `platform.int.spec.ts`, not here.

async function withSuperuser<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  ensureIntegrationEnv();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
    await pool.end();
  }
}

/** Force a tenant's entitlement for `moduleKey` to ENABLED or DISABLED (upsert). */
export async function setModuleState(
  tenantId: string,
  moduleKey: string,
  state: 'ENABLED' | 'DISABLED',
): Promise<void> {
  const isEnabled = state === 'ENABLED';
  await withSuperuser((c) =>
    c.query(
      `insert into tenant_module_entitlements
         (id, tenant_id, module_key, state, enabled_at, disabled_at)
       values (gen_random_uuid(), $1, $2, $3::module_entitlement_state,
               case when $4::boolean then now() else null end,
               case when $4::boolean then null else now() end)
       on conflict (tenant_id, module_key) do update
         set state = excluded.state,
             enabled_at = case when $4::boolean then now()
                               else tenant_module_entitlements.enabled_at end,
             disabled_at = case when $4::boolean then tenant_module_entitlements.disabled_at
                                else now() end,
             updated_at = now()`,
      [tenantId, moduleKey, state, isEnabled],
    ),
  );
}

export async function enableModule(tenantId: string, moduleKey: string): Promise<void> {
  await setModuleState(tenantId, moduleKey, 'ENABLED');
}

export async function disableModule(tenantId: string, moduleKey: string): Promise<void> {
  await setModuleState(tenantId, moduleKey, 'DISABLED');
}

export async function enableModules(
  tenantId: string,
  moduleKeys: readonly string[],
): Promise<void> {
  for (const k of moduleKeys) await setModuleState(tenantId, k, 'ENABLED');
}

/** Replace a tenant's entitlement set: `moduleKeys` ENABLED, every other DISABLED. */
export async function setTenantModules(
  tenantId: string,
  moduleKeys: readonly string[],
): Promise<void> {
  const { MODULE_KEYS } = await import('@aivoryx/shared');
  const wanted = new Set(moduleKeys);
  for (const k of MODULE_KEYS) {
    await setModuleState(tenantId, k, wanted.has(k) ? 'ENABLED' : 'DISABLED');
  }
}

/** Grant a user a global `platform_admins` row (idempotent). */
export async function grantPlatformAdmin(userId: string, note = 'integration-test'): Promise<void> {
  await withSuperuser((c) =>
    c.query(
      `insert into platform_admins (id, user_id, note) values (gen_random_uuid(), $1, $2)
       on conflict (user_id) do nothing`,
      [userId, note],
    ),
  );
}

/**
 * Create a self-contained tenant with a TENANT_ADMIN user + one plain member,
 * entitled to exactly `moduleKeys`. Independent of `makeFixtures` state.
 */
export async function createTenantWithModules(input: {
  name: string;
  moduleKeys: readonly string[];
}): Promise<{
  tenantId: string;
  admin: UserFixture;
  member: UserFixture;
}> {
  const db = await import('@aivoryx/db');
  const handle = db.createDb({ poolMax: 2 });
  const c = await handle.pool.connect();
  try {
    const tenantId = uuid();
    await c.query('insert into tenants (id, slug, name) values ($1,$2,$3)', [
      tenantId,
      `t-${tenantId.slice(0, 8)}`,
      input.name,
    ]);

    const mk = async (): Promise<UserFixture> => {
      const userId = uuid();
      const email = `u-${userId.slice(0, 8)}@example.test`;
      const { plain, hash } = await pw();
      await c.query(
        'insert into users (id, email, password_hash, password_updated_at) values ($1,$2,$3, now())',
        [userId, email, hash],
      );
      const membershipId = uuid();
      await c.query(
        `insert into user_tenant_memberships (id, user_id, tenant_id, status) values ($1,$2,$3,'active')`,
        [membershipId, userId, tenantId],
      );
      return { userId, email, password: plain, membershipId };
    };

    const admin = await mk();
    const member = await mk();
    await db.provisionTenantAdmin(handle, {
      tenantId,
      actingUserId: admin.userId,
      membershipId: admin.membershipId,
      moduleKeys: input.moduleKeys,
    });
    return { tenantId, admin, member };
  } finally {
    c.release();
    await handle.close();
  }
}
