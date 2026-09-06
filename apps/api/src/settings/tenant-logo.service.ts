import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OBJECT_STORAGE, type ObjectStorageService } from '../storage/object-storage.service.js';
import type { TenantScope } from '../supply/common.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { ImageValidationError, readImageMeta } from './image-meta.js';

const { tenantAssets } = schema;

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 4000;
const MIN_DIMENSION = 16;
type LogoKind = schema.TenantAssetRow['kind'];

/**
 * Tenant logo / favicon upload, removal and authenticated read (Phase 10,
 * ADR 0039). Bytes live in the Phase 4 object storage under a tenant-namespaced
 * opaque key; only that key is persisted. The declared MIME type is never
 * trusted — the format is sniffed from the file header (PNG / JPEG / WebP
 * only) and dimensions are validated. Reads are streamed through an
 * authenticated route scoped to the caller's active tenant; the key is never
 * exposed.
 */
@Injectable()
export class TenantLogoService {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService,
    private readonly audit: AuditService,
  ) {}

  async upload(
    scope: TenantScope,
    kind: LogoKind,
    file: { buffer: Buffer; contentType: string; originalFilename: string | null; size: number },
  ): Promise<{ kind: LogoKind; width: number; height: number }> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new AppError('LOGO_INVALID', { details: { reason: 'empty' } });
    }
    if (file.size > MAX_BYTES || file.buffer.length > MAX_BYTES) {
      throw new AppError('LOGO_INVALID', {
        details: { reason: 'file_too_large', maxBytes: MAX_BYTES },
      });
    }

    let meta;
    try {
      meta = readImageMeta(file.buffer);
    } catch (err) {
      const reason = err instanceof ImageValidationError ? err.reason : 'unreadable';
      throw new AppError('LOGO_INVALID', { details: { reason } });
    }
    // the sniffed format is authoritative; a mismatched declared type is a red flag
    if (file.contentType && file.contentType.toLowerCase() !== meta.format) {
      throw new AppError('LOGO_INVALID', {
        details: {
          reason: 'content_type_mismatch',
          declared: file.contentType,
          actual: meta.format,
        },
      });
    }
    if (
      meta.width < MIN_DIMENSION ||
      meta.height < MIN_DIMENSION ||
      meta.width > MAX_DIMENSION ||
      meta.height > MAX_DIMENSION
    ) {
      throw new AppError('LOGO_INVALID', {
        details: { reason: 'bad_dimensions', width: meta.width, height: meta.height },
      });
    }

    const ext = meta.format === 'image/png' ? 'png' : meta.format === 'image/jpeg' ? 'jpg' : 'webp';
    const key = `tenants/${scope.tenantId}/branding/${kind}/${randomUUID()}.${ext}`;

    return withTenantContext(getDb(), scope, async (tx) => {
      const [existing] = await tx
        .select({ objectKey: tenantAssets.objectKey })
        .from(tenantAssets)
        .where(and(eq(tenantAssets.tenantId, scope.tenantId), eq(tenantAssets.kind, kind)))
        .limit(1);

      await this.storage.putObject({ key, body: file.buffer, contentType: meta.format });

      await tx
        .insert(tenantAssets)
        .values({
          tenantId: scope.tenantId,
          kind,
          objectKey: key,
          contentType: meta.format,
          sizeBytes: file.buffer.length,
          width: meta.width,
          height: meta.height,
          originalFilename: file.originalFilename?.slice(0, 200) ?? null,
          uploadedByMembershipId: scope.actorMembershipId,
        })
        .onConflictDoUpdate({
          target: [tenantAssets.tenantId, tenantAssets.kind],
          set: {
            objectKey: key,
            contentType: meta.format,
            sizeBytes: file.buffer.length,
            width: meta.width,
            height: meta.height,
            originalFilename: file.originalFilename?.slice(0, 200) ?? null,
            uploadedByMembershipId: scope.actorMembershipId,
            updatedAt: new Date(),
          },
        });

      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'settings.logo.updated',
        entityType: 'tenant_asset',
        entityId: null,
        actor: userActor(scope),
        metadata: {
          kind,
          operation: existing ? 'replaced' : 'added',
          contentType: meta.format,
          width: meta.width,
          height: meta.height,
        },
      });

      // best-effort cleanup of the previous object (the DB row is authoritative)
      if (existing && existing.objectKey !== key) {
        await this.storage.deleteObject(existing.objectKey).catch(() => undefined);
      }
      return { kind, width: meta.width, height: meta.height };
    });
  }

  async remove(scope: TenantScope, kind: LogoKind): Promise<void> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select({ objectKey: tenantAssets.objectKey })
        .from(tenantAssets)
        .where(and(eq(tenantAssets.tenantId, scope.tenantId), eq(tenantAssets.kind, kind)))
        .limit(1);
      if (!row) throw new AppError('LOGO_NOT_FOUND', { details: { kind } });
      await tx
        .delete(tenantAssets)
        .where(and(eq(tenantAssets.tenantId, scope.tenantId), eq(tenantAssets.kind, kind)));
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'settings.logo.updated',
        entityType: 'tenant_asset',
        entityId: null,
        actor: userActor(scope),
        metadata: { kind, operation: 'removed' },
      });
      await this.storage.deleteObject(row.objectKey).catch(() => undefined);
    });
  }

  /** Authenticated read for the caller's active tenant — no key in the URL. */
  async read(
    scope: { tenantId: string; userId: string },
    kind: LogoKind,
  ): Promise<{ body: Buffer; contentType: string } | null> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select({ objectKey: tenantAssets.objectKey, contentType: tenantAssets.contentType })
        .from(tenantAssets)
        .where(and(eq(tenantAssets.tenantId, scope.tenantId), eq(tenantAssets.kind, kind)))
        .limit(1);
      if (!row) return null;
      const obj = await this.storage.getObject(row.objectKey);
      return obj ? { body: obj.body, contentType: obj.contentType || row.contentType } : null;
    });
  }
}
