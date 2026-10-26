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
  process.env.SESSION_COOKIE_SECURE ??= 'false';
  // Many specs log in as the same fixture email repeatedly within one file (a
  // helper like `platformCookie()` called fresh per `it()`), which would trip
  // the real production login-throttle default. Generous here; the throttle
  // mechanism itself is proven with a deliberately tiny bucket via DI override
  // in auth.int.spec.ts, not by lowering this shared default.
  process.env.LOGIN_RATE_LIMIT_MAX ??= '1000';
  // Same reasoning as LOGIN_RATE_LIMIT_MAX above, for the password-reset-request
  // throttle — several specs request a reset for the same fixture email more
  // than once per file (e.g. the restore-password dance in password-reset.int.spec.ts).
  process.env.PASSWORD_RESET_RATE_LIMIT_MAX ??= '1000';
  // Notifications (Phase 8): never send real email in tests. The integration
  // suite drives the dispatcher + delivery services directly for determinism,
  // so the background worker/queue stays off here (the Playwright E2E exercises
  // the live queue path instead).
  process.env.EMAIL_PROVIDER ??= 'fake';
  process.env.NOTIFICATIONS_ENABLED ??= 'false';
  process.env.NOTIFICATIONS_POLL_MS ??= '400';
  // The raw-event purge job is driven explicitly by the specs that test it.
  process.env.RAW_EVENT_PURGE_ENABLED ??= 'false';
}

export const INTEGRATION_ENABLED = process.env.RUN_DB_IT === '1';
