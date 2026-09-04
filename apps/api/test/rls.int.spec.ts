import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';

/**
 * Proves the isolation is enforced by PostgreSQL Row Level Security itself, not
 * by an application `WHERE` clause: every query here runs on a raw connection as
 * the non-privileged `aivoryx_app` role with only `SET LOCAL app.*` for context.
 *
 * `fx.limited` acts for the "cannot see tenant B" assertions because it holds no
 * membership in tenant B — so the `utm_self_read` policy (a user always sees
 * their *own* membership rows) cannot muddy the result.
 */

const RLS_TABLES = [
  'user_tenant_memberships',
  'roles',
  'role_permissions',
  'membership_roles',
  'tenants',
] as const;

const TENANT_TID_TABLES = [
  'user_tenant_memberships',
  'roles',
  'role_permissions',
  'membership_roles',
];

describe.skipIf(!INTEGRATION_ENABLED)('PostgreSQL Row Level Security', () => {
  let pool: Pool;
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await makeFixtures();
    pool = await rawPool();
  });

  afterAll(async () => {
    await pool?.end();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  /** Run `fn` on a fresh connection as `aivoryx_app` with a tenant context, then roll back. */
  async function asApp<T>(
    tenantId: string,
    userId: string,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('set role aivoryx_app');
      await c.query('begin');
      await c.query("select set_config('app.user_id', $1, true)", [userId]);
      await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      return await fn(c);
    } finally {
      await c.query('rollback').catch(() => undefined);
      await c.query('reset role').catch(() => undefined);
      c.release();
    }
  }

  /** As `aivoryx_app` with ONLY `app.user_id` set — the pre-tenant-resolution state. */
  async function asUser<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('set role aivoryx_app');
      await c.query('begin');
      await c.query("select set_config('app.user_id', $1, true)", [userId]);
      return await fn(c);
    } finally {
      await c.query('rollback').catch(() => undefined);
      await c.query('reset role').catch(() => undefined);
      c.release();
    }
  }

  const count = async (c: PoolClient, table: string, where = ''): Promise<number> => {
    const { rows } = await c.query<{ n: number }>(
      `select count(*)::int as n from ${table} ${where}`,
    );
    return rows[0]!.n;
  };

  it('every tenant-owned table has RLS ENABLED and FORCED', async () => {
    const { rows } = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1)`,
      [RLS_TABLES],
    );
    expect(rows.length).toBe(RLS_TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} ENABLE`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} FORCE`).toBe(true);
    }
  });

  it('the application role cannot bypass RLS', async () => {
    const { rows } = await pool.query(
      "select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'aivoryx_app'",
    );
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcanlogin: false });

    const who = await asApp(fx.tenantA, fx.limited.userId, async (c) => {
      const r = await c.query(
        'select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as bypass',
      );
      return r.rows[0];
    });
    expect(who.current_user).toBe('aivoryx_app');
    expect(who.bypass).toBe(false);
  });

  it('tenant A sees only its own rows — RLS filters even without a WHERE clause', async () => {
    const counts = await asApp(fx.tenantA, fx.limited.userId, async (c) => ({
      memberships: await count(c, 'user_tenant_memberships'),
      roles: await count(c, 'roles'),
      rolePerms: await count(c, 'role_permissions'),
      membershipRoles: await count(c, 'membership_roles'),
      tenants: await count(c, 'tenants'),
    }));

    // Tenant A memberships: admin + limited + suspended = 3
    expect(counts.memberships).toBe(3);
    // Tenant A roles: TENANT_ADMIN + MEMBERS_ONLY = 2
    expect(counts.roles).toBe(2);
    // only the current tenant is visible
    expect(counts.tenants).toBe(1);
    expect(counts.rolePerms).toBeGreaterThan(0);
    expect(counts.membershipRoles).toBeGreaterThan(0);
  });

  it('tenant A cannot READ any tenant B row', async () => {
    await asApp(fx.tenantA, fx.limited.userId, async (c) => {
      for (const table of TENANT_TID_TABLES) {
        expect(await count(c, table, `where tenant_id = '${fx.tenantB}'`), `read ${table}`).toBe(0);
      }
      // and tenant B's own tenants row is invisible
      expect(await count(c, 'tenants', `where id = '${fx.tenantB}'`)).toBe(0);
    });
  });

  it('tenant A cannot MUTATE tenant B rows (update/delete affect 0, insert rejected)', async () => {
    await asApp(fx.tenantA, fx.limited.userId, async (c) => {
      expect(
        (await c.query("update roles set name='HACKED' where tenant_id=$1", [fx.tenantB])).rowCount,
      ).toBe(0);
      expect(
        (
          await c.query('update membership_roles set role_id=role_id where tenant_id=$1', [
            fx.tenantB,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (await c.query('delete from role_permissions where tenant_id=$1', [fx.tenantB])).rowCount,
      ).toBe(0);
      expect(
        (await c.query('delete from user_tenant_memberships where tenant_id=$1', [fx.tenantB]))
          .rowCount,
      ).toBe(0);

      await c.query('savepoint sp');
      await expect(
        c.query(
          "insert into roles (id, tenant_id, key, name) values (gen_random_uuid(), $1, 'X', 'x')",
          [fx.tenantB],
        ),
      ).rejects.toMatchObject({ code: '42501' }); // RLS WITH CHECK -> insufficient_privilege
      await c.query('rollback to savepoint sp');
    });

    // tenant B genuinely untouched (verified on a superuser connection)
    const { rows } = await pool.query<{ name: string }>(
      'select name from roles where tenant_id = $1',
      [fx.tenantB],
    );
    expect(rows.every((r) => r.name !== 'HACKED')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('tenant B, symmetrically, cannot touch tenant A', async () => {
    await asApp(fx.tenantB, fx.adminB.userId, async (c) => {
      expect(await count(c, 'roles', `where tenant_id = '${fx.tenantA}'`)).toBe(0);
      expect(
        (await c.query("update roles set name='x' where tenant_id=$1", [fx.tenantA])).rowCount,
      ).toBe(0);
    });
  });

  describe('utm_self_read policy (ADR 0027)', () => {
    // fx.admin is a member of BOTH tenant A and tenant B.
    it('pre-tenant: a user sees exactly their own membership rows, across tenants, and no one else’s', async () => {
      const ids = await asUser(fx.admin.userId, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          'select id from user_tenant_memberships order by id',
        );
        return rows.map((r) => r.id).sort();
      });
      expect(ids).toEqual([fx.admin.membershipId, fx.admin.membershipIdInB].sort());

      // cannot see another user's rows even filtering for them
      const others = await asUser(fx.admin.userId, (c) =>
        count(c, 'user_tenant_memberships', `where user_id = '${fx.adminB.userId}'`),
      );
      expect(others).toBe(0);

      // the self policy does not bleed into other tables
      const roles = await asUser(fx.admin.userId, (c) => count(c, 'roles'));
      expect(roles).toBe(0);
    });

    it('in tenant A context: sees own tenant-B membership (self policy) but not another user’s tenant-B membership', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          await count(c, 'user_tenant_memberships', `where id = '${fx.admin.membershipIdInB}'`),
          'own tenant-B membership visible via self policy',
        ).toBe(1);
        expect(
          await count(c, 'user_tenant_memberships', `where id = '${fx.adminB.membershipId}'`),
          "another user's tenant-B membership NOT visible",
        ).toBe(0);
        expect(
          await count(c, 'user_tenant_memberships', `where user_id = '${fx.adminB.userId}'`),
        ).toBe(0);
      });
    });

    it('self_read grants no write path — cannot mutate any row it exposes', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        // another user's row (invisible to writes anyway)
        expect(
          (
            await c.query(
              "update user_tenant_memberships set status='suspended' where user_id=$1",
              [fx.adminB.userId],
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await c.query('delete from user_tenant_memberships where id=$1', [
              fx.adminB.membershipId,
            ])
          ).rowCount,
        ).toBe(0);
        // even the caller's OWN tenant-B row: self_read is SELECT-only, and the
        // tenant-A WITH CHECK does not cover a tenant-B row.
        expect(
          (
            await c.query("update user_tenant_memberships set status='suspended' where id=$1", [
              fx.admin.membershipIdInB,
            ])
          ).rowCount,
        ).toBe(0);
      });
    });
  });

  it('with no tenant context set, every RLS table returns nothing (fail closed, no error)', async () => {
    const c = await pool.connect();
    try {
      await c.query('set role aivoryx_app');
      await c.query('begin');
      for (const table of RLS_TABLES) {
        expect(await count(c, table), `${table} with no app.tenant_id`).toBe(0);
      }
    } finally {
      await c.query('rollback').catch(() => undefined);
      await c.query('reset role').catch(() => undefined);
      c.release();
    }
  });
});
