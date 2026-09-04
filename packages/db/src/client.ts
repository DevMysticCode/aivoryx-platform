import { loadServerEnv } from '@aivoryx/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Pool, PoolConfig } from 'pg';
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
  /** Extra pg pool options (e.g. ssl in production). */
  pool?: Omit<PoolConfig, 'connectionString' | 'max'>;
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

/** Process-wide database handle for the running app. */
export function getDb(): DbHandle {
  singleton ??= createDb();
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
