/**
 * Runs once before the integration suites (vitest `globalSetup`): drop + migrate
 * + seed the test database a single time. Each `*.int.spec.ts` then builds its
 * own fixture set with unique ids, so the suites can share one database without
 * a per-file reset race.
 *
 * Inert unless `RUN_DB_IT=1`.
 */
export default async function setup(): Promise<void> {
  if (process.env.RUN_DB_IT !== '1') return;
  const { resetDatabase } = await import('./support/db.js');
  await resetDatabase();
}
