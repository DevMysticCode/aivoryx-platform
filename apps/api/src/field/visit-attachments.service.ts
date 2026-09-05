import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import {
  buildVisitAttachmentKey,
  OBJECT_STORAGE,
  type ObjectStorageService,
  type StoredObject,
} from '../storage/object-storage.service.js';
import { recordVisitActivity } from './visit-activities.js';
import type { TenantScope, VisitVisibility } from './visits.service.js';
import { VisitsService } from './visits.service.js';

const { visitAttachments } = schema;

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

export interface VisitAttachmentView {
  id: string;
  visitId: string;
  originalFilename: string | null;
  contentType: string;
  fileSize: number;
  uploadedByMembershipId: string | null;
  createdAt: string;
}

export interface UploadAttachmentInput {
  buffer: Buffer;
  originalFilename: string;
  contentType: string;
  size: number;
}

/**
 * Visit photo/attachment metadata (Phase 4, ADR 0033). Bytes live in the
 * object storage service, never in Postgres; this table is metadata-only.
 */
@Injectable()
export class VisitAttachmentsService {
  constructor(
    private readonly visits: VisitsService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService,
  ) {}

  async list(
    scope: TenantScope,
    visitId: string,
    visibility: VisitVisibility,
  ): Promise<VisitAttachmentView[]> {
    await this.visits.get(scope, visitId, visibility);
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(visitAttachments)
        .where(
          and(eq(visitAttachments.tenantId, scope.tenantId), eq(visitAttachments.visitId, visitId)),
        );
      return rows.map(toView);
    });
  }

  async upload(
    scope: TenantScope,
    visitId: string,
    input: UploadAttachmentInput,
    visibility: VisitVisibility,
  ): Promise<VisitAttachmentView> {
    await this.visits.get(scope, visitId, visibility);

    if (input.size > MAX_ATTACHMENT_BYTES) {
      throw new AppError('ATTACHMENT_INVALID', {
        details: { reason: 'file_too_large', maxBytes: MAX_ATTACHMENT_BYTES },
      });
    }
    if (!ALLOWED_CONTENT_TYPES.has(input.contentType)) {
      throw new AppError('ATTACHMENT_INVALID', {
        details: { reason: 'unsupported_content_type', contentType: input.contentType },
      });
    }

    const objectKey = buildVisitAttachmentKey(scope.tenantId, visitId, input.originalFilename);
    await this.storage.putObject({
      key: objectKey,
      body: input.buffer,
      contentType: input.contentType,
    });

    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .insert(visitAttachments)
        .values({
          tenantId: scope.tenantId,
          visitId,
          objectKey,
          originalFilename: input.originalFilename,
          contentType: input.contentType,
          fileSize: input.size,
          uploadedByMembershipId: scope.actorMembershipId,
        })
        .returning();
      if (!row) throw new AppError('INTERNAL_ERROR');

      await recordVisitActivity(tx, {
        tenantId: scope.tenantId,
        visitId,
        type: 'photo_uploaded',
        actorMembershipId: scope.actorMembershipId,
        payload: { attachmentId: row.id, contentType: input.contentType },
      });

      return toView(row);
    });
  }

  async download(
    scope: TenantScope,
    visitId: string,
    attachmentId: string,
    visibility: VisitVisibility,
  ): Promise<StoredObject & { originalFilename: string | null }> {
    await this.visits.get(scope, visitId, visibility);
    const row = await withTenantContext(getDb(), scope, async (tx) => {
      const [r] = await tx
        .select()
        .from(visitAttachments)
        .where(
          and(
            eq(visitAttachments.tenantId, scope.tenantId),
            eq(visitAttachments.visitId, visitId),
            eq(visitAttachments.id, attachmentId),
          ),
        )
        .limit(1);
      return r;
    });
    if (!row) throw new AppError('ATTACHMENT_NOT_FOUND');

    const object = await this.storage.getObject(row.objectKey);
    if (!object) throw new AppError('ATTACHMENT_NOT_FOUND');
    return { ...object, originalFilename: row.originalFilename };
  }

  async remove(
    scope: TenantScope,
    visitId: string,
    attachmentId: string,
    visibility: VisitVisibility,
  ): Promise<void> {
    await this.visits.get(scope, visitId, visibility);
    const row = await withTenantContext(getDb(), scope, async (tx) => {
      const [r] = await tx
        .delete(visitAttachments)
        .where(
          and(
            eq(visitAttachments.tenantId, scope.tenantId),
            eq(visitAttachments.visitId, visitId),
            eq(visitAttachments.id, attachmentId),
          ),
        )
        .returning();
      if (!r) throw new AppError('ATTACHMENT_NOT_FOUND');
      await recordVisitActivity(tx, {
        tenantId: scope.tenantId,
        visitId,
        type: 'photo_removed',
        actorMembershipId: scope.actorMembershipId,
        payload: { attachmentId },
      });
      return r;
    });
    await this.storage.deleteObject(row.objectKey);
  }
}

function toView(row: typeof visitAttachments.$inferSelect): VisitAttachmentView {
  return {
    id: row.id,
    visitId: row.visitId,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    fileSize: row.fileSize,
    uploadedByMembershipId: row.uploadedByMembershipId,
    createdAt: row.createdAt.toISOString(),
  };
}
