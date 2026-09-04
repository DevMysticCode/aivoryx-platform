import { z } from 'zod';

/** Deployment/runtime environment. */
export const appEnvSchema = z.enum(['development', 'test', 'staging', 'production']);
export type AppEnv = z.infer<typeof appEnvSchema>;

export const logLevelSchema = z
  .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  .default('info');

/**
 * Format a ZodError into a single readable, multi-line message. Used so a
 * misconfigured environment fails fast with an actionable message instead of a
 * deep stack trace (CLAUDE.md §9).
 */
export function formatEnvError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.join('.') || '(root)';
    return `  - ${path}: ${issue.message}`;
  });
  return `Invalid environment configuration:\n${lines.join('\n')}`;
}
