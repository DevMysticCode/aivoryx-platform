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
import { executionVisibility, scope } from './common.js';
import { DefectsService } from './defects.service.js';
import { CreateDefectDto, DefectDto, UpdateDefectDto } from './execution.dto.js';

/** Lightweight defect list raised from QC (Phase 7, ADR 0036 §12). */
@ApiTags('execution')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('projects/:projectId/defects')
export class DefectsController {
  constructor(private readonly defects: DefectsService) {}

  @Get()
  @RequirePermission('projects.defects.read')
  @ApiOperation({ operationId: 'listProjectDefects', summary: 'Defects on a project.' })
  @ApiOkResponse({ type: [DefectDto] })
  list(@Security() ctx: SecurityContext, @Param('projectId') projectId: string) {
    return this.defects.list(scope(ctx), projectId, executionVisibility(ctx));
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('projects.defects.create')
  @ApiOperation({ operationId: 'createProjectDefect', summary: 'Raise a defect.' })
  @ApiOkResponse({ type: DefectDto })
  create(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Body() body: CreateDefectDto,
  ) {
    return this.defects.create(scope(ctx), projectId, body);
  }

  @Patch(':defectId')
  @RequirePermission('projects.defects.update')
  @ApiOperation({ operationId: 'updateProjectDefect', summary: 'Update / resolve a defect.' })
  @ApiOkResponse({ type: DefectDto })
  update(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Param('defectId') defectId: string,
    @Body() body: UpdateDefectDto,
  ) {
    return this.defects.update(scope(ctx), projectId, defectId, body, executionVisibility(ctx));
  }
}
