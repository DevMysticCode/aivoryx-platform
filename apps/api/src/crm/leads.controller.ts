import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
import { LeadsService, type LeadContactInput } from './leads.service.js';
import { NotesService } from './notes.service.js';
import { FollowupsService } from './followups.service.js';
import { listActivitiesForLead } from './activities.js';
import { leadExists } from './lead-queries.js';
import { getDb, withTenantContext } from '@aivoryx/db';
import {
  AssignLeadRequestDto,
  CallAttemptRequestDto,
  CompleteFollowupRequestDto,
  CreateFollowupRequestDto,
  CreateNoteRequestDto,
  FollowupDto,
  LeadActivityDto,
  LeadContactDto,
  LeadDto,
  LeadListResponseDto,
  LeadStatusRequestDto,
  ListLeadsQueryDto,
  NoteDto,
  QualifyLeadRequestDto,
  RescheduleFollowupRequestDto,
} from './crm.dto.js';

/**
 * The reusable CRM Lead surface (Phase 3, ADR 0031). Every route is
 * RLS-scoped to the active tenant (ADR 0027) and gated by one catalogue
 * permission (ADR 0029) — no new authorization model.
 */
@ApiTags('crm')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('crm/leads')
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly notes: NotesService,
    private readonly followups: FollowupsService,
  ) {}

  // ---- leads ----------------------------------------------------------

  @Get()
  @RequirePermission('crm.leads.read')
  @ApiOperation({ operationId: 'listLeads', summary: 'Search and filter leads.' })
  @ApiOkResponse({ type: LeadListResponseDto })
  listLeads(@Security() ctx: SecurityContext, @Query() query: ListLeadsQueryDto) {
    return this.leads.list(scope(ctx), {
      status: query.status,
      sourceId: query.sourceId,
      assignedMembershipId: query.assignedMembershipId,
      q: query.q,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    });
  }

  @Get(':leadId')
  @RequirePermission('crm.leads.read')
  @ApiOperation({ operationId: 'getLead', summary: 'A single lead.' })
  @ApiOkResponse({ type: LeadDto })
  getLead(@Security() ctx: SecurityContext, @Param('leadId') leadId: string) {
    return this.leads.get(scope(ctx), leadId);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('crm.leads.create')
  @ApiOperation({ operationId: 'createLead', summary: 'Manually create a lead.' })
  @ApiOkResponse({ type: LeadDto })
  createLead(@Security() ctx: SecurityContext, @Body() body: LeadContactDto) {
    return this.leads.create(scope(ctx), body as LeadContactInput);
  }

  @Patch(':leadId')
  @RequirePermission('crm.leads.update')
  @ApiOperation({ operationId: 'updateLead', summary: 'Edit lead identity/contact/custom fields.' })
  @ApiOkResponse({ type: LeadDto })
  updateLead(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Body() body: LeadContactDto,
  ) {
    return this.leads.update(scope(ctx), leadId, body as LeadContactInput);
  }

  @Post(':leadId/assign')
  @HttpCode(200)
  @RequirePermission('crm.leads.assign')
  @ApiOperation({ operationId: 'assignLead', summary: 'Assign or reassign a lead.' })
  @ApiOkResponse({ type: LeadDto })
  assignLead(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Body() body: AssignLeadRequestDto,
  ) {
    return this.leads.assign(scope(ctx), leadId, body.membershipId);
  }

  @Post(':leadId/status')
  @HttpCode(200)
  @RequirePermission('crm.leads.update')
  @ApiOperation({ operationId: 'changeLeadStatus', summary: 'Move a lead to a new status.' })
  @ApiOkResponse({ type: LeadDto })
  changeStatus(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Body() body: LeadStatusRequestDto,
  ) {
    return this.leads.transitionStatus(scope(ctx), leadId, body.status);
  }

  @Post(':leadId/qualify')
  @HttpCode(200)
  @RequirePermission('crm.leads.qualify')
  @ApiOperation({ operationId: 'qualifyLead', summary: 'Qualify or disqualify a lead.' })
  @ApiOkResponse({ type: LeadDto })
  qualify(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Body() body: QualifyLeadRequestDto,
  ) {
    return this.leads.qualify(scope(ctx), leadId, body.outcome, body.note);
  }

  @Post(':leadId/call-attempts')
  @HttpCode(200)
  @RequirePermission('crm.activities.create')
  @ApiOperation({ operationId: 'logCallAttempt', summary: 'Log a manual call attempt on a lead.' })
  @ApiOkResponse({ type: LeadDto })
  logCallAttempt(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Body() body: CallAttemptRequestDto,
  ) {
    return this.leads.logCallAttempt(activityScope(ctx), leadId, body.outcome, body.note);
  }

  // ---- timeline ---------------------------------------------------

  @Get(':leadId/activities')
  @RequirePermission('crm.activities.read')
  @ApiOperation({ operationId: 'listLeadActivities', summary: 'The chronological lead timeline.' })
  @ApiOkResponse({ type: [LeadActivityDto] })
  async listActivities(@Security() ctx: SecurityContext, @Param('leadId') leadId: string) {
    const tenantScope = scope(ctx);
    return withTenantContext(getDb(), tenantScope, async (tx) => {
      if (!(await leadExists(tx, tenantScope.tenantId, leadId)))
        throw new AppError('LEAD_NOT_FOUND');
      return listActivitiesForLead(tx, tenantScope.tenantId, leadId);
    });
  }

  // ---- notes ------------------------------------------------------

  @Get(':leadId/notes')
  @RequirePermission('crm.activities.read')
  @ApiOperation({ operationId: 'listLeadNotes', summary: 'Notes on a lead.' })
  @ApiOkResponse({ type: [NoteDto] })
  listNotes(@Security() ctx: SecurityContext, @Param('leadId') leadId: string) {
    return this.notes.list(noteScope(ctx), leadId);
  }

  @Post(':leadId/notes')
  @HttpCode(200)
  @RequirePermission('crm.activities.create')
  @ApiOperation({ operationId: 'createLeadNote', summary: 'Add a note to a lead.' })
  @ApiOkResponse({ type: NoteDto })
  createNote(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Body() body: CreateNoteRequestDto,
  ) {
    return this.notes.create(noteScope(ctx), leadId, body.body);
  }

  @Patch(':leadId/notes/:noteId')
  @RequirePermission('crm.activities.create')
  @ApiOperation({
    operationId: 'updateLeadNote',
    summary: 'Edit a note (author, or crm.leads.update).',
  })
  @ApiOkResponse({ type: NoteDto })
  updateNote(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Param('noteId') noteId: string,
    @Body() body: CreateNoteRequestDto,
  ) {
    return this.notes.update(noteScope(ctx), leadId, noteId, body.body);
  }

  @Delete(':leadId/notes/:noteId')
  @RequirePermission('crm.activities.create')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'deleteLeadNote',
    summary: 'Delete a note (author, or crm.leads.update).',
  })
  async deleteNote(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Param('noteId') noteId: string,
  ): Promise<void> {
    await this.notes.remove(noteScope(ctx), leadId, noteId);
  }

  // ---- follow-ups ---------------------------------------------------

  @Get(':leadId/followups')
  @RequirePermission('crm.leads.followup')
  @ApiOperation({ operationId: 'listLeadFollowups', summary: 'Follow-ups on a lead.' })
  @ApiOkResponse({ type: [FollowupDto] })
  listFollowups(@Security() ctx: SecurityContext, @Param('leadId') leadId: string) {
    return this.followups.list(activityScope(ctx), leadId);
  }

  @Post(':leadId/followups')
  @HttpCode(200)
  @RequirePermission('crm.leads.followup')
  @ApiOperation({ operationId: 'createLeadFollowup', summary: 'Schedule a follow-up.' })
  @ApiOkResponse({ type: FollowupDto })
  createFollowup(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Body() body: CreateFollowupRequestDto,
  ) {
    return this.followups.create(activityScope(ctx), leadId, body);
  }

  @Post(':leadId/followups/:followupId/complete')
  @HttpCode(200)
  @RequirePermission('crm.leads.followup')
  @ApiOperation({ operationId: 'completeLeadFollowup', summary: 'Mark a follow-up complete.' })
  @ApiOkResponse({ type: FollowupDto })
  completeFollowup(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Param('followupId') followupId: string,
    @Body() body: CompleteFollowupRequestDto,
  ) {
    return this.followups.complete(activityScope(ctx), leadId, followupId, body.result);
  }

  @Post(':leadId/followups/:followupId/reschedule')
  @HttpCode(200)
  @RequirePermission('crm.leads.followup')
  @ApiOperation({
    operationId: 'rescheduleLeadFollowup',
    summary: 'Move a follow-up to a new due time.',
  })
  @ApiOkResponse({ type: FollowupDto })
  rescheduleFollowup(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Param('followupId') followupId: string,
    @Body() body: RescheduleFollowupRequestDto,
  ) {
    return this.followups.reschedule(activityScope(ctx), leadId, followupId, body.dueAt);
  }
}

function scope(ctx: SecurityContext): {
  tenantId: string;
  userId: string;
  actorMembershipId: string;
} {
  if (!ctx.tenantId || !ctx.membership) {
    throw new AppError('AUTH_NO_ACTIVE_TENANT');
  }
  return { tenantId: ctx.tenantId, userId: ctx.user.id, actorMembershipId: ctx.membership.id };
}

const activityScope = scope;

function noteScope(ctx: SecurityContext) {
  return { ...scope(ctx), canManageAnyNote: ctx.permissions.has('crm.leads.update') };
}
