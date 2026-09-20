import { parseWebEnv } from '@aivoryx/config/web';

/**
 * Browser-safe environment. Next.js inlines `process.env.NEXT_PUBLIC_*` at build
 * time, so these must be referenced statically (not via a dynamic key).
 * Server secrets are never read here.
 */
export const webEnv = parseWebEnv({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_API_PROXY: process.env.NEXT_PUBLIC_API_PROXY || undefined,
  NEXT_PUBLIC_HELP_BASE_URL: process.env.NEXT_PUBLIC_HELP_BASE_URL || undefined,
  NEXT_PUBLIC_SUPPORT_EMAIL: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || undefined,
});

/**
 * Base URL the BROWSER uses for API calls and API-hosted assets: empty (same-origin, proxied by
 * Next) in proxy mode, otherwise the API origin. Server-side fetches keep using
 * `webEnv.NEXT_PUBLIC_API_BASE_URL` directly — the Next server can't call a relative URL.
 */
export const apiBaseUrl = (): string =>
  webEnv.NEXT_PUBLIC_API_PROXY === 'true' ? '' : webEnv.NEXT_PUBLIC_API_BASE_URL;
