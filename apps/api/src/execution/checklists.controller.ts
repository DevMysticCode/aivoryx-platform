import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermission, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { executionVisibility, scope } from './common.js';
import { ChecklistsService } from './checklists.service.js';
import {
  AddChecklistItemDto,
  ChecklistItemDto,
  ExecutionViewDto,
  TemplateDto,
  ToggleChecklistItemDto,
  UpsertTemplateDto,
} from './execution.dto.js';

type ChecklistKind = 'installation' | 'qc' | 'handover';

/** Configurable execution checklists (Phase 7, ADR 0036 §9/§11). Definition/
 *  value split — templates are tenant-configurable, items are per project. */
@ApiTags('execution')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('projects/:projectId/checklists')
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  @Get()
  @RequirePermission('projects.installation.read')
  @ApiOperation({ operationId: 'listProjectChecklist', summary: 'Checklist items for a project.' })
  @ApiOkResponse({ type: [ChecklistItemDto] })
  list(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Query('kind') kind?: ChecklistKind,
  ) {
    return this.checklists.list(scope(ctx), projectId, kind, null, executionVisibility(ctx));
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('projects.execution.update')
  @ApiOperation({ operationId: 'addChecklistItem', summary: 'Add an ad-hoc checklist item.' })
  @ApiOkResponse({ type: [ChecklistItemDto] })
  add(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Body() body: AddChecklistItemDto,
  ) {
    return this.checklists.add(scope(ctx), projectId, body);
  }

  @Post(':itemId/toggle')
  @HttpCode(200)
  @RequirePermission('projects.installation.update')
  @ApiOperation({ operationId: 'toggleChecklistItem', summary: 'Set a checklist item status.' })
  @ApiOkResponse({ type: ExecutionViewDto })
  toggle(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
    @Body() body: ToggleChecklistItemDto,
  ) {
    return this.checklists.toggle(scope(ctx), projectId, itemId, body, executionVisibility(ctx));
  }

  @Delete(':itemId')
  @HttpCode(204)
  @RequirePermission('projects.execution.update')
  @ApiOperation({ operationId: 'removeChecklistItem', summary: 'Remove an ad-hoc checklist item.' })
  async remove(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Param('itemId') itemId: string,
  ): Promise<void> {
    await this.checklists.remove(scope(ctx), projectId, itemId);
  }
}

/** Tenant-configurable checklist template definitions. */
@ApiTags('execution')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('checklist-templates')
export class ChecklistTemplatesController {
  constructor(private readonly checklists: ChecklistsService) {}

  @Get()
  @RequirePermission('projects.execution.read')
  @ApiOperation({
    operationId: 'listChecklistTemplates',
    summary: 'Checklist template definitions.',
  })
  @ApiOkResponse({ type: [TemplateDto] })
  list(@Security() ctx: SecurityContext, @Query('kind') kind?: ChecklistKind) {
    return this.checklists.listTemplates(scope(ctx), kind);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('projects.execution.update')
  @ApiOperation({ operationId: 'createChecklistTemplate', summary: 'Add a checklist template.' })
  @ApiOkResponse({ type: TemplateDto })
  create(@Security() ctx: SecurityContext, @Body() body: UpsertTemplateDto) {
    return this.checklists.createTemplate(scope(ctx), body);
  }

  @Patch(':id')
  @RequirePermission('projects.execution.update')
  @ApiOperation({ operationId: 'updateChecklistTemplate', summary: 'Edit a checklist template.' })
  @ApiOkResponse({ type: TemplateDto })
  update(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpsertTemplateDto,
  ) {
    return this.checklists.updateTemplate(scope(ctx), id, body);
  }
}
