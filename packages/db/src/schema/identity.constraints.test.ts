import pg from 'pg';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newUuidV7 } from '../id.js';

/**
 * Behavioural constraint checks against a real PostgreSQL 16.
 *
 * Gated on `RUN_DB_IT=1` + `DATABASE_URL` (needs `docker compose up -d` and a
 * migrated database) so the default `pnpm test` / CI run stays hermetic. The
 * later "CI service containers" task makes these always-on.
 *
 *   RUN_DB_IT=1 DATABASE_URL=postgres://postgres:postgres@localhost:55432/aivoryx \
 *     pnpm --filter @aivoryx/db test
 *
 * Connects with a bare `pg` pool (no `@aivoryx/config` env validation — a test
 * only needs a connection string). Every case runs in a transaction that is
 * always rolled back, so the suite leaves no rows behind.
 */

const RUN = process.env.RUN_DB_IT === '1' && !!process.env.DATABASE_URL;

const PG_UNIQUE_VIOLATION = '23505';
const PG_FK_VIOLATION = '23503';

let pool: pg.Pool;

async function inTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    return await fn(client);
  } finally {
    await client.query('rollback');
    client.release();
  }
}

/**
 * Assert `run()` fails with a specific PostgreSQL SQLSTATE, wrapped in a
 * savepoint so the surrounding transaction stays usable for further assertions
 * (a failed statement otherwise aborts the whole transaction — SQLSTATE 25P02).
 */
async function expectViolation(
  c: PoolClient,
  code: string,
  run: () => Promise<unknown>,
): Promise<void> {
  await c.query('savepoint sp');
  await expect(run()).rejects.toMatchObject({ code });
  await c.query('rollback to savepoint sp');
  await c.query('release savepoint sp');
}

let seq = 0;
const uniqueSlug = () => `t-${Date.now().toString(36)}-${(seq += 1)}`;
const uniqueEmail = () => `u-${Date.now().toString(36)}-${(seq += 1)}@example.test`;

async function insertTenant(c: PoolClient): Promise<string> {
  const id = newUuidV7();
  await c.query('insert into tenants (id, slug, name) values ($1, $2, $3)', [
    id,
    uniqueSlug(),
    'Test Tenant',
  ]);
  return id;
}
async function insertUser(c: PoolClient, email = uniqueEmail()): Promise<string> {
  const id = newUuidV7();
  await c.query('insert into users (id, email) values ($1, $2)', [id, email]);
  return id;
}
async function insertMembership(c: PoolClient, userId: string, tenantId: string): Promise<string> {
  const id = newUuidV7();
  await c.query(
    'insert into user_tenant_memberships (id, user_id, tenant_id) values ($1, $2, $3)',
    [id, userId, tenantId],
  );
  return id;
}
async function insertRole(
  c: PoolClient,
  tenantId: string,
  key = `role-${(seq += 1)}`,
): Promise<string> {
  const id = newUuidV7();
  await c.query('insert into roles (id, tenant_id, key, name) values ($1, $2, $3, $4)', [
    id,
    tenantId,
    key,
    key,
  ]);
  return id;
}
async function insertPermission(c: PoolClient, key = `perm.${(seq += 1)}`): Promise<string> {
  const id = newUuidV7();
  await c.query('insert into permissions (id, key) values ($1, $2)', [id, key]);
  return id;
}
async function insertSession(
  c: PoolClient,
  userId: string,
  activeMembershipId: string | null = null,
): Promise<string> {
  const id = newUuidV7();
  await c.query(
    `insert into sessions (id, user_id, token_hash, active_membership_id, expires_at)
     values ($1, $2, $3, $4, now() + interval '1 day')`,
    [id, userId, `hash-${newUuidV7()}`, activeMembershipId],
  );
  return id;
}

describe.skipIf(!RUN)('identity constraints (live PostgreSQL)', () => {
  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('rejects a duplicate email case-insensitively', async () => {
    await inTx(async (c) => {
      await insertUser(c, 'Case@Example.test');
      await expectViolation(c, PG_UNIQUE_VIOLATION, () => insertUser(c, 'case@example.TEST'));
    });
  });

  it('allows one membership per (user, tenant) and rejects a second', async () => {
    await inTx(async (c) => {
      const tenant = await insertTenant(c);
      const user = await insertUser(c);
      await insertMembership(c, user, tenant);
      await expectViolation(c, PG_UNIQUE_VIOLATION, () => insertMembership(c, user, tenant));
    });
  });

  it('lets one user belong to multiple tenants', async () => {
    await inTx(async (c) => {
      const user = await insertUser(c);
      const t1 = await insertTenant(c);
      const t2 = await insertTenant(c);
      await insertMembership(c, user, t1);
      await insertMembership(c, user, t2);
      const { rows } = await c.query(
        'select count(*)::int as n from user_tenant_memberships where user_id = $1',
        [user],
      );
      expect(rows[0].n).toBe(2);
    });
  });

  it('forbids assigning a role from another tenant to a membership', async () => {
    await inTx(async (c) => {
      const t1 = await insertTenant(c);
      const t2 = await insertTenant(c);
      const user = await insertUser(c);
      const membership = await insertMembership(c, user, t1);
      const foreignRole = await insertRole(c, t2);

      // membership is in t1; claiming tenant t2 breaks the membership composite FK
      await expectViolation(c, PG_FK_VIOLATION, () =>
        c.query(
          'insert into membership_roles (membership_id, role_id, tenant_id) values ($1, $2, $3)',
          [membership, foreignRole, t2],
        ),
      );
      // claiming tenant t1 breaks the role composite FK (role is in t2)
      await expectViolation(c, PG_FK_VIOLATION, () =>
        c.query(
          'insert into membership_roles (membership_id, role_id, tenant_id) values ($1, $2, $3)',
          [membership, foreignRole, t1],
        ),
      );
    });
  });

  it('accepts a same-tenant membership/role assignment', async () => {
    await inTx(async (c) => {
      const tenant = await insertTenant(c);
      const user = await insertUser(c);
      const membership = await insertMembership(c, user, tenant);
      const role = await insertRole(c, tenant);
      await c.query(
        'insert into membership_roles (membership_id, role_id, tenant_id) values ($1, $2, $3)',
        [membership, role, tenant],
      );
      const { rows } = await c.query(
        'select count(*)::int as n from membership_roles where membership_id = $1',
        [membership],
      );
      expect(rows[0].n).toBe(1);
    });
  });

  it('cascades role_permissions when a role is deleted', async () => {
    await inTx(async (c) => {
      const tenant = await insertTenant(c);
      const role = await insertRole(c, tenant);
      const permission = await insertPermission(c);
      await c.query(
        'insert into role_permissions (role_id, tenant_id, permission_id) values ($1, $2, $3)',
        [role, tenant, permission],
      );
      await c.query('delete from roles where id = $1', [role]);
      const { rows } = await c.query(
        'select count(*)::int as n from role_permissions where role_id = $1',
        [role],
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('blocks deleting a role that is still assigned to a membership (restrict)', async () => {
    await inTx(async (c) => {
      const tenant = await insertTenant(c);
      const user = await insertUser(c);
      const membership = await insertMembership(c, user, tenant);
      const role = await insertRole(c, tenant);
      await c.query(
        'insert into membership_roles (membership_id, role_id, tenant_id) values ($1, $2, $3)',
        [membership, role, tenant],
      );
      await expectViolation(c, PG_FK_VIOLATION, () =>
        c.query('delete from roles where id = $1', [role]),
      );
    });
  });

  it('blocks deleting a permission that is still granted to a role (restrict)', async () => {
    await inTx(async (c) => {
      const tenant = await insertTenant(c);
      const role = await insertRole(c, tenant);
      const permission = await insertPermission(c);
      await c.query(
        'insert into role_permissions (role_id, tenant_id, permission_id) values ($1, $2, $3)',
        [role, tenant, permission],
      );
      await expectViolation(c, PG_FK_VIOLATION, () =>
        c.query('delete from permissions where id = $1', [permission]),
      );
    });
  });

  it('enforces a unique session token hash and requires a real user', async () => {
    await inTx(async (c) => {
      const user = await insertUser(c);
      const hash = `hash-${newUuidV7()}`;
      const future = "now() + interval '1 day'";
      await c.query(
        `insert into sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, ${future})`,
        [newUuidV7(), user, hash],
      );
      await expectViolation(c, PG_UNIQUE_VIOLATION, () =>
        c.query(
          `insert into sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, ${future})`,
          [newUuidV7(), user, hash],
        ),
      );
      await expectViolation(c, PG_FK_VIOLATION, () =>
        c.query(
          `insert into sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, ${future})`,
          [newUuidV7(), newUuidV7(), `hash-${newUuidV7()}`],
        ),
      );
    });
  });

  it('accepts a session whose active membership belongs to that same user', async () => {
    await inTx(async (c) => {
      const tenant = await insertTenant(c);
      const user = await insertUser(c);
      const membership = await insertMembership(c, user, tenant);
      const session = await insertSession(c, user, membership);
      const { rows } = await c.query('select active_membership_id from sessions where id = $1', [
        session,
      ]);
      expect(rows[0].active_membership_id).toBe(membership);
    });
  });

  it('rejects a session whose active membership belongs to a different user', async () => {
    await inTx(async (c) => {
      const tenant = await insertTenant(c);
      const owner = await insertUser(c);
      const other = await insertUser(c);
      const ownerMembership = await insertMembership(c, owner, tenant);
      // `other` tries to point at `owner`'s membership
      await expectViolation(c, PG_FK_VIOLATION, () => insertSession(c, other, ownerMembership));
    });
  });

  it('allows a session with no active membership selected (NULL)', async () => {
    await inTx(async (c) => {
      const user = await insertUser(c);
      const session = await insertSession(c, user, null);
      const { rows } = await c.query('select active_membership_id from sessions where id = $1', [
        session,
      ]);
      expect(rows[0].active_membership_id).toBeNull();
    });
  });

  it('clears the active session by deleting it when that membership is removed (cascade)', async () => {
    await inTx(async (c) => {
      const tenant = await insertTenant(c);
      const user = await insertUser(c);
      const membershipA = await insertMembership(c, user, tenant);
      const tenantB = await insertTenant(c);
      const membershipB = await insertMembership(c, user, tenantB);
      const sessionA = await insertSession(c, user, membershipA);
      const sessionB = await insertSession(c, user, membershipB);
      await c.query('delete from user_tenant_memberships where id = $1', [membershipA]);
      const remaining = await c.query('select id from sessions where user_id = $1', [user]);
      const ids = remaining.rows.map((r) => r.id);
      expect(ids).not.toContain(sessionA); // was active in the removed membership
      expect(ids).toContain(sessionB); // active elsewhere, untouched
    });
  });

  it('deletes sessions and memberships when their user is deleted', async () => {
    await inTx(async (c) => {
      const tenant = await insertTenant(c);
      const user = await insertUser(c);
      await insertMembership(c, user, tenant);
      await c.query(
        "insert into sessions (id, user_id, token_hash, expires_at) values ($1, $2, $3, now() + interval '1 day')",
        [newUuidV7(), user, `hash-${newUuidV7()}`],
      );
      await c.query('delete from users where id = $1', [user]);
      const sessionRows = await c.query(
        'select count(*)::int as n from sessions where user_id = $1',
        [user],
      );
      const membershipRows = await c.query(
        'select count(*)::int as n from user_tenant_memberships where user_id = $1',
        [user],
      );
      expect(sessionRows.rows[0].n).toBe(0);
      expect(membershipRows.rows[0].n).toBe(0);
    });
  });
});
