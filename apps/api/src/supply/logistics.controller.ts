import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
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
import { LogisticsService } from './logistics.service.js';
import { scope } from './common.js';
import {
  CreateDispatchDto,
  DeliverDispatchDto,
  DispatchAttachmentDto,
  DispatchDetailDto,
  DispatchListDto,
  ListDispatchesQueryDto,
  UpdateDispatchDto,
} from './logistics.dto.js';

/**
 * Logistics — project dispatches and delivery confirmation (Phase 5, ADR 0034).
 */
@ApiTags('logistics')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('logistics/dispatches')
export class LogisticsController {
  constructor(private readonly logistics: LogisticsService) {}

  @Get()
  @RequirePermission('dispatch.read')
  @ApiOperation({ operationId: 'listDispatches', summary: 'Search dispatches.' })
  @ApiOkResponse({ type: DispatchListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListDispatchesQueryDto) {
    return this.logistics.list(scope(ctx), query);
  }

  @Get(':id')
  @RequirePermission('dispatch.read')
  @ApiOperation({ operationId: 'getDispatch', summary: 'A dispatch with its lines.' })
  @ApiOkResponse({ type: DispatchDetailDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.logistics.get(scope(ctx), id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('dispatch.create')
  @ApiOperation({
    operationId: 'createDispatch',
    summary: 'Create a draft dispatch for a project.',
  })
  @ApiOkResponse({ type: DispatchDetailDto })
  create(@Security() ctx: SecurityContext, @Body() body: CreateDispatchDto) {
    return this.logistics.create(scope(ctx), body);
  }

  @Patch(':id')
  @RequirePermission('dispatch.update')
  @ApiOperation({ operationId: 'updateDispatch', summary: 'Edit a draft dispatch.' })
  @ApiOkResponse({ type: DispatchDetailDto })
  update(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateDispatchDto,
  ) {
    return this.logistics.update(scope(ctx), id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('dispatch.update')
  @ApiOperation({ operationId: 'cancelDispatch', summary: 'Cancel a draft dispatch.' })
  @ApiOkResponse({ type: DispatchDetailDto })
  cancel(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.logistics.cancel(scope(ctx), id);
  }

  @Post(':id/dispatch')
  @HttpCode(200)
  @RequirePermission('dispatch.dispatch')
  @ApiOperation({ operationId: 'sendDispatch', summary: 'Send a dispatch out from the warehouse.' })
  @ApiOkResponse({ type: DispatchDetailDto })
  dispatch(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.logistics.dispatch(scope(ctx), id);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @RequirePermission('dispatch.deliver')
  @ApiOperation({
    operationId: 'deliverDispatch',
    summary: 'Confirm delivery at the project site.',
  })
  @ApiOkResponse({ type: DispatchDetailDto })
  deliver(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: DeliverDispatchDto,
  ) {
    return this.logistics.deliver(scope(ctx), id, body);
  }

  // ---- attachments ----

  @Get(':id/attachments')
  @RequirePermission('dispatch.read')
  @ApiOperation({ operationId: 'listDispatchAttachments', summary: 'Delivery photos/documents.' })
  @ApiOkResponse({ type: [DispatchAttachmentDto] })
  listAttachments(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.logistics.listAttachments(scope(ctx), id);
  }

  @Post(':id/attachments')
  @HttpCode(200)
  @RequirePermission('dispatch.deliver')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    operationId: 'uploadDispatchAttachment',
    summary: 'Attach a delivery photo/document.',
  })
  @ApiOkResponse({ type: DispatchAttachmentDto })
  uploadAttachment(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new AppError('ATTACHMENT_INVALID', { details: { reason: 'no_file' } });
    return this.logistics.uploadAttachment(scope(ctx), id, {
      buffer: file.buffer,
      originalFilename: file.originalname,
      contentType: file.mimetype,
      size: file.size,
    });
  }

  @Get(':id/attachments/:attachmentId/download')
  @RequirePermission('dispatch.read')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiOperation({
    operationId: 'downloadDispatchAttachment',
    summary: 'Download a delivery attachment.',
  })
  async downloadAttachment(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const object = await this.logistics.downloadAttachment(scope(ctx), id, attachmentId);
    return new StreamableFile(object.body, {
      type: object.contentType,
      disposition: object.originalFilename
        ? `inline; filename="${object.originalFilename}"`
        : undefined,
    });
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermission('dispatch.deliver')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'deleteDispatchAttachment',
    summary: 'Remove a delivery attachment.',
  })
  async deleteAttachment(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<void> {
    await this.logistics.deleteAttachment(scope(ctx), id, attachmentId);
  }
}
