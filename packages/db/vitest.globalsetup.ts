/**
 * When `RUN_DB_IT=1`, reset + migrate + seed the test database once before the
 * `packages/db` integration/schema specs (`identity.constraints.test.ts`,
 * `rls.test.ts`). Inert otherwise, so `pnpm test` stays hermetic.
 */
import pg from 'pg';

export default async function setup(): Promise<void> {
  if (process.env.RUN_DB_IT !== '1') return;

  // `runMigrations` → `createDb` → `loadServerEnv` validates the whole server
  // env; fill the parts migrations do not use.
  process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:55432/aivoryx';
  process.env.REDIS_URL ??= 'redis://localhost:56379';
  process.env.SESSION_SECRET ??= 'db-integration-test-session-secret-000000000000';
  process.env.DATABASE_APP_ROLE ??= 'aivoryx_app';

  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await admin.query('drop schema if exists public cascade');
    await admin.query('drop schema if exists drizzle cascade');
    await admin.query('create schema public');
  } finally {
    await admin.end();
  }

  const db = await import('./src/index.js');
  await db.runMigrations();
  const handle = db.createDb({ poolMax: 1 });
  try {
    await db.seedPermissions(handle);
  } finally {
    await handle.close();
  }
}
