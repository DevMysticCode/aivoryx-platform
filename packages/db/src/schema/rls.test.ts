import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Schema-level assertion that Row Level Security is present on every
 * tenant-owned identity table (ADR 0027 / TENANCY.md "Testing (required)").
 * Behavioural isolation is proven in `apps/api/test/rls.int.spec.ts`.
 *
 * Gated on `RUN_DB_IT=1` + `DATABASE_URL` against a migrated database.
 */

const RUN = process.env.RUN_DB_IT === '1' && !!process.env.DATABASE_URL;

const TENANT_OWNED_TABLES = [
  'user_tenant_memberships',
  'roles',
  'role_permissions',
  'membership_roles',
  'tenants',
  'tenant_invitations',
  'outbox_events',
];

const NON_TENANT_TABLES = ['users', 'sessions', 'permissions'];

describe.skipIf(!RUN)('Row Level Security (schema)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it('every tenant-owned table has RLS enabled AND forced', async () => {
    const { rows } = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1)`,
      [TENANT_OWNED_TABLES],
    );
    const byName = new Map(rows.map((r) => [r.relname, r]));
    for (const table of TENANT_OWNED_TABLES) {
      const row = byName.get(table);
      expect(row, `${table} exists`).toBeDefined();
      expect(row!.relrowsecurity, `${table} ENABLE ROW LEVEL SECURITY`).toBe(true);
      expect(row!.relforcerowsecurity, `${table} FORCE ROW LEVEL SECURITY`).toBe(true);
    }
  });

  it('each tenant-owned table has at least one isolation policy with a WITH CHECK', async () => {
    const { rows } = await pool.query<{
      tablename: string;
      policyname: string;
      with_check: string | null;
    }>(`select tablename, policyname, with_check from pg_policies where schemaname = 'public'`);
    for (const table of TENANT_OWNED_TABLES) {
      const policies = rows.filter((r) => r.tablename === table);
      expect(policies.length, `${table} has policies`).toBeGreaterThan(0);
      expect(
        policies.some((p) => (p.with_check ?? '').includes("current_setting('app.tenant_id'")),
        `${table} has a tenant WITH CHECK`,
      ).toBe(true);
    }
  });

  it('non-tenant tables are deliberately left without RLS', async () => {
    const { rows } = await pool.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1)`,
      [NON_TENANT_TABLES],
    );
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} should NOT have RLS`).toBe(false);
    }
  });

  it('the application role is non-privileged (no SUPERUSER / BYPASSRLS / LOGIN)', async () => {
    const { rows } = await pool.query(
      "select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'aivoryx_app'",
    );
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcanlogin: false });
  });
});
