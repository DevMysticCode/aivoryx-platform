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
    });
    // second TENANT_ADMIN in A (idempotent role create, extra assignment)
    await db.provisionTenantAdmin(handle, {
      tenantId: tenantA,
      actingUserId: adminU.userId,
      membershipId: secondAdminMembershipA,
    });
    const adminInB = await db.provisionTenantAdmin(handle, {
      tenantId: tenantB,
      actingUserId: adminBU.userId,
      membershipId: adminBMembershipB,
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
