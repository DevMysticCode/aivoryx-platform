import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { type ServerEnv } from '@aivoryx/config';
import { AppError } from '@aivoryx/shared';
import { SERVER_ENV } from '../config/config.module.js';
import { getCorrelationId } from '../observability/correlation.js';
import type {
  ObjectStorageService,
  PutObjectInput,
  StoredObject,
} from './object-storage.service.js';

/** Never log the raw error object — it can carry request metadata we don't
 *  need in a log line. Keep only what's useful to diagnose a failure. */
function safeErrorMeta(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: 'UnknownError', message: String(err) };
}

/**
 * S3-compatible object storage adapter (deployment hardening) — the same
 * `ObjectStorageService` interface every caller already depends on
 * (`object-storage.service.ts`), backed by any S3-compatible provider via the
 * official `@aws-sdk/client-s3` client. Cloudflare R2 is the first target,
 * but nothing here is R2-specific: `forcePathStyle` and a configurable
 * `endpoint`/`region` are what make an S3-compatible (non-AWS) provider work
 * at all, not an R2 special case.
 *
 * Selected only when `OBJECT_STORAGE_PROVIDER=s3` (see `storage.module.ts`).
 * The environment schema's `superRefine` (`@aivoryx/config`) already
 * guarantees endpoint/bucket/credentials are present whenever this class is
 * constructed — the non-null assertions below rely on that already-enforced
 * invariant, not a fresh assumption made here.
 */
@Injectable()
export class S3ObjectStorageService implements ObjectStorageService {
  private readonly logger = new Logger('S3ObjectStorage');
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(SERVER_ENV) env: ServerEnv) {
    this.bucket = env.OBJECT_STORAGE_BUCKET!;
    this.client = new S3Client({
      region: env.OBJECT_STORAGE_REGION,
      endpoint: env.OBJECT_STORAGE_ENDPOINT,
      // Required by R2 and most non-AWS S3-compatible providers, harmless for
      // real AWS S3 too — path-style addressing (`endpoint/bucket/key`)
      // rather than virtual-hosted-style (`bucket.endpoint/key`), which R2's
      // per-account endpoint does not support.
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY_ID!,
        secretAccessKey: env.OBJECT_STORAGE_SECRET_ACCESS_KEY!,
      },
    });
  }

  async putObject(input: PutObjectInput): Promise<void> {
    const start = Date.now();
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ContentLength: input.body.length,
        }),
      );
      this.logger.debug({
        operation: 'put',
        provider: 's3',
        bytes: input.body.length,
        durationMs: Date.now() - start,
        correlationId: getCorrelationId(),
      });
    } catch (err) {
      this.logger.error(
        {
          operation: 'put',
          provider: 's3',
          err: safeErrorMeta(err),
          correlationId: getCorrelationId(),
        },
        'object storage put failed',
      );
      throw new AppError('SERVICE_UNAVAILABLE');
    }
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const start = Date.now();
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) return null;
      const body = Buffer.from(bytes);
      this.logger.debug({
        operation: 'get',
        provider: 's3',
        bytes: body.length,
        durationMs: Date.now() - start,
        correlationId: getCorrelationId(),
      });
      return { body, contentType: res.ContentType ?? 'application/octet-stream' };
    } catch (err) {
      if (isNotFoundError(err)) return null;
      this.logger.error(
        {
          operation: 'get',
          provider: 's3',
          err: safeErrorMeta(err),
          correlationId: getCorrelationId(),
        },
        'object storage get failed',
      );
      throw new AppError('SERVICE_UNAVAILABLE');
    }
  }

  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
      this.logger.debug({ operation: 'delete', provider: 's3', correlationId: getCorrelationId() });
    } catch (err) {
      this.logger.error(
        {
          operation: 'delete',
          provider: 's3',
          err: safeErrorMeta(err),
          correlationId: getCorrelationId(),
        },
        'object storage delete failed',
      );
      throw new AppError('SERVICE_UNAVAILABLE');
    }
  }
}

/** S3 (and R2) raise a modeled `NoSuchKey` — surfaced as `null`, matching the
 *  local filesystem adapter's "missing file -> null" contract exactly. */
function isNotFoundError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'NoSuchKey' || err.name === 'NotFound');
}
