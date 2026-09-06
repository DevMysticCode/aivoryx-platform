import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import {
  OBJECT_STORAGE,
  buildEntityAttachmentKey,
  type ObjectStorageService,
} from '../storage/object-storage.service.js';
import { loadExecProject } from './helpers.js';
import { assertProjectVisible } from './helpers.js';
import type { ExecutionVisibility, TenantScope } from './common.js';
import type { ExecutionAttachmentDto } from './execution.dto.js';

const { projectExecutionAttachments } = schema;
type EntityKind = schema.ProjectExecutionAttachmentRow['entityKind'];

const MAX_BYTES = 15 * 1024 * 1024;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);

@Injectable()
export class ExecutionAttachmentsService {
  constructor(@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService) {}

  async list(
    scope: TenantScope,
    projectId: string,
    filter: { entityKind?: EntityKind; entityId?: string },
    visibility: ExecutionVisibility,
  ): Promise<ExecutionAttachmentDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await loadExecProject(tx, scope.tenantId, projectId);
      await assertProjectVisible(tx, scope, projectId, visibility);
      const conds = [
        eq(projectExecutionAttachments.tenantId, scope.tenantId),
        eq(projectExecutionAttachments.projectId, projectId),
      ];
      if (filter.entityKind)
        conds.push(eq(projectExecutionAttachments.entityKind, filter.entityKind));
      if (filter.entityId) conds.push(eq(projectExecutionAttachments.entityId, filter.entityId));
      const rows = await tx
        .select()
        .from(projectExecutionAttachments)
        .where(and(...conds))
        .orderBy(desc(projectExecutionAttachments.createdAt));
      return rows.map(toDto);
    });
  }

  async upload(
    scope: TenantScope,
    projectId: string,
    input: {
      entityKind: EntityKind;
      entityId: string;
      buffer: Buffer;
      originalFilename: string;
      contentType: string;
      size: number;
    },
    visibility: ExecutionVisibility,
  ): Promise<ExecutionAttachmentDto> {
    if (input.size > MAX_BYTES) {
      throw new AppError('ATTACHMENT_INVALID', { details: { reason: 'too_large' } });
    }
    if (!ALLOWED.has(input.contentType)) {
      throw new AppError('ATTACHMENT_INVALID', { details: { reason: 'unsupported_type' } });
    }
    const key = buildEntityAttachmentKey(
      scope.tenantId,
      `projects/execution/${input.entityKind}`,
      input.entityId,
      input.originalFilename,
    );
    await this.storage.putObject({ key, body: input.buffer, contentType: input.contentType });
    return withTenantContext(getDb(), scope, async (tx) => {
      await loadExecProject(tx, scope.tenantId, projectId);
      await assertProjectVisible(tx, scope, projectId, visibility);
      const [row] = await tx
        .insert(projectExecutionAttachments)
        .values({
          tenantId: scope.tenantId,
          projectId,
          entityKind: input.entityKind,
          entityId: input.entityId,
          objectKey: key,
          originalFilename: input.originalFilename,
          contentType: input.contentType,
          fileSize: input.size,
          uploadedByMembershipId: scope.actorMembershipId,
        })
        .returning();
      return toDto(row!);
    });
  }

  async download(
    scope: TenantScope,
    projectId: string,
    attachmentId: string,
    visibility: ExecutionVisibility,
  ): Promise<{ body: Buffer; contentType: string; originalFilename: string | null }> {
    const meta = await withTenantContext(getDb(), scope, async (tx) => {
      await assertProjectVisible(tx, scope, projectId, visibility);
      const [row] = await tx
        .select()
        .from(projectExecutionAttachments)
        .where(
          and(
            eq(projectExecutionAttachments.id, attachmentId),
            eq(projectExecutionAttachments.projectId, projectId),
            eq(projectExecutionAttachments.tenantId, scope.tenantId),
          ),
        );
      if (!row) throw new AppError('ATTACHMENT_NOT_FOUND');
      return row;
    });
    const obj = await this.storage.getObject(meta.objectKey);
    if (!obj) throw new AppError('ATTACHMENT_NOT_FOUND');
    return {
      body: obj.body,
      contentType: meta.contentType,
      originalFilename: meta.originalFilename,
    };
  }

  async remove(
    scope: TenantScope,
    projectId: string,
    attachmentId: string,
    visibility: ExecutionVisibility,
  ): Promise<void> {
    const key = await withTenantContext(getDb(), scope, async (tx) => {
      await assertProjectVisible(tx, scope, projectId, visibility);
      const [row] = await tx
        .select()
        .from(projectExecutionAttachments)
        .where(
          and(
            eq(projectExecutionAttachments.id, attachmentId),
            eq(projectExecutionAttachments.projectId, projectId),
            eq(projectExecutionAttachments.tenantId, scope.tenantId),
          ),
        );
      if (!row) throw new AppError('ATTACHMENT_NOT_FOUND');
      await tx
        .delete(projectExecutionAttachments)
        .where(
          and(
            eq(projectExecutionAttachments.id, attachmentId),
            eq(projectExecutionAttachments.tenantId, scope.tenantId),
          ),
        );
      return row.objectKey;
    });
    await this.storage.deleteObject(key);
  }
}

function toDto(row: schema.ProjectExecutionAttachmentRow): ExecutionAttachmentDto {
  return {
    id: row.id,
    projectId: row.projectId,
    entityKind: row.entityKind,
    entityId: row.entityId,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    fileSize: row.fileSize,
    createdAt: row.createdAt.toISOString(),
  };
}
