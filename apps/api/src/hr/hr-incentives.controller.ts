import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
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
import { hrScope } from './common.js';
import { IncentivesService } from './incentives.service.js';
import {
  CreateIncentiveDto,
  IncentiveDto,
  IncentiveListDto,
  ListIncentiveQueryDto,
} from './hr.dto.js';

/**
 * Incentives (Phase 12, ADR 0041) — generic records with a free-text `type`.
 * No hardcoded sales-commission / installation-bonus concept. Other modules
 * feed inputs later through a narrow contract; HR never queries their tables.
 */
@ApiTags('hr')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('hr/incentives')
export class HrIncentivesController {
  constructor(private readonly incentives: IncentivesService) {}

  @Get()
  @RequirePermission('hr.incentive.read')
  @ApiOperation({ operationId: 'listHrIncentives', summary: 'Search incentive records.' })
  @ApiOkResponse({ type: IncentiveListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListIncentiveQueryDto) {
    return this.incentives.list(hrScope(ctx), query);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('hr.incentive.manage')
  @ApiOperation({
    operationId: 'createHrIncentive',
    summary: 'Create an incentive record (DRAFT).',
  })
  @ApiOkResponse({ type: IncentiveDto })
  create(@Security() ctx: SecurityContext, @Body() body: CreateIncentiveDto) {
    return this.incentives.create(hrScope(ctx), body);
  }

  @Get(':id')
  @RequirePermission('hr.incentive.read')
  @ApiOperation({ operationId: 'getHrIncentive', summary: 'One incentive record.' })
  @ApiOkResponse({ type: IncentiveDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.incentives.get(hrScope(ctx), id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('hr.incentive.manage')
  @ApiOperation({
    operationId: 'approveHrIncentive',
    summary: 'Approve an incentive (DRAFT → APPROVED).',
  })
  @ApiOkResponse({ type: IncentiveDto })
  approve(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.incentives.approve(hrScope(ctx), id);
  }
}
