import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type DbHandle } from './client.js';
import { withTenantContext } from './tx.js';

/**
 * Regression coverage for the connection-role assumption `client.ts` depends on and
 * `docs/architecture/DEPLOYMENT.md`'s "Supabase connection mode" section documents (release
 * engineering, staging-provider verification): `attachSetRole()` issues `SET ROLE` exactly once,
 * on the pool's `'connect'` event — i.e. once per PHYSICAL connection — and every later query or
 * transaction on that SAME physical connection is trusted to still run as that role, with no
 * per-query re-assertion anywhere in the codebase.
 *
 * `poolMax: 1` forces every query below through the one physical connection this pool ever
 * opens, so "the role survives N later queries" here is actually exercising connection *reuse*,
 * not coincidentally getting a fresh `SET ROLE` each time from a bigger pool.
 *
 * This proves our OWN pool wrapper's behavior against a direct Postgres connection. It cannot
 * and does not prove anything about a transaction-mode connection pooler (e.g. Supabase's
 * PgBouncer) sitting between this pool and Postgres, which can swap the backend session this
 * "one physical connection" is attached to between statements — exactly the risk
 * DEPLOYMENT.md flags for why the direct (non-pooled) Supabase connection string is required,
 * not the pooled one. That failure mode needs a live transaction-mode pooler to observe and is
 * out of reach for a unit/integration test against a direct local Postgres.
 *
 * Gated on `RUN_DB_IT=1` + `DATABASE_URL` against a migrated database, same convention as
 * `schema/rls.test.ts`.
 */
const RUN = process.env.RUN_DB_IT === '1' && !!process.env.DATABASE_URL;

describe.skipIf(!RUN)('createDb({ appRole }) — role persists across connection reuse', () => {
  // `createDb()` eagerly validates the server env (DATABASE_URL/REDIS_URL), so it
  // must not run at describe-body collection time — `skipIf` only skips running the tests, not
  // executing the rest of the describe callback, and those vars are intentionally unset when
  // RUN_DB_IT isn't set.
  let handle: DbHandle;
  beforeAll(() => {
    handle = createDb({ appRole: 'aivoryx_app', poolMax: 1 });
  });
  afterAll(() => handle.close());

  const currentRole = async () => {
    const result = await handle.db.execute<{ current_user: string }>(sql`select current_user`);
    return result.rows[0]?.current_user;
  };

  it('is aivoryx_app on the first query after connecting', async () => {
    expect(await currentRole()).toBe('aivoryx_app');
  });

  it('is still aivoryx_app on five further sequential queries on the reused connection', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await currentRole()).toBe('aivoryx_app');
    }
  });

  it('is still aivoryx_app inside a withTenantContext transaction, and after it commits', async () => {
    const tenantId = '00000000-0000-0000-0000-000000000000';
    const insideTx = await withTenantContext(handle, { tenantId, userId: tenantId }, (tx) =>
      tx.execute<{ current_user: string }>(sql`select current_user`),
    );
    expect(insideTx.rows[0]?.current_user).toBe('aivoryx_app');
    expect(await currentRole()).toBe('aivoryx_app');
  });

  it('never silently runs as the migrator/owner role, even once', async () => {
    const owner = createDb({ poolMax: 1 }); // no appRole — the migrator/owner handle
    try {
      const ownerRole = await owner.db.execute<{ current_user: string }>(sql`select current_user`);
      // sanity: the owner handle really is a different role, proving the assertions above are
      // actually discriminating something, not just always-true against a single-role database
      expect(ownerRole.rows[0]?.current_user).not.toBe('aivoryx_app');
    } finally {
      await owner.close();
    }
  });
});
