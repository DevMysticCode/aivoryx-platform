import { z } from 'zod';
import { appEnvSchema, formatEnvError } from './shared.js';

/**
 * BROWSER-SAFE environment. Only `NEXT_PUBLIC_*` values, all non-sensitive.
 * Next.js inlines these at build time, so anything here ships to the client.
 */
export const webEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:4000'),
  NEXT_PUBLIC_APP_ENV: appEnvSchema.default('development'),
  /**
   * `true` = the browser talks to its OWN origin (`/api/v1/*`) and the Next server proxies to the
   * API (see `apps/web/next.config.mjs`). The session cookie then belongs to the web site instead
   * of a third-party API site, so browsers that block third-party cookies still keep the session.
   */
  NEXT_PUBLIC_API_PROXY: z.enum(['true', 'false']).default('false'),
  /** Base URL of the external help/docs site (no trailing slash). Unset = links hidden. */
  NEXT_PUBLIC_HELP_BASE_URL: z.string().url().optional(),
  /** Where "Contact support" points. Unset = the entry is hidden. */
  NEXT_PUBLIC_SUPPORT_EMAIL: z.string().email().optional(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function parseWebEnv(source: Record<string, string | undefined>): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}
