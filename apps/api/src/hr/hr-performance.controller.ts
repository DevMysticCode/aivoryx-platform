import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
import { PerformanceService } from './performance.service.js';
import { SelfServiceService } from './self-service.service.js';
import {
  CreateGoalDto,
  CreatePerformancePeriodDto,
  CreateReviewDto,
  ListPerformanceQueryDto,
  PerformanceGoalDto,
  PerformancePeriodDto,
  PerformanceReviewDto,
  UpdateReviewDto,
} from './hr.dto.js';

/**
 * Performance (Phase 12, ADR 0041) — lightweight: periods, goals and reviews
 * with manager + employee comments. No talent-management engine, no AI scoring.
 * A review moves DRAFT → SUBMITTED → ACKNOWLEDGED → CLOSED; only the reviewed
 * employee may acknowledge their own review.
 */
@ApiTags('hr')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('hr/performance')
export class HrPerformanceController {
  constructor(
    private readonly performance: PerformanceService,
    private readonly selfService: SelfServiceService,
  ) {}

  // ---- periods --------------------------------

  @Get('periods')
  @RequirePermission('hr.performance.read')
  @ApiOperation({ operationId: 'listHrPerformancePeriods', summary: 'List performance periods.' })
  @ApiOkResponse({ type: [PerformancePeriodDto] })
  listPeriods(@Security() ctx: SecurityContext) {
    return this.performance.listPeriods(hrScope(ctx));
  }

  @Post('periods')
  @HttpCode(200)
  @RequirePermission('hr.performance.manage')
  @ApiOperation({
    operationId: 'createHrPerformancePeriod',
    summary: 'Create a performance period.',
  })
  @ApiOkResponse({ type: PerformancePeriodDto })
  createPeriod(@Security() ctx: SecurityContext, @Body() body: CreatePerformancePeriodDto) {
    return this.performance.createPeriod(hrScope(ctx), body);
  }

  @Post('periods/:id/open')
  @HttpCode(200)
  @RequirePermission('hr.performance.manage')
  @ApiOperation({ operationId: 'openHrPerformancePeriod', summary: 'Open a performance period.' })
  @ApiOkResponse({ type: PerformancePeriodDto })
  openPeriod(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.performance.setPeriodStatus(hrScope(ctx), id, 'OPEN');
  }

  @Post('periods/:id/close')
  @HttpCode(200)
  @RequirePermission('hr.performance.manage')
  @ApiOperation({ operationId: 'closeHrPerformancePeriod', summary: 'Close a performance period.' })
  @ApiOkResponse({ type: PerformancePeriodDto })
  closePeriod(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.performance.setPeriodStatus(hrScope(ctx), id, 'CLOSED');
  }

  // ---- goals ---------------------------------

  @Get('goals')
  @RequirePermission('hr.performance.read')
  @ApiOperation({ operationId: 'listHrPerformanceGoals', summary: 'List performance goals.' })
  @ApiOkResponse({ type: [PerformanceGoalDto] })
  listGoals(@Security() ctx: SecurityContext, @Query() query: ListPerformanceQueryDto) {
    return this.performance.listGoals(hrScope(ctx), query);
  }

  @Post('goals')
  @HttpCode(200)
  @RequirePermission('hr.performance.manage')
  @ApiOperation({ operationId: 'createHrPerformanceGoal', summary: 'Create a performance goal.' })
  @ApiOkResponse({ type: PerformanceGoalDto })
  createGoal(@Security() ctx: SecurityContext, @Body() body: CreateGoalDto) {
    return this.performance.createGoal(hrScope(ctx), body);
  }

  // ---- reviews ------------------------------

  @Get('reviews')
  @RequirePermission('hr.performance.read')
  @ApiOperation({ operationId: 'listHrPerformanceReviews', summary: 'List performance reviews.' })
  @ApiOkResponse({ type: [PerformanceReviewDto] })
  listReviews(@Security() ctx: SecurityContext, @Query() query: ListPerformanceQueryDto) {
    return this.performance.listReviews(hrScope(ctx), query);
  }

  @Post('reviews')
  @HttpCode(200)
  @RequirePermission('hr.performance.manage')
  @ApiOperation({
    operationId: 'createHrPerformanceReview',
    summary: 'Create a performance review (DRAFT).',
  })
  @ApiOkResponse({ type: PerformanceReviewDto })
  createReview(@Security() ctx: SecurityContext, @Body() body: CreateReviewDto) {
    return this.performance.createReview(hrScope(ctx), body);
  }

  @Get('reviews/:id')
  @RequirePermission('hr.performance.read')
  @ApiOperation({ operationId: 'getHrPerformanceReview', summary: 'One performance review.' })
  @ApiOkResponse({ type: PerformanceReviewDto })
  getReview(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.performance.getReview(hrScope(ctx), id);
  }

  @Patch('reviews/:id')
  @RequirePermission('hr.performance.manage')
  @ApiOperation({
    operationId: 'updateHrPerformanceReview',
    summary: 'Update a draft/submitted review.',
  })
  @ApiOkResponse({ type: PerformanceReviewDto })
  updateReview(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateReviewDto,
  ) {
    return this.performance.updateReview(hrScope(ctx), id, body);
  }

  @Post('reviews/:id/submit')
  @HttpCode(200)
  @RequirePermission('hr.performance.manage')
  @ApiOperation({
    operationId: 'submitHrPerformanceReview',
    summary: 'Submit a review to the employee.',
  })
  @ApiOkResponse({ type: PerformanceReviewDto })
  submitReview(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.performance.submitReview(hrScope(ctx), id);
  }

  @Post('reviews/:id/acknowledge')
  @HttpCode(200)
  @RequirePermission('hr.attendance.self')
  @ApiOperation({
    operationId: 'acknowledgeHrPerformanceReview',
    summary: 'Acknowledge my own review.',
  })
  @ApiOkResponse({ type: PerformanceReviewDto })
  async acknowledgeReview(@Security() ctx: SecurityContext, @Param('id') id: string) {
    const scope = hrScope(ctx);
    const employeeId = await this.selfService.myEmployeeId(scope);
    return this.performance.acknowledgeReview(scope, id, employeeId);
  }

  @Post('reviews/:id/close')
  @HttpCode(200)
  @RequirePermission('hr.performance.manage')
  @ApiOperation({ operationId: 'closeHrPerformanceReview', summary: 'Close a review.' })
  @ApiOkResponse({ type: PerformanceReviewDto })
  closeReview(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.performance.closeReview(hrScope(ctx), id);
  }
}
