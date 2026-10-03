import { describe, expect, it } from 'vitest';
import { parseServerEnv } from './server-env.js';
import { parseWebEnv } from './web-env.js';

const baseValid = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/aivoryx',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'x'.repeat(40),
};

describe('parseServerEnv', () => {
  describe('webhook hardening + retention (UC-1)', () => {
    it('applies documented safe defaults', () => {
      const env = parseServerEnv(baseValid as NodeJS.ProcessEnv);
      expect(env.WEBHOOK_MAX_BODY_BYTES).toBe(262_144);
      expect(env.WEBHOOK_RATE_LIMIT_MAX).toBe(120);
      expect(env.WEBHOOK_RATE_LIMIT_WINDOW_SECONDS).toBe(60);
      expect(env.RAW_EVENT_RETENTION_DAYS).toBe(30);
      expect(env.RAW_EVENT_PURGE_BATCH_SIZE).toBe(500);
      expect(env.RAW_EVENT_PURGE_INTERVAL_MINUTES).toBe(60);
      expect(env.RAW_EVENT_PURGE_ENABLED).toBe(true);
    });

    it('accepts overrides', () => {
      const env = parseServerEnv({
        ...baseValid,
        WEBHOOK_MAX_BODY_BYTES: '2048',
        WEBHOOK_RATE_LIMIT_MAX: '5',
        WEBHOOK_RATE_LIMIT_WINDOW_SECONDS: '10',
        RAW_EVENT_RETENTION_DAYS: '7',
        RAW_EVENT_PURGE_BATCH_SIZE: '50',
        RAW_EVENT_PURGE_INTERVAL_MINUTES: '5',
        RAW_EVENT_PURGE_ENABLED: 'false',
      } as NodeJS.ProcessEnv);
      expect(env).toMatchObject({
        WEBHOOK_MAX_BODY_BYTES: 2048,
        WEBHOOK_RATE_LIMIT_MAX: 5,
        WEBHOOK_RATE_LIMIT_WINDOW_SECONDS: 10,
        RAW_EVENT_RETENTION_DAYS: 7,
        RAW_EVENT_PURGE_BATCH_SIZE: 50,
        RAW_EVENT_PURGE_INTERVAL_MINUTES: 5,
        RAW_EVENT_PURGE_ENABLED: false,
      });
    });

    it.each([
      ['WEBHOOK_MAX_BODY_BYTES', '10'],
      ['WEBHOOK_MAX_BODY_BYTES', '999999999'],
      ['WEBHOOK_MAX_BODY_BYTES', 'lots'],
      ['WEBHOOK_RATE_LIMIT_MAX', '0'],
      ['WEBHOOK_RATE_LIMIT_WINDOW_SECONDS', '-1'],
      ['RAW_EVENT_RETENTION_DAYS', '0'],
      ['RAW_EVENT_PURGE_BATCH_SIZE', '0'],
      ['RAW_EVENT_PURGE_BATCH_SIZE', '100000'],
      ['RAW_EVENT_PURGE_INTERVAL_MINUTES', '0'],
      ['RAW_EVENT_PURGE_ENABLED', 'maybe'],
    ])('rejects invalid %s=%s (never silently accepted)', (key, value) => {
      expect(() => parseServerEnv({ ...baseValid, [key]: value } as NodeJS.ProcessEnv)).toThrow(
        new RegExp(key),
      );
    });
  });

  describe('CONNECTOR_CREDENTIAL_ENCRYPTION_KEY (UC-3)', () => {
    it('defaults to the obvious placeholder (32 zero bytes, hex)', () => {
      const env = parseServerEnv(baseValid as NodeJS.ProcessEnv);
      expect(env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY).toBe('00'.repeat(32));
    });

    it('accepts a real 64-hex-char (32-byte) key', () => {
      const key = 'ab'.repeat(32);
      const env = parseServerEnv({
        ...baseValid,
        CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: key,
      } as NodeJS.ProcessEnv);
      expect(env.CONNECTOR_CREDENTIAL_ENCRYPTION_KEY).toBe(key);
    });

    it.each(['too-short', 'zz'.repeat(32), 'ab'.repeat(31), 'ab'.repeat(33)])(
      'rejects a malformed key (%s)',
      (bad) => {
        expect(() =>
          parseServerEnv({
            ...baseValid,
            CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: bad,
          } as NodeJS.ProcessEnv),
        ).toThrow(/CONNECTOR_CREDENTIAL_ENCRYPTION_KEY/);
      },
    );

    it('flags the placeholder key in production, like SESSION_SECRET', () => {
      expect(() =>
        parseServerEnv({ ...baseValid, APP_ENV: 'production' } as NodeJS.ProcessEnv),
      ).toThrow(/CONNECTOR_CREDENTIAL_ENCRYPTION_KEY/);
    });

    it('accepts a real key in production', () => {
      expect(() =>
        parseServerEnv({
          ...baseValid,
          APP_ENV: 'production',
          SESSION_SECRET: 'y'.repeat(40),
          CONNECTOR_CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32),
        } as NodeJS.ProcessEnv),
      ).not.toThrow();
    });
  });

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

  it('defaults OBJECT_STORAGE_PROVIDER to local, with no S3 config required', () => {
    const env = parseServerEnv(baseValid as NodeJS.ProcessEnv);
    expect(env.OBJECT_STORAGE_PROVIDER).toBe('local');
    expect(env.OBJECT_STORAGE_LOCAL_DIR).toBe('.data/object-storage');
  });

  it('accepts OBJECT_STORAGE_PROVIDER=s3 with every required S3 variable set', () => {
    const env = parseServerEnv({
      ...baseValid,
      OBJECT_STORAGE_PROVIDER: 's3',
      OBJECT_STORAGE_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com',
      OBJECT_STORAGE_BUCKET: 'aivoryx-staging',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'key-id',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
    } as NodeJS.ProcessEnv);
    expect(env.OBJECT_STORAGE_PROVIDER).toBe('s3');
    expect(env.OBJECT_STORAGE_REGION).toBe('auto');
  });

  it('rejects OBJECT_STORAGE_PROVIDER=s3 with no S3 configuration at all', () => {
    expect(() =>
      parseServerEnv({ ...baseValid, OBJECT_STORAGE_PROVIDER: 's3' } as NodeJS.ProcessEnv),
    ).toThrow(
      /OBJECT_STORAGE_ENDPOINT.*OBJECT_STORAGE_BUCKET.*OBJECT_STORAGE_ACCESS_KEY_ID.*OBJECT_STORAGE_SECRET_ACCESS_KEY/s,
    );
  });

  it('rejects OBJECT_STORAGE_PROVIDER=s3 missing just the bucket, naming exactly that field', () => {
    expect(() =>
      parseServerEnv({
        ...baseValid,
        OBJECT_STORAGE_PROVIDER: 's3',
        OBJECT_STORAGE_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com',
        OBJECT_STORAGE_ACCESS_KEY_ID: 'key-id',
        OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
      } as NodeJS.ProcessEnv),
    ).toThrow(/OBJECT_STORAGE_BUCKET is required when OBJECT_STORAGE_PROVIDER=s3/);
  });

  it('never requires S3 configuration when the provider stays local', () => {
    const env = parseServerEnv({
      ...baseValid,
      OBJECT_STORAGE_PROVIDER: 'local',
    } as NodeJS.ProcessEnv);
    expect(env.OBJECT_STORAGE_ENDPOINT).toBeUndefined();
    expect(env.OBJECT_STORAGE_BUCKET).toBeUndefined();
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
