import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';

/**
 * The per-transaction tenant setting must never leak between transactions or
 * between concurrent requests (task 7 / ADR 0027).
 */
describe.skipIf(!INTEGRATION_ENABLED)('per-transaction tenant context', () => {
  let fx: Fixtures;
  let db: typeof import('@aivoryx/db');

  beforeAll(async () => {
    fx = await makeFixtures();
    db = await import('@aivoryx/db');
  });

  afterAll(async () => {
    await db.closeDb();
  });

  it('exposes the context inside a transaction and nothing outside it', async () => {
    const inside = await db.withTenantContext(
      db.getDb(),
      { tenantId: fx.tenantA, userId: fx.admin.userId },
      (tx) => db.currentTenantContext(tx),
    );
    expect(inside).toEqual({ tenantId: fx.tenantA, userId: fx.admin.userId });

    const outside = await db.withAppTransaction(db.getDb(), (tx) => db.currentTenantContext(tx));
    expect(outside).toEqual({ tenantId: null, userId: null });
  });

  it('the setting is gone on the next use of the same pooled connection', async () => {
    // force a tiny pool so the same physical connection is reused
    const handle = db.createDb({ poolMax: 1, appRole: process.env.DATABASE_APP_ROLE });
    try {
      await db.withTenantContext(
        handle,
        { tenantId: fx.tenantB, userId: fx.adminB.userId },
        async (tx) => {
          await tx.execute(sql`select 1`);
        },
      );
      const leaked = await db.withAppTransaction(handle, (tx) => db.currentTenantContext(tx));
      expect(leaked).toEqual({ tenantId: null, userId: null });
    } finally {
      await handle.close();
    }
  });

  it('the invitation-token-hash context (ADR 0030) is also transaction-local — no leakage on pooled reuse', async () => {
    const handle = db.createDb({ poolMax: 1, appRole: process.env.DATABASE_APP_ROLE });
    try {
      await db.withProgressiveContext(handle, async (tx, setContext) => {
        await setContext({ invitationTokenHash: 'deadbeef' });
        await tx.execute(sql`select 1`);
      });
      const leaked = await db.withAppTransaction(handle, (tx) =>
        tx.execute<{ v: string | null }>(
          sql`select nullif(current_setting('app.invitation_token_hash', true), '') as v`,
        ),
      );
      expect(leaked.rows[0]!.v).toBeNull();
    } finally {
      await handle.close();
    }
  });

  it('a createDb({ appRole }) connection runs every query as aivoryx_app, which cannot bypass RLS', async () => {
    // This is exactly how getDb() builds the API's pool. Prove the pool
    // `connect` handler's SET ROLE is in effect on the first query of a fresh
    // connection — not a race where a query runs as the (possibly superuser)
    // connection user.
    const handle = db.createDb({ poolMax: 1, appRole: process.env.DATABASE_APP_ROLE });
    try {
      const who = await db.withAppTransaction(handle, async (tx) => {
        const r = await tx.execute<{
          current_user: string;
          is_super: boolean;
          bypass_rls: boolean;
        }>(
          sql`select current_user,
                     (select rolsuper from pg_roles where rolname = current_user)     as is_super,
                     (select rolbypassrls from pg_roles where rolname = current_user) as bypass_rls`,
        );
        return r.rows[0]!;
      });
      expect(who.current_user).toBe(process.env.DATABASE_APP_ROLE ?? 'aivoryx_app');
      expect(who.is_super).toBe(false);
      expect(who.bypass_rls).toBe(false);

      // and with no tenant context, a tenant-owned table is empty (fail closed)
      const rows = await db.withAppTransaction(handle, (tx) =>
        tx.execute<{ n: number }>(sql`select count(*)::int as n from roles`),
      );
      expect(rows.rows[0]!.n).toBe(0);
    } finally {
      await handle.close();
    }
  });

  it('two concurrent tenant transactions never see each other’s context or rows', async () => {
    const runs = Array.from({ length: 25 }, (_, i) => {
      const [tenantId, userId, expectRoles] =
        i % 2 === 0
          ? [fx.tenantA, fx.admin.userId, 2] // TENANT_ADMIN + MEMBERS_ONLY
          : [fx.tenantB, fx.adminB.userId, 1]; // TENANT_ADMIN
      return db.withTenantContext(db.getDb(), { tenantId, userId }, async (tx) => {
        const ctx = await db.currentTenantContext(tx);
        const roleCount = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from roles`,
        );
        return { ctx, tenantId, n: roleCount.rows[0]!.n, expectRoles };
      });
    });

    const results = await Promise.all(runs);
    for (const r of results) {
      expect(r.ctx.tenantId).toBe(r.tenantId);
      expect(r.n).toBe(r.expectRoles);
    }
  });
});
