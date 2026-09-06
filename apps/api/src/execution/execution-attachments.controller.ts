import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AppError } from '@aivoryx/shared';
import { RequirePermission, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { executionVisibility, scope } from './common.js';
import { ExecutionAttachmentsService } from './execution-attachments.service.js';
import { ExecutionAttachmentDto } from './execution.dto.js';

type EntityKind = 'installation' | 'qc' | 'defect' | 'net_metering' | 'handover';

/**
 * Execution attachments — installation / QC / defect / net-metering / handover
 * evidence (Phase 7, ADR 0036 §22). Reuses the existing object-storage
 * adapter; every access re-checks tenant + project visibility.
 */
@ApiTags('execution')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('projects/:projectId/execution/attachments')
export class ExecutionAttachmentsController {
  constructor(private readonly attachments: ExecutionAttachmentsService) {}

  @Get()
  @RequirePermission('projects.installation.read')
  @ApiOperation({ operationId: 'listExecutionAttachments', summary: 'Execution evidence files.' })
  @ApiOkResponse({ type: [ExecutionAttachmentDto] })
  list(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Query('entityKind') entityKind?: EntityKind,
    @Query('entityId') entityId?: string,
  ) {
    return this.attachments.list(
      scope(ctx),
      projectId,
      { entityKind, entityId },
      executionVisibility(ctx),
    );
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('projects.installation.update')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ operationId: 'uploadExecutionAttachment', summary: 'Attach an evidence file.' })
  @ApiOkResponse({ type: ExecutionAttachmentDto })
  upload(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Query('entityKind') entityKind: EntityKind,
    @Query('entityId') entityId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new AppError('ATTACHMENT_INVALID', { details: { reason: 'no_file' } });
    if (!entityKind || !entityId) {
      throw new AppError('ATTACHMENT_INVALID', { details: { reason: 'missing_entity' } });
    }
    return this.attachments.upload(
      scope(ctx),
      projectId,
      {
        entityKind,
        entityId,
        buffer: file.buffer,
        originalFilename: file.originalname,
        contentType: file.mimetype,
        size: file.size,
      },
      executionVisibility(ctx),
    );
  }

  @Get(':attachmentId/download')
  @RequirePermission('projects.installation.read')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiOperation({
    operationId: 'downloadExecutionAttachment',
    summary: 'Download an evidence file.',
  })
  async download(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const object = await this.attachments.download(
      scope(ctx),
      projectId,
      attachmentId,
      executionVisibility(ctx),
    );
    return new StreamableFile(object.body, {
      type: object.contentType,
      disposition: object.originalFilename
        ? `inline; filename="${object.originalFilename}"`
        : undefined,
    });
  }

  @Delete(':attachmentId')
  @HttpCode(204)
  @RequirePermission('projects.installation.update')
  @ApiOperation({ operationId: 'deleteExecutionAttachment', summary: 'Remove an evidence file.' })
  async remove(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<void> {
    await this.attachments.remove(scope(ctx), projectId, attachmentId, executionVisibility(ctx));
  }
}
