import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
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
import { scope } from './common.js';
import { ProjectWorkflowsService } from './workflows.service.js';
import {
  ExecutionViewDto,
  NetMeteringDto,
  UpdateHandoverDto,
  UpdateNetMeteringDto,
} from './execution.dto.js';

/**
 * Net metering (internal grid-connection tracking) and customer handover
 * (Phase 7, ADR 0036 §13/§14). Both are per-project workflow records —
 * net metering is a configurable capability, not a solar-only project column.
 */
@ApiTags('execution')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('projects/:projectId')
export class ProjectWorkflowsController {
  constructor(private readonly workflows: ProjectWorkflowsService) {}

  @Get('net-metering')
  @RequirePermission('projects.net_metering.read')
  @ApiOperation({ operationId: 'getNetMetering', summary: 'The net-metering record.' })
  @ApiOkResponse({ type: NetMeteringDto })
  getNetMetering(@Security() ctx: SecurityContext, @Param('projectId') projectId: string) {
    return this.workflows.getNetMetering(scope(ctx), projectId);
  }

  @Patch('net-metering')
  @RequirePermission('projects.net_metering.update')
  @ApiOperation({ operationId: 'updateNetMetering', summary: 'Update the net-metering record.' })
  @ApiOkResponse({ type: ExecutionViewDto })
  updateNetMetering(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Body() body: UpdateNetMeteringDto,
  ) {
    return this.workflows.updateNetMetering(scope(ctx), projectId, body);
  }

  @Patch('handover')
  @RequirePermission('projects.handover.update')
  @ApiOperation({
    operationId: 'updateHandover',
    summary: 'Update the handover record + acknowledgement.',
  })
  @ApiOkResponse({ type: ExecutionViewDto })
  updateHandover(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Body() body: UpdateHandoverDto,
  ) {
    return this.workflows.updateHandover(scope(ctx), projectId, body);
  }

  @Post('handover/complete')
  @HttpCode(200)
  @RequirePermission('projects.handover.complete')
  @ApiOperation({ operationId: 'completeHandover', summary: 'Complete the customer handover.' })
  @ApiOkResponse({ type: ExecutionViewDto })
  completeHandover(@Security() ctx: SecurityContext, @Param('projectId') projectId: string) {
    return this.workflows.completeHandover(scope(ctx), projectId);
  }
}
