import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
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
import { ExecutionService } from './execution.service.js';
import {
  CompleteMilestoneDto,
  ExecutionViewDto,
  FieldProjectDto,
  MilestoneDto,
  ProjectCompletionResultDto,
} from './execution.dto.js';

/**
 * EPC project execution workspace (Phase 7, ADR 0036). Extends the Phase 5
 * project — detailed execution state lives in milestones + workflow records,
 * not in the project status enum.
 */
@ApiTags('execution')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('projects')
export class ExecutionController {
  constructor(private readonly execution: ExecutionService) {}

  @Get(':projectId/execution')
  @RequirePermission('projects.execution.read')
  @ApiOperation({ operationId: 'getProjectExecution', summary: 'The full execution workspace.' })
  @ApiOkResponse({ type: ExecutionViewDto })
  getExecution(@Security() ctx: SecurityContext, @Param('projectId') projectId: string) {
    return this.execution.getView(scope(ctx), projectId, executionVisibility(ctx));
  }

  @Post(':projectId/execution/start')
  @HttpCode(200)
  @RequirePermission('projects.execution.update')
  @ApiOperation({
    operationId: 'startProjectExecution',
    summary: 'Initialise execution: milestones, checklists, workflow records.',
  })
  @ApiOkResponse({ type: ExecutionViewDto })
  start(@Security() ctx: SecurityContext, @Param('projectId') projectId: string) {
    return this.execution.startExecution(scope(ctx), projectId);
  }

  @Get(':projectId/milestones')
  @RequirePermission('projects.execution.read')
  @ApiOperation({ operationId: 'listProjectMilestones', summary: 'Execution milestones.' })
  @ApiOkResponse({ type: [MilestoneDto] })
  milestones(@Security() ctx: SecurityContext, @Param('projectId') projectId: string) {
    return this.execution.listMilestones(scope(ctx), projectId);
  }

  @Post(':projectId/milestones/:milestoneId/complete')
  @HttpCode(200)
  @RequirePermission('projects.execution.update')
  @ApiOperation({
    operationId: 'completeProjectMilestone',
    summary: 'Manually complete a milestone.',
  })
  @ApiOkResponse({ type: [MilestoneDto] })
  completeMilestone(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Param('milestoneId') milestoneId: string,
    @Body() body: CompleteMilestoneDto,
  ) {
    return this.execution.completeMilestone(scope(ctx), projectId, milestoneId, body.notes);
  }

  @Post(':projectId/complete')
  @HttpCode(200)
  @RequirePermission('projects.complete')
  @ApiOperation({
    operationId: 'completeProject',
    summary: 'Complete the project once all execution requirements are met.',
  })
  @ApiOkResponse({ type: ProjectCompletionResultDto })
  complete(@Security() ctx: SecurityContext, @Param('projectId') projectId: string) {
    return this.execution.completeProject(scope(ctx), projectId);
  }
}

/**
 * Field PWA surface — the projects a field agent is assigned to work
 * (Phase 7, ADR 0036 §20). Visibility is server-enforced: a field agent only
 * sees their own assignments.
 */
@ApiTags('field')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('field/projects')
export class FieldProjectsController {
  constructor(private readonly execution: ExecutionService) {}

  @Get()
  @RequirePermission('projects.installation.read')
  @ApiOperation({ operationId: 'listFieldProjects', summary: 'My assigned installation work.' })
  @ApiOkResponse({ type: [FieldProjectDto] })
  list(@Security() ctx: SecurityContext) {
    return this.execution.listFieldProjects(scope(ctx));
  }

  @Get(':projectId')
  @RequirePermission('projects.installation.read')
  @ApiOperation({ operationId: 'getFieldProject', summary: 'An assigned project execution view.' })
  @ApiOkResponse({ type: ExecutionViewDto })
  get(@Security() ctx: SecurityContext, @Param('projectId') projectId: string) {
    return this.execution.getView(scope(ctx), projectId, { canSeeAll: false });
  }
}
