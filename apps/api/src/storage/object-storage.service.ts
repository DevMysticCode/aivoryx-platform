import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { type ServerEnv } from '@aivoryx/config';
import { AppError } from '@aivoryx/shared';
import { SERVER_ENV } from '../config/config.module.js';

/**
 * Object storage abstraction (ADR 0015). Callers depend on this interface
 * only — never on a specific provider. V1 (Phase 4, ADR 0033) ships a local
 * filesystem adapter, which is development-safe and keeps large binaries out
 * of Postgres; a real S3/R2-compatible adapter can be swapped in later
 * without touching any caller. Downloads go through an authenticated API
 * route rather than a signed URL, since a local adapter has no bucket to
 * sign against — this is at least as strong a security boundary for V1.
 */
export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface ObjectStorageService {
  putObject(input: PutObjectInput): Promise<void>;
  getObject(key: string): Promise<StoredObject | null>;
  deleteObject(key: string): Promise<void>;
}

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

/** A tenant/visit-prefixed key so paths are namespaced by construction —
 *  authorization still comes from the DB row, never from key secrecy alone. */
export function buildVisitAttachmentKey(
  tenantId: string,
  visitId: string,
  filename: string,
): string {
  const ext = path
    .extname(filename)
    .slice(0, 10)
    .replace(/[^a-zA-Z0-9.]/g, '');
  return `tenants/${tenantId}/visits/${visitId}/${randomUUID()}${ext}`;
}

@Injectable()
export class LocalFilesystemObjectStorageService implements ObjectStorageService {
  private readonly root: string;

  constructor(@Inject(SERVER_ENV) env: ServerEnv) {
    this.root = path.resolve(process.cwd(), env.OBJECT_STORAGE_LOCAL_DIR);
  }

  async putObject(input: PutObjectInput): Promise<void> {
    const filePath = this.resolveSafe(input.key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.body);
    await fs.writeFile(`${filePath}.meta.json`, JSON.stringify({ contentType: input.contentType }));
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const filePath = this.resolveSafe(key);
    try {
      const [body, metaRaw] = await Promise.all([
        fs.readFile(filePath),
        fs.readFile(`${filePath}.meta.json`, 'utf8').catch(() => '{}'),
      ]);
      const meta = JSON.parse(metaRaw) as { contentType?: string };
      return { body, contentType: meta.contentType ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  async deleteObject(key: string): Promise<void> {
    const filePath = this.resolveSafe(key);
    await fs.rm(filePath, { force: true });
    await fs.rm(`${filePath}.meta.json`, { force: true });
  }

  /** Rejects any key that would escape the storage root (defense in depth —
   *  keys are always server-generated via `buildVisitAttachmentKey`). */
  private resolveSafe(key: string): string {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(this.root + path.sep) && resolved !== this.root) {
      throw new AppError('ATTACHMENT_INVALID');
    }
    return resolved;
  }
}
