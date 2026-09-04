import { sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { isUuidV7, newUuidV7 } from './id.js';

export interface DbHealthResult {
  status: 'ok' | 'error';
  latencyMs: number;
  checks: {
    /** `SELECT 1` succeeded */
    connectivity: boolean;
    /** a generated UUIDv7 round-tripped through the `uuid` column type */
    uuidv7: boolean;
  };
  error?: string;
}

/**
 * Minimal database health probe used by the API `/api/v1/health` endpoint
 * (Phase 1). Verifies connectivity and that PostgreSQL accepts a UUIDv7 value
 * as a native `uuid` — without needing a specific PostgreSQL version.
 */
export async function checkDatabaseHealth(db: Database): Promise<DbHealthResult> {
  const startedAt = performance.now();
  const checks = { connectivity: false, uuidv7: false };

  try {
    await db.execute(sql`select 1`);
    checks.connectivity = true;

    const id = newUuidV7();
    const rows = await db.execute<{ round_trip: string }>(sql`select ${id}::uuid as round_trip`);
    const value = (rows.rows[0]?.round_trip ?? '').toString();
    checks.uuidv7 = value.toLowerCase() === id.toLowerCase() && isUuidV7(value);

    const ok = checks.connectivity && checks.uuidv7;
    return {
      status: ok ? 'ok' : 'error',
      latencyMs: Math.round(performance.now() - startedAt),
      checks,
    };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - startedAt),
      checks,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
