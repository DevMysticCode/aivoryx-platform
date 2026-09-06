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
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AppError } from '@aivoryx/shared';
import { RequirePermission, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { scope } from '../supply/common.js';
import { QuotationsService } from './quotations.service.js';
import {
  AcceptQuotationDto,
  BookingResultDto,
  BookQuotationDto,
  CreateQuotationDto,
  ListQuotationsQueryDto,
  QuotationActivityDto,
  QuotationAttachmentDto,
  QuotationDetailDto,
  QuotationListDto,
  ReviseQuotationDto,
  UpdateQuotationDto,
} from './commercial.dto.js';

/**
 * Quotations — the commercial workflow (Phase 6, ADR 0035): draft → send →
 * accept → book, with immutable revisions. `send` is an internal state
 * transition, not an email.
 */
@ApiTags('quotations')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('quotations')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  @RequirePermission('quotations.read')
  @ApiOperation({ operationId: 'listQuotations', summary: 'Search quotations.' })
  @ApiOkResponse({ type: QuotationListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListQuotationsQueryDto) {
    return this.quotations.list(scope(ctx), query);
  }

  @Get(':id')
  @RequirePermission('quotations.read')
  @ApiOperation({ operationId: 'getQuotation', summary: 'A quotation with all revisions.' })
  @ApiOkResponse({ type: QuotationDetailDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.quotations.get(scope(ctx), id);
  }

  @Get(':id/activities')
  @RequirePermission('quotations.read')
  @ApiOperation({ operationId: 'listQuotationActivities', summary: 'Quotation timeline.' })
  @ApiOkResponse({ type: [QuotationActivityDto] })
  activities(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.quotations.listActivities(scope(ctx), id);
  }

  @Get(':id/print')
  @RequirePermission('quotations.read')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiProduces('text/html')
  @ApiOperation({
    operationId: 'printQuotation',
    summary: 'Server-rendered printable quotation document.',
  })
  async print(@Security() ctx: SecurityContext, @Param('id') id: string): Promise<string> {
    return this.quotations.renderPrintable(scope(ctx), id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('quotations.create')
  @ApiOperation({ operationId: 'createQuotation', summary: 'Create a quotation for a lead.' })
  @ApiOkResponse({ type: QuotationDetailDto })
  create(@Security() ctx: SecurityContext, @Body() body: CreateQuotationDto) {
    return this.quotations.create(scope(ctx), body);
  }

  @Patch(':id')
  @RequirePermission('quotations.update')
  @ApiOperation({
    operationId: 'updateQuotation',
    summary: 'Edit the current draft revision (header + lines).',
  })
  @ApiOkResponse({ type: QuotationDetailDto })
  update(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateQuotationDto,
  ) {
    return this.quotations.update(scope(ctx), id, body);
  }

  @Post(':id/revise')
  @HttpCode(200)
  @RequirePermission('quotations.revise')
  @ApiOperation({ operationId: 'reviseQuotation', summary: 'Create a new editable revision.' })
  @ApiOkResponse({ type: QuotationDetailDto })
  revise(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: ReviseQuotationDto,
  ) {
    return this.quotations.revise(scope(ctx), id, body);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermission('quotations.send')
  @ApiOperation({ operationId: 'sendQuotation', summary: 'Mark sent — freezes the revision.' })
  @ApiOkResponse({ type: QuotationDetailDto })
  send(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.quotations.send(scope(ctx), id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @RequirePermission('quotations.accept')
  @ApiOperation({ operationId: 'acceptQuotation', summary: 'Record customer acceptance.' })
  @ApiOkResponse({ type: QuotationDetailDto })
  accept(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: AcceptQuotationDto,
  ) {
    return this.quotations.accept(scope(ctx), id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('quotations.cancel')
  @ApiOperation({ operationId: 'cancelQuotation', summary: 'Cancel a quotation.' })
  @ApiOkResponse({ type: QuotationDetailDto })
  cancel(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.quotations.cancel(scope(ctx), id);
  }

  @Post(':id/expire')
  @HttpCode(200)
  @RequirePermission('quotations.update')
  @ApiOperation({ operationId: 'expireQuotation', summary: 'Mark a sent quotation expired.' })
  @ApiOkResponse({ type: QuotationDetailDto })
  expire(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.quotations.expire(scope(ctx), id);
  }

  @Post(':id/book')
  @HttpCode(200)
  @RequirePermission('quotations.book')
  @ApiOperation({
    operationId: 'bookQuotation',
    summary: 'Book an accepted quotation — promotes the customer and activates the project.',
  })
  @ApiOkResponse({ type: BookingResultDto })
  book(@Security() ctx: SecurityContext, @Param('id') id: string, @Body() body: BookQuotationDto) {
    return this.quotations.book(scope(ctx), id, body);
  }

  // ---- attachments (existing object storage, ADR 0015) ----

  @Get(':id/attachments')
  @RequirePermission('quotations.read')
  @ApiOperation({ operationId: 'listQuotationAttachments', summary: 'Quotation documents.' })
  @ApiOkResponse({ type: [QuotationAttachmentDto] })
  listAttachments(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.quotations.listAttachments(scope(ctx), id);
  }

  @Post(':id/attachments')
  @HttpCode(200)
  @RequirePermission('quotations.update')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ operationId: 'uploadQuotationAttachment', summary: 'Attach a document.' })
  @ApiOkResponse({ type: QuotationAttachmentDto })
  uploadAttachment(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new AppError('ATTACHMENT_INVALID', { details: { reason: 'no_file' } });
    return this.quotations.uploadAttachment(scope(ctx), id, {
      buffer: file.buffer,
      originalFilename: file.originalname,
      contentType: file.mimetype,
      size: file.size,
    });
  }

  @Get(':id/attachments/:attachmentId/download')
  @RequirePermission('quotations.read')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiOperation({ operationId: 'downloadQuotationAttachment', summary: 'Download a document.' })
  async downloadAttachment(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const object = await this.quotations.downloadAttachment(scope(ctx), id, attachmentId);
    return new StreamableFile(object.body, {
      type: object.contentType,
      disposition: object.originalFilename
        ? `inline; filename="${object.originalFilename}"`
        : undefined,
    });
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermission('quotations.update')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteQuotationAttachment', summary: 'Remove a document.' })
  async deleteAttachment(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<void> {
    await this.quotations.deleteAttachment(scope(ctx), id, attachmentId);
  }
}

/**
 * Lead → quotations bridge. Mounted at `/leads/:leadId/quotations` (distinct
 * from the CRM controller's `/crm/leads`), so the CRM lead surface can list a
 * lead's commercial history.
 */
@ApiTags('quotations')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('leads/:leadId/quotations')
export class LeadQuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  @RequirePermission('quotations.read')
  @ApiOperation({ operationId: 'listLeadQuotations', summary: "A lead's quotations." })
  @ApiOkResponse({ type: QuotationListDto })
  list(@Security() ctx: SecurityContext, @Param('leadId') leadId: string) {
    return this.quotations.list(scope(ctx), { leadId, pageSize: 100 });
  }
}
