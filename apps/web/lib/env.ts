import { parseWebEnv } from '@aivoryx/config/web';

/**
 * Browser-safe environment. Next.js inlines `process.env.NEXT_PUBLIC_*` at build
 * time, so these must be referenced statically (not via a dynamic key).
 * Server secrets are never read here.
 */
export const webEnv = parseWebEnv({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
});
