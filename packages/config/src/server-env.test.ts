import { describe, expect, it } from 'vitest';
import { parseServerEnv } from './server-env.js';
import { parseWebEnv } from './web-env.js';

const baseValid = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/aivoryx',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'x'.repeat(40),
};

describe('parseServerEnv', () => {
  it('parses a minimal valid environment with defaults applied', () => {
    const env = parseServerEnv(baseValid as NodeJS.ProcessEnv);
    expect(env.APP_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.DATABASE_POOL_MAX).toBe(10);
  });

  it('splits CORS origins on comma', () => {
    const env = parseServerEnv({
      ...baseValid,
      CORS_ALLOWED_ORIGINS: 'http://a.test, http://b.test ,http://c.test',
    } as NodeJS.ProcessEnv);
    expect(env.CORS_ALLOWED_ORIGINS).toEqual(['http://a.test', 'http://b.test', 'http://c.test']);
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => parseServerEnv({ REDIS_URL: baseValid.REDIS_URL } as NodeJS.ProcessEnv)).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a short SESSION_SECRET', () => {
    expect(() =>
      parseServerEnv({ ...baseValid, SESSION_SECRET: 'too-short' } as NodeJS.ProcessEnv),
    ).toThrow(/SESSION_SECRET/);
  });

  it('rejects the placeholder secret in production', () => {
    expect(() =>
      parseServerEnv({
        ...baseValid,
        APP_ENV: 'production',
        NODE_ENV: 'production',
        SESSION_SECRET: 'change-me-generate-a-long-random-value-000',
      } as NodeJS.ProcessEnv),
    ).toThrow(/SESSION_SECRET/);
  });
});

describe('parseWebEnv', () => {
  it('parses NEXT_PUBLIC_* values with defaults', () => {
    const env = parseWebEnv({});
    expect(env.NEXT_PUBLIC_API_BASE_URL).toBe('http://localhost:4000');
    expect(env.NEXT_PUBLIC_APP_ENV).toBe('development');
  });

  it('rejects a non-URL API base', () => {
    expect(() => parseWebEnv({ NEXT_PUBLIC_API_BASE_URL: 'not-a-url' })).toThrow();
  });
});
