import { describe, expect, it, vi, beforeEach } from 'vitest';
import { parseServerEnv } from '@aivoryx/config';
import { AppError } from '@aivoryx/shared';

const send = vi.fn();

vi.mock('@aws-sdk/client-s3', () => {
  class FakeS3Client {
    constructor(public readonly config: unknown) {}
    send(...args: unknown[]) {
      return send(...args);
    }
  }
  class FakeCommand {
    constructor(public readonly input: unknown) {}
  }
  return {
    S3Client: FakeS3Client,
    PutObjectCommand: class extends FakeCommand {},
    GetObjectCommand: class extends FakeCommand {},
    DeleteObjectCommand: class extends FakeCommand {},
  };
});

const { S3ObjectStorageService } = await import('./s3-object-storage.service.js');

function s3Env() {
  return parseServerEnv({
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/aivoryx',
    REDIS_URL: 'redis://localhost:6379',
    SESSION_SECRET: 'x'.repeat(40),
    OBJECT_STORAGE_PROVIDER: 's3',
    OBJECT_STORAGE_ENDPOINT: 'https://abc123.r2.cloudflarestorage.com',
    OBJECT_STORAGE_BUCKET: 'aivoryx-test',
    OBJECT_STORAGE_ACCESS_KEY_ID: 'key-id',
    OBJECT_STORAGE_SECRET_ACCESS_KEY: 'secret',
  } as NodeJS.ProcessEnv);
}

describe('S3ObjectStorageService', () => {
  beforeEach(() => {
    send.mockReset();
  });

  it('configures the client for path-style addressing, the configured endpoint/region, and credentials from env', () => {
    const storage = new S3ObjectStorageService(s3Env()) as unknown as {
      client: { config: { forcePathStyle: boolean; region: string; endpoint: string } };
    };
    expect(storage.client.config).toMatchObject({
      forcePathStyle: true,
      region: 'auto',
      endpoint: 'https://abc123.r2.cloudflarestorage.com',
    });
  });

  it('putObject sends a PutObjectCommand with the key, body, and content type', async () => {
    send.mockResolvedValueOnce({});
    const storage = new S3ObjectStorageService(s3Env());
    await storage.putObject({
      key: 'tenants/t1/logos/abc.png',
      body: Buffer.from('fake-png'),
      contentType: 'image/png',
    });
    expect(send).toHaveBeenCalledTimes(1);
    const command = send.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      Bucket: 'aivoryx-test',
      Key: 'tenants/t1/logos/abc.png',
      ContentType: 'image/png',
      ContentLength: 8,
    });
  });

  it('putObject failure is normalized to a safe AppError, never the raw SDK error', async () => {
    send.mockRejectedValueOnce(new Error('AccessDenied: some AWS-specific detail'));
    const storage = new S3ObjectStorageService(s3Env());
    await expect(
      storage.putObject({ key: 'k', body: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('getObject returns the body and content type on success', async () => {
    send.mockResolvedValueOnce({
      ContentType: 'application/pdf',
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    });
    const storage = new S3ObjectStorageService(s3Env());
    const result = await storage.getObject('tenants/t1/docs/x.pdf');
    expect(result).toEqual({ body: Buffer.from([1, 2, 3]), contentType: 'application/pdf' });
  });

  it('getObject returns null for a missing key (NoSuchKey), matching the local adapter contract', async () => {
    const notFound = new Error('The specified key does not exist.');
    notFound.name = 'NoSuchKey';
    send.mockRejectedValueOnce(notFound);
    const storage = new S3ObjectStorageService(s3Env());
    await expect(storage.getObject('missing')).resolves.toBeNull();
  });

  it('getObject propagates a genuine backend failure as SERVICE_UNAVAILABLE, not null', async () => {
    send.mockRejectedValueOnce(new Error('connection reset'));
    const storage = new S3ObjectStorageService(s3Env());
    await expect(storage.getObject('k')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('deleteObject sends a DeleteObjectCommand for the given key', async () => {
    send.mockResolvedValueOnce({});
    const storage = new S3ObjectStorageService(s3Env());
    await storage.deleteObject('tenants/t1/logos/abc.png');
    const command = send.mock.calls[0]![0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      Bucket: 'aivoryx-test',
      Key: 'tenants/t1/logos/abc.png',
    });
  });

  it('deleteObject failure is normalized to SERVICE_UNAVAILABLE', async () => {
    send.mockRejectedValueOnce(new Error('timeout'));
    const storage = new S3ObjectStorageService(s3Env());
    await expect(storage.deleteObject('k')).rejects.toBeInstanceOf(AppError);
  });
});
