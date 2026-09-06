import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
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
import { InstallationsService } from './installations.service.js';
import {
  AssignInstallationDto,
  CompleteInstallationDto,
  ExecutionViewDto,
  MaterialOverrideDto,
  StartInstallationDto,
} from './execution.dto.js';

/** Installation assignment + on-site workflow (Phase 7, ADR 0036 §6/§7). */
@ApiTags('execution')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('projects/:projectId/installations')
export class InstallationsController {
  constructor(private readonly installations: InstallationsService) {}

  @Post('assign')
  @HttpCode(200)
  @RequirePermission('projects.installation.assign')
  @ApiOperation({
    operationId: 'assignInstallation',
    summary: 'Assign / reassign to a field agent.',
  })
  @ApiOkResponse({ type: ExecutionViewDto })
  assign(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Body() body: AssignInstallationDto,
  ) {
    return this.installations.assign(scope(ctx), projectId, body);
  }

  @Post('unassign')
  @HttpCode(200)
  @RequirePermission('projects.installation.assign')
  @ApiOperation({
    operationId: 'unassignInstallation',
    summary: 'Clear the installation assignee.',
  })
  @ApiOkResponse({ type: ExecutionViewDto })
  unassign(@Security() ctx: SecurityContext, @Param('projectId') projectId: string) {
    return this.installations.unassign(scope(ctx), projectId);
  }

  @Post('material-override')
  @HttpCode(200)
  @RequirePermission('projects.execution.update')
  @ApiOperation({
    operationId: 'overrideInstallationMaterials',
    summary: 'Permit installation to start before materials are READY.',
  })
  @ApiOkResponse({ type: ExecutionViewDto })
  override(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Body() body: MaterialOverrideDto,
  ) {
    return this.installations.setMaterialOverride(scope(ctx), projectId, body);
  }

  @Post('start')
  @HttpCode(200)
  @RequirePermission('projects.installation.update')
  @ApiOperation({ operationId: 'startInstallation', summary: 'Start on-site installation.' })
  @ApiOkResponse({ type: ExecutionViewDto })
  startInstallation(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Body() body: StartInstallationDto,
  ) {
    return this.installations.start(scope(ctx), projectId, body, executionVisibility(ctx));
  }

  @Post('complete')
  @HttpCode(200)
  @RequirePermission('projects.installation.complete')
  @ApiOperation({ operationId: 'completeInstallation', summary: 'Mark installation complete.' })
  @ApiOkResponse({ type: ExecutionViewDto })
  completeInstallation(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Body() body: CompleteInstallationDto,
  ) {
    return this.installations.complete(scope(ctx), projectId, body, executionVisibility(ctx));
  }
}
