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
import { scope } from './common.js';
import { QcService } from './qc.service.js';
import {
  ChecklistItemDto,
  CreateQcInspectionDto,
  ExecutionViewDto,
  FailQcDto,
  QcInspectionDetailDto,
  ToggleChecklistItemDto,
} from './execution.dto.js';

/** Quality control inspections (Phase 7, ADR 0036 §10-§12). */
@ApiTags('execution')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('projects/:projectId/qc')
export class QcController {
  constructor(private readonly qc: QcService) {}

  @Post()
  @HttpCode(200)
  @RequirePermission('projects.qc.create')
  @ApiOperation({ operationId: 'createQcInspection', summary: 'Open a QC inspection.' })
  @ApiOkResponse({ type: ExecutionViewDto })
  create(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Body() body: CreateQcInspectionDto,
  ) {
    return this.qc.create(scope(ctx), projectId, body);
  }

  @Get(':inspectionId')
  @RequirePermission('projects.qc.read')
  @ApiOperation({ operationId: 'getQcInspection', summary: 'A QC inspection with its checklist.' })
  @ApiOkResponse({ type: QcInspectionDetailDto })
  get(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Param('inspectionId') inspectionId: string,
  ) {
    return this.qc.getInspection(scope(ctx), projectId, inspectionId);
  }

  @Post(':inspectionId/checklist/:itemId/toggle')
  @HttpCode(200)
  @RequirePermission('projects.qc.update')
  @ApiOperation({ operationId: 'toggleQcChecklistItem', summary: 'Set a QC checklist item.' })
  @ApiOkResponse({ type: [ChecklistItemDto] })
  toggle(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Param('inspectionId') inspectionId: string,
    @Param('itemId') itemId: string,
    @Body() body: ToggleChecklistItemDto,
  ) {
    return this.qc.toggleChecklistItem(
      scope(ctx),
      projectId,
      inspectionId,
      itemId,
      body.status,
      body.notes,
    );
  }

  @Post(':inspectionId/start')
  @HttpCode(200)
  @RequirePermission('projects.qc.update')
  @ApiOperation({ operationId: 'startQcInspection', summary: 'Begin the QC inspection.' })
  @ApiOkResponse({ type: ExecutionViewDto })
  start(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Param('inspectionId') inspectionId: string,
  ) {
    return this.qc.start(scope(ctx), projectId, inspectionId);
  }

  @Post(':inspectionId/pass')
  @HttpCode(200)
  @RequirePermission('projects.qc.approve')
  @ApiOperation({ operationId: 'passQcInspection', summary: 'Pass the QC inspection.' })
  @ApiOkResponse({ type: ExecutionViewDto })
  pass(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Param('inspectionId') inspectionId: string,
  ) {
    return this.qc.pass(scope(ctx), projectId, inspectionId);
  }

  @Post(':inspectionId/fail')
  @HttpCode(200)
  @RequirePermission('projects.qc.approve')
  @ApiOperation({ operationId: 'failQcInspection', summary: 'Fail the QC inspection.' })
  @ApiOkResponse({ type: ExecutionViewDto })
  fail(
    @Security() ctx: SecurityContext,
    @Param('projectId') projectId: string,
    @Param('inspectionId') inspectionId: string,
    @Body() body: FailQcDto,
  ) {
    return this.qc.fail(scope(ctx), projectId, inspectionId, body);
  }
}
