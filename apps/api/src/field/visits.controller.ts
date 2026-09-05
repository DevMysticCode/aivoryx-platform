import {
  Body,
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
import {
  AssignVisitRequestDto,
  CancelVisitRequestDto,
  CheckOutRequestDto,
  CreateVisitNoteRequestDto,
  GeoPointRequestDto,
  ListVisitsQueryDto,
  RescheduleVisitRequestDto,
  ScheduleVisitRequestDto,
  SubmitSurveyRequestDto,
  SurveyFieldValueDto,
  VisitActivityDto,
  VisitAttachmentDto,
  VisitDto,
  VisitListResponseDto,
  VisitNoteDto,
} from './field.dto.js';
import { VisitAttachmentsService } from './visit-attachments.service.js';
import { VisitNotesService } from './visit-notes.service.js';
import { listActivitiesForVisit } from './visit-activities.js';
import { visitExists } from './visit-queries.js';
import { getDb, withTenantContext } from '@aivoryx/db';
import { VisitsService, type TenantScope, type VisitVisibility } from './visits.service.js';

/**
 * Field operations surface — visits, GPS check-in/out, survey, notes,
 * attachments (Phase 4, ADR 0033). Every route is RLS-scoped (ADR 0027) and
 * gated by one catalogue permission (ADR 0029); visibility beyond that
 * (own-visits-only for a field agent) is enforced in `VisitsService`, never
 * trusted from client input.
 */
@ApiTags('field')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('visits')
export class VisitsController {
  constructor(
    private readonly visits: VisitsService,
    private readonly notes: VisitNotesService,
    private readonly attachments: VisitAttachmentsService,
  ) {}

  @Get()
  @RequirePermission('field.visits.read')
  @ApiOperation({ operationId: 'listVisits', summary: 'Search and filter visits.' })
  @ApiOkResponse({ type: VisitListResponseDto })
  listVisits(@Security() ctx: SecurityContext, @Query() query: ListVisitsQueryDto) {
    return this.visits.list(
      scope(ctx),
      {
        status: query.status,
        leadId: query.leadId,
        assignedMembershipId: query.assignedMembershipId,
        today: query.today,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      },
      visibility(ctx),
    );
  }

  @Get(':visitId')
  @RequirePermission('field.visits.read')
  @ApiOperation({ operationId: 'getVisit', summary: 'A single visit.' })
  @ApiOkResponse({ type: VisitDto })
  getVisit(@Security() ctx: SecurityContext, @Param('visitId') visitId: string) {
    return this.visits.get(scope(ctx), visitId, visibility(ctx));
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('field.visits.create')
  @ApiOperation({ operationId: 'scheduleVisit', summary: 'Schedule a site visit for a lead.' })
  @ApiOkResponse({ type: VisitDto })
  schedule(@Security() ctx: SecurityContext, @Body() body: ScheduleVisitRequestDto) {
    return this.visits.schedule(scope(ctx), body);
  }

  @Post(':visitId/assign')
  @HttpCode(200)
  @RequirePermission('field.visits.assign')
  @ApiOperation({ operationId: 'assignVisit', summary: 'Assign or reassign the visit.' })
  @ApiOkResponse({ type: VisitDto })
  assign(
    @Security() ctx: SecurityContext,
    @Param('visitId') visitId: string,
    @Body() body: AssignVisitRequestDto,
  ) {
    return this.visits.assign(scope(ctx), visitId, body.membershipId);
  }

  @Post(':visitId/reschedule')
  @HttpCode(200)
  @RequirePermission('field.visits.assign')
  @ApiOperation({ operationId: 'rescheduleVisit', summary: 'Move a visit to a new date/time.' })
  @ApiOkResponse({ type: VisitDto })
  reschedule(
    @Security() ctx: SecurityContext,
    @Param('visitId') visitId: string,
    @Body() body: RescheduleVisitRequestDto,
  ) {
    return this.visits.reschedule(scope(ctx), visitId, body.scheduledAt);
  }

  @Post(':visitId/cancel')
  @HttpCode(200)
  @RequirePermission('field.visits.assign')
  @ApiOperation({ operationId: 'cancelVisit', summary: 'Cancel a visit.' })
  @ApiOkResponse({ type: VisitDto })
  cancel(
    @Security() ctx: SecurityContext,
    @Param('visitId') visitId: string,
    @Body() body: CancelVisitRequestDto,
  ) {
    return this.visits.cancel(scope(ctx), visitId, body.reason);
  }

  @Post(':visitId/check-in')
  @HttpCode(200)
  @RequirePermission('field.visits.checkin')
  @ApiOperation({ operationId: 'checkInVisit', summary: 'GPS check-in to an assigned visit.' })
  @ApiOkResponse({ type: VisitDto })
  checkIn(
    @Security() ctx: SecurityContext,
    @Param('visitId') visitId: string,
    @Body() body: GeoPointRequestDto,
  ) {
    return this.visits.checkIn(scope(ctx), visitId, body);
  }

  @Post(':visitId/check-out')
  @HttpCode(200)
  @RequirePermission('field.visits.checkin')
  @ApiOperation({ operationId: 'checkOutVisit', summary: 'GPS check-out from a visit.' })
  @ApiOkResponse({ type: VisitDto })
  checkOut(
    @Security() ctx: SecurityContext,
    @Param('visitId') visitId: string,
    @Body() body: CheckOutRequestDto,
  ) {
    return this.visits.checkOut(scope(ctx), visitId, body);
  }

  @Post(':visitId/complete')
  @HttpCode(200)
  @RequirePermission('field.visits.complete')
  @ApiOperation({ operationId: 'completeVisit', summary: 'Mark an assigned visit complete.' })
  @ApiOkResponse({ type: VisitDto })
  complete(@Security() ctx: SecurityContext, @Param('visitId') visitId: string) {
    return this.visits.complete(scope(ctx), visitId);
  }

  // ---- survey ---------------------------------------------------------

  @Get(':visitId/survey')
  @RequirePermission('field.visits.survey')
  @ApiOperation({
    operationId: 'getVisitSurvey',
    summary: 'Current survey field values for a visit.',
  })
  @ApiOkResponse({ type: [SurveyFieldValueDto] })
  getSurvey(@Security() ctx: SecurityContext, @Param('visitId') visitId: string) {
    return this.visits.getSurvey(scope(ctx), visitId, visibility(ctx));
  }

  @Post(':visitId/survey')
  @HttpCode(200)
  @RequirePermission('field.visits.survey')
  @ApiOperation({
    operationId: 'submitVisitSurvey',
    summary: 'Submit or update site survey answers.',
  })
  @ApiOkResponse({ type: VisitDto })
  submitSurvey(
    @Security() ctx: SecurityContext,
    @Param('visitId') visitId: string,
    @Body() body: SubmitSurveyRequestDto,
  ) {
    return this.visits.submitSurvey(scope(ctx), visitId, body.values);
  }

  // ---- timeline ---------------------------------------------------

  @Get(':visitId/activities')
  @RequirePermission('field.visits.read')
  @ApiOperation({
    operationId: 'listVisitActivities',
    summary: 'The chronological visit timeline.',
  })
  @ApiOkResponse({ type: [VisitActivityDto] })
  async listActivities(@Security() ctx: SecurityContext, @Param('visitId') visitId: string) {
    const tenantScope = scope(ctx);
    await this.visits.get(tenantScope, visitId, visibility(ctx));
    return withTenantContext(getDb(), tenantScope, async (tx) => {
      if (!(await visitExists(tx, tenantScope.tenantId, visitId)))
        throw new AppError('VISIT_NOT_FOUND');
      return listActivitiesForVisit(tx, tenantScope.tenantId, visitId);
    });
  }

  // ---- notes ------------------------------------------------------

  @Get(':visitId/notes')
  @RequirePermission('field.visits.read')
  @ApiOperation({ operationId: 'listVisitNotes', summary: 'Notes on a visit.' })
  @ApiOkResponse({ type: [VisitNoteDto] })
  listNotes(@Security() ctx: SecurityContext, @Param('visitId') visitId: string) {
    return this.notes.list(scope(ctx), visitId, visibility(ctx));
  }

  @Post(':visitId/notes')
  @HttpCode(200)
  @RequirePermission('crm.activities.create')
  @ApiOperation({ operationId: 'createVisitNote', summary: 'Add a note to a visit.' })
  @ApiOkResponse({ type: VisitNoteDto })
  createNote(
    @Security() ctx: SecurityContext,
    @Param('visitId') visitId: string,
    @Body() body: CreateVisitNoteRequestDto,
  ) {
    return this.notes.create(scope(ctx), visitId, body.body, visibility(ctx));
  }

  // ---- attachments --------------------------------------------------

  @Get(':visitId/attachments')
  @RequirePermission('field.visits.read')
  @ApiOperation({ operationId: 'listVisitAttachments', summary: 'Photos/attachments on a visit.' })
  @ApiOkResponse({ type: [VisitAttachmentDto] })
  listAttachments(@Security() ctx: SecurityContext, @Param('visitId') visitId: string) {
    return this.attachments.list(scope(ctx), visitId, visibility(ctx));
  }

  @Post(':visitId/attachments')
  @HttpCode(200)
  @RequirePermission('field.visits.attachments')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    operationId: 'uploadVisitAttachment',
    summary: 'Upload a visit photo/attachment.',
  })
  @ApiOkResponse({ type: VisitAttachmentDto })
  uploadAttachment(
    @Security() ctx: SecurityContext,
    @Param('visitId') visitId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new AppError('ATTACHMENT_INVALID', { details: { reason: 'no_file' } });
    return this.attachments.upload(
      scope(ctx),
      visitId,
      {
        buffer: file.buffer,
        originalFilename: file.originalname,
        contentType: file.mimetype,
        size: file.size,
      },
      visibility(ctx),
    );
  }

  @Get(':visitId/attachments/:attachmentId/download')
  @RequirePermission('field.visits.read')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiOperation({ operationId: 'downloadVisitAttachment', summary: 'Download a visit attachment.' })
  async downloadAttachment(
    @Security() ctx: SecurityContext,
    @Param('visitId') visitId: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const object = await this.attachments.download(
      scope(ctx),
      visitId,
      attachmentId,
      visibility(ctx),
    );
    return new StreamableFile(object.body, {
      type: object.contentType,
      disposition: object.originalFilename
        ? `inline; filename="${object.originalFilename}"`
        : undefined,
    });
  }

  @Delete(':visitId/attachments/:attachmentId')
  @RequirePermission('field.visits.attachments')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteVisitAttachment', summary: 'Remove a visit attachment.' })
  async deleteAttachment(
    @Security() ctx: SecurityContext,
    @Param('visitId') visitId: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<void> {
    await this.attachments.remove(scope(ctx), visitId, attachmentId, visibility(ctx));
  }
}

function scope(ctx: SecurityContext): TenantScope {
  if (!ctx.tenantId || !ctx.membership) throw new AppError('AUTH_NO_ACTIVE_TENANT');
  return { tenantId: ctx.tenantId, userId: ctx.user.id, actorMembershipId: ctx.membership.id };
}

/** Whether the caller sees every tenant visit or only their own — `crm.leads.read`
 *  is the existing CRM/admin-visibility permission, reused as the signal
 *  (mirrors the lead-notes "manage any note" pattern). */
function visibility(ctx: SecurityContext): VisitVisibility {
  return { canSeeAll: ctx.permissions.has('crm.leads.read') };
}
