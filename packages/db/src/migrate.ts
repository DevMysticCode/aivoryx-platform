import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

const migrationsFolder = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');

/**
 * Apply pending Drizzle migrations. Run as a release step (before the new API
 * version takes traffic) and locally via `pnpm --filter @aivoryx/db db:migrate`.
 */
export async function runMigrations(): Promise<void> {
  const handle = createDb({ poolMax: 1 });
  try {
    await migrate(handle.db, { migrationsFolder });
  } finally {
    await handle.close();
  }
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  runMigrations()
    .then(() => {
      console.warn('[db] migrations applied');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('[db] migration failed:', err);
      process.exit(1);
    });
}
