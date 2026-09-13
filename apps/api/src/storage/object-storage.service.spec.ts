import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseServerEnv } from '@aivoryx/config';
import { AppError } from '@aivoryx/shared';
import { buildEntityAttachmentKey, buildVisitAttachmentKey } from './object-storage.service.js';

describe('buildEntityAttachmentKey / buildVisitAttachmentKey', () => {
  it('namespaces the key by tenant and entity, and keeps the extension', () => {
    const key = buildEntityAttachmentKey('tenant-1', 'hr-documents', 'emp-1', 'passport.pdf');
    expect(key).toMatch(/^tenants\/tenant-1\/hr-documents\/emp-1\/[0-9a-f-]{36}\.pdf$/);
  });

  it('strips unsafe characters from a crafted filename extension so it cannot inject path segments', () => {
    const key = buildEntityAttachmentKey('t1', 'visits', 'v1', 'photo.jpg/../../etc/passwd');
    expect(key.startsWith('tenants/t1/visits/v1/')).toBe(true);
    // everything after the generated UUID must be alphanumeric + dots only —
    // no slash, no '..', regardless of what the caller's filename contained.
    const suffix = key.split('/').pop()!;
    expect(suffix).toMatch(/^[0-9a-f-]{36}[a-zA-Z0-9.]*$/);
  });

  it('buildVisitAttachmentKey is buildEntityAttachmentKey scoped to "visits"', () => {
    const key = buildVisitAttachmentKey('t1', 'visit-9', 'photo.jpg');
    expect(key).toMatch(/^tenants\/t1\/visits\/visit-9\/[0-9a-f-]{36}\.jpg$/);
  });
});

describe('LocalFilesystemObjectStorageService', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'aivoryx-storage-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function localAdapter() {
    const env = parseServerEnv({
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/aivoryx',
      REDIS_URL: 'redis://localhost:6379',
      SESSION_SECRET: 'x'.repeat(40),
      OBJECT_STORAGE_LOCAL_DIR: dir,
    } as NodeJS.ProcessEnv);
    const { LocalFilesystemObjectStorageService } = await import('./object-storage.service.js');
    return new LocalFilesystemObjectStorageService(env);
  }

  it('round-trips a put object through get, preserving body and content type', async () => {
    const storage = await localAdapter();
    await storage.putObject({
      key: 'a/b/c.png',
      body: Buffer.from('hello'),
      contentType: 'image/png',
    });
    const result = await storage.getObject('a/b/c.png');
    expect(result).toEqual({ body: Buffer.from('hello'), contentType: 'image/png' });
  });

  it('returns null for a key that was never stored', async () => {
    const storage = await localAdapter();
    await expect(storage.getObject('never/stored.png')).resolves.toBeNull();
  });

  it('delete removes the object so a subsequent get returns null', async () => {
    const storage = await localAdapter();
    await storage.putObject({
      key: 'x.pdf',
      body: Buffer.from('doc'),
      contentType: 'application/pdf',
    });
    await storage.deleteObject('x.pdf');
    await expect(storage.getObject('x.pdf')).resolves.toBeNull();
  });

  it('rejects a key that would escape the storage root', async () => {
    const storage = await localAdapter();
    await expect(
      storage.putObject({
        key: '../../etc/passwd',
        body: Buffer.from('x'),
        contentType: 'text/plain',
      }),
    ).rejects.toThrow(AppError);
  });
});
