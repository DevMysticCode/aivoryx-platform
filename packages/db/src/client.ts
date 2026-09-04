import { loadServerEnv } from '@aivoryx/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Pool, PoolClient, PoolConfig } from 'pg';
import * as schema from './schema/index.js';

// `pg` is CommonJS; take the constructor off the default export for reliable
// ESM interop (`import { Pool } from 'pg'` fails at runtime under NodeNext).
const PgPool = pg.Pool;

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: Pool;
  /** Close the pool. Call during graceful shutdown. */
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  connectionString?: string;
  poolMax?: number;
  /**
   * If set, every physical connection issues `SET ROLE "<appRole>"` right after
   * connecting, so all queries run as that non-privileged role and Row Level
   * Security is always enforced (ADR 0027). Omit for the migration/owner handle.
   * `''` is treated as "no SET ROLE".
   */
  appRole?: string;
  /** Extra pg pool options (e.g. ssl in production). */
  pool?: Omit<PoolConfig, 'connectionString' | 'max'>;
}

const SQL_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function attachSetRole(pool: Pool, appRole: string): void {
  if (!SQL_IDENT.test(appRole)) {
    throw new Error(
      `Invalid DATABASE_APP_ROLE ${JSON.stringify(appRole)} — must be a plain identifier`,
    );
  }
  pool.on('connect', (client: PoolClient) => {
    // Fire-and-forget on the fresh connection. If the role is missing (e.g. the
    // security migration has not run yet) the connection errors loudly — run
    // `pnpm db:migrate` before starting the API.
    client.query(`SET ROLE "${appRole}"`).catch((err: unknown) => {
      client.emit('error', err instanceof Error ? err : new Error(String(err)));
    });
  });
}

/**
 * Create an isolated database handle. Connections are lazy — the pool does not
 * dial PostgreSQL until the first query — so this is safe to call in contexts
 * that never touch the DB (e.g. OpenAPI generation).
 */
export function createDb(options: CreateDbOptions = {}): DbHandle {
  const env = loadServerEnv();
  const pool = new PgPool({
    connectionString: options.connectionString ?? env.DATABASE_URL,
    max: options.poolMax ?? env.DATABASE_POOL_MAX,
    ...options.pool,
  });
  if (options.appRole) {
    attachSetRole(pool, options.appRole);
  }
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}

let singleton: DbHandle | undefined;

/**
 * Process-wide database handle for the running app. Runs every query as the
 * non-privileged `DATABASE_APP_ROLE` so RLS is always enforced.
 */
export function getDb(): DbHandle {
  singleton ??= createDb({ appRole: loadServerEnv().DATABASE_APP_ROLE });
  return singleton;
}

/** Close and drop the process-wide handle (graceful shutdown / tests). */
export async function closeDb(): Promise<void> {
  if (singleton) {
    await singleton.close();
    singleton = undefined;
  }
}

export { schema };
