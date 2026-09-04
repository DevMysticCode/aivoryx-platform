import { z } from 'zod';
import { appEnvSchema, formatEnvError } from './shared.js';

/**
 * BROWSER-SAFE environment. Only `NEXT_PUBLIC_*` values, all non-sensitive.
 * Next.js inlines these at build time, so anything here ships to the client.
 */
export const webEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default('http://localhost:4000'),
  NEXT_PUBLIC_APP_ENV: appEnvSchema.default('development'),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function parseWebEnv(source: Record<string, string | undefined>): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}
