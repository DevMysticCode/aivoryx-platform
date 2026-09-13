import { describe, expect, it } from 'vitest';
import { parseServerEnv } from '@aivoryx/config';
import { LocalFilesystemObjectStorageService } from './object-storage.service.js';
import { S3ObjectStorageService } from './s3-object-storage.service.js';
import { selectObjectStorageProvider } from './storage.module.js';

const base = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/aivoryx',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'x'.repeat(40),
};

describe('selectObjectStorageProvider', () => {
  it('selects the local filesystem adapter by default', () => {
    const env = parseServerEnv(base as NodeJS.ProcessEnv);
    expect(selectObjectStorageProvider(env)).toBeInstanceOf(LocalFilesystemObjectStorageService);
  });

  it('selects the local filesystem adapter when explicitly configured', () => {
    const env = parseServerEnv({ ...base, OBJECT_STORAGE_PROVIDER: 'local' } as NodeJS.ProcessEnv);
    expect(selectObjectStorageProvider(env)).toBeInstanceOf(LocalFilesystemObjectStorageService);
  });

  it('selects the S3 adapter when OBJECT_STORAGE_PROVIDER=s3 with valid configuration', () => {
    const env = parseServerEnv({
      ...base,
      OBJECT_STORAGE_PROVIDER: 's3',
      OBJECT_STORAGE_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com',
      OBJECT_STORAGE_BUCKET: 'aivoryx-test',
      OBJECT_STORAGE_ACCESS_KEY_ID: 'key-id',
      OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
    } as NodeJS.ProcessEnv);
    expect(selectObjectStorageProvider(env)).toBeInstanceOf(S3ObjectStorageService);
  });

  it('an invalid provider value is rejected at env-parse time, before selection ever runs', () => {
    expect(() =>
      parseServerEnv({ ...base, OBJECT_STORAGE_PROVIDER: 'azure-blob' } as NodeJS.ProcessEnv),
    ).toThrow(/OBJECT_STORAGE_PROVIDER/);
  });

  it('OBJECT_STORAGE_PROVIDER=s3 with missing S3 configuration is rejected at env-parse time', () => {
    expect(() =>
      parseServerEnv({ ...base, OBJECT_STORAGE_PROVIDER: 's3' } as NodeJS.ProcessEnv),
    ).toThrow(/required when OBJECT_STORAGE_PROVIDER=s3/);
  });
});
