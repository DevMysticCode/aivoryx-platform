import { z } from 'zod';
import { appEnvSchema, formatEnvError, logLevelSchema } from './shared.js';

/**
 * SERVER-ONLY environment. Never import this from browser code — it describes
 * secrets (DATABASE_URL, REDIS_URL, SESSION_SECRET, object-storage keys).
 * The web bundle may only read `web-env.ts` (NEXT_PUBLIC_* values).
 */
export const serverEnvSchema = z
  .object({
    APP_ENV: appEnvSchema.default('development'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: logLevelSchema,

    API_PORT: z.coerce.number().int().positive().max(65535).default(4000),
    API_BASE_URL: z.string().url().default('http://localhost:4000'),

    // comma-separated origin list -> string[]
    CORS_ALLOWED_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((raw) =>
        raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),

    DATABASE_URL: z.string().url().startsWith('postgres'),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
    /**
     * Non-privileged PostgreSQL role the API runs its queries as (ADR 0027).
     * The connection `SET ROLE`s to this after connecting so Row Level Security
     * always applies. Created by migration `0003`. Must NOT be a superuser and
     * must NOT have BYPASSRLS.
     */
    DATABASE_APP_ROLE: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/i, 'DATABASE_APP_ROLE must be a plain SQL identifier')
      .default('aivoryx_app'),

    REDIS_URL: z.string().url().startsWith('redis'),

    SESSION_SECRET: z
      .string()
      .min(32, 'SESSION_SECRET must be at least 32 characters of random data'),
    SESSION_COOKIE_NAME: z.string().min(1).default('aivoryx_session'),
    /** Absolute session lifetime — enforced server-side against `sessions.expires_at`. */
    SESSION_ABSOLUTE_TTL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 365)
      .default(720),
    /** Idle timeout — a session unused for this long is rejected (`last_seen_at`). */
    SESSION_IDLE_TTL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 90)
      .default(168),
    /**
     * Cookie `Secure` flag. Defaults to off only in `development`. Never send the
     * session cookie over plain HTTP outside local dev.
     */
    SESSION_COOKIE_SECURE: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    SESSION_COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),

    // Argon2id parameters (ADR 0010 / 0028). OWASP-aligned defaults; a change
    // triggers transparent rehash-on-login.
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).max(1_048_576).default(19_456),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).max(10).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(16).default(1),

    /** How long a tenant invitation stays acceptable (ADR 0030). */
    INVITATION_TTL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 30)
      .default(168),

    // Object storage is optional in Phase 1 (local storage deferred).
    OBJECT_STORAGE_ENDPOINT: z
      .string()
      .url()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    OBJECT_STORAGE_REGION: z.string().default('auto'),
    OBJECT_STORAGE_BUCKET: z
      .string()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    OBJECT_STORAGE_ACCESS_KEY_ID: z
      .string()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    OBJECT_STORAGE_SECRET_ACCESS_KEY: z
      .string()
      .optional()
      .or(z.literal('').transform(() => undefined)),

    /** Local-filesystem object storage adapter (Phase 4, ADR 0033/ADR 0015). Used
     *  whenever OBJECT_STORAGE_ENDPOINT is unset — an S3/R2 adapter can be swapped
     *  in later behind the same `ObjectStorageService` interface. */
    OBJECT_STORAGE_LOCAL_DIR: z.string().default('.data/object-storage'),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV === 'production' && env.SESSION_SECRET.includes('change-me')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET is still the placeholder value in a production environment',
      });
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(formatEnvError(result.error));
  }
  return result.data;
}

let cached: ServerEnv | undefined;

/** Parse once and reuse. Throws a readable error on first call if invalid. */
export function loadServerEnv(): ServerEnv {
  cached ??= parseServerEnv();
  return cached;
}

/** Test helper — drop the memoized value. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
