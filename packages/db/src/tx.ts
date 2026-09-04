import { sql } from 'drizzle-orm';
import type { DbHandle } from './client.js';

/**
 * Per-transaction tenant context (ADR 0027).
 *
 * The API's DB connections run as the non-privileged `aivoryx_app` role (see
 * `client.ts`), so Row Level Security is always in force. These helpers set
 * `app.user_id` / `app.tenant_id` with `SET LOCAL` semantics
 * (`set_config(name, value, is_local => true)`) as the first statements of a
 * transaction. Postgres reverts them automatically at COMMIT/ROLLBACK, so a
 * pooled connection never carries one request's tenant into the next.
 *
 * There is deliberately no "set the tenant globally" helper — that would be the
 * exact footgun RLS is meant to remove.
 */

// The transaction handle drizzle passes to a `db.transaction(fn)` callback.
export type Tx = Parameters<Parameters<DbHandle['db']['transaction']>[0]>[0];

export interface TenantContextInput {
  tenantId: string;
  userId: string;
}

/**
 * Transaction with only the restricted app role in effect and no tenant
 * context. Use for the non-tenant tables (`users`, `sessions`).
 */
export function withAppTransaction<T>(handle: DbHandle, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return handle.db.transaction((tx) => fn(tx));
}

/**
 * Transaction that binds `app.user_id` only. Lets a user read their own
 * `user_tenant_memberships` rows (the `utm_self_read` policy) — needed to
 * resolve tenant context before a tenant is active, and for `/auth/me`.
 */
export function withUserContext<T>(
  handle: DbHandle,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return handle.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}

/**
 * Transaction with full tenant context: `app.user_id` + `app.tenant_id`. Every
 * tenant-owned table is RLS-scoped to `tenantId` for the duration of the
 * transaction.
 */
export function withTenantContext<T>(
  handle: DbHandle,
  ctx: TenantContextInput,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return handle.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
    await tx.execute(sql`select set_config('app.tenant_id', ${ctx.tenantId}, true)`);
    return fn(tx);
  });
}

/** Read back the current transaction's tenant context (diagnostics / tests). */
export async function currentTenantContext(
  tx: Tx,
): Promise<{ userId: string | null; tenantId: string | null }> {
  const result = await tx.execute<{ user_id: string | null; tenant_id: string | null }>(
    sql`select nullif(current_setting('app.user_id', true), '') as user_id,
               nullif(current_setting('app.tenant_id', true), '') as tenant_id`,
  );
  const row = result.rows[0];
  return { userId: row?.user_id ?? null, tenantId: row?.tenant_id ?? null };
}
