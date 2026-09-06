/**
 * Fill in the environment an integration spec needs before anything from
 * `@aivoryx/config` is loaded. Values already present (e.g. from CI or a local
 * `.env` export) win.
 */
export function ensureIntegrationEnv(): void {
  process.env.APP_ENV ??= 'test';
  process.env.NODE_ENV ??= 'test';
  process.env.LOG_LEVEL ??= 'silent';
  process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:55432/aivoryx';
  process.env.DATABASE_APP_ROLE ??= 'aivoryx_app';
  process.env.REDIS_URL ??= 'redis://localhost:56379';
  process.env.SESSION_SECRET ??= 'integration-test-session-secret-00000000000000';
  process.env.SESSION_COOKIE_SECURE ??= 'false';
  // Notifications (Phase 8): never send real email in tests. The integration
  // suite drives the dispatcher + delivery services directly for determinism,
  // so the background worker/queue stays off here (the Playwright E2E exercises
  // the live queue path instead).
  process.env.EMAIL_PROVIDER ??= 'fake';
  process.env.NOTIFICATIONS_ENABLED ??= 'false';
  process.env.NOTIFICATIONS_POLL_MS ??= '400';
}

export const INTEGRATION_ENABLED = process.env.RUN_DB_IT === '1';
