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
import { LeaveService } from './leave.service.js';
import { SelfServiceService } from './self-service.service.js';
import {
  AdjustLeaveBalanceDto,
  CreateLeaveRequestDto,
  LeaveBalanceDto,
  LeaveCalendarItemDto,
  LeaveDecisionDto,
  LeaveRequestDto,
  LeaveRequestListDto,
  LeaveTypeDto,
  ListLeaveCalendarQueryDto,
  ListLeaveQueryDto,
  UpsertLeaveTypeDto,
} from './hr.dto.js';

/**
 * Leave (Phase 12, ADR 0041). Approval authority is tenant-configurable via the
 * leave policy — reporting manager, HR, a designated approver or tenant admin.
 * Balances are ledger-backed; approval consumes a locked balance row plus a
 * CONSUMPTION transaction in one atomic step, so concurrent approvals can never
 * over-consume. Self-approval is forbidden.
 */
@ApiTags('hr')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('hr/leave')
export class HrLeaveController {
  constructor(
    private readonly leave: LeaveService,
    private readonly selfService: SelfServiceService,
  ) {}

  // ---- leave types / policies --------------------

  @Get('types')
  @RequirePermission('hr.leave.read')
  @ApiOperation({ operationId: 'listHrLeaveTypes', summary: 'List leave types with their policy.' })
  @ApiOkResponse({ type: [LeaveTypeDto] })
  listTypes(@Security() ctx: SecurityContext) {
    return this.leave.listTypes(hrScope(ctx));
  }

  @Post('types')
  @HttpCode(200)
  @RequirePermission('hr.leave.manage')
  @ApiOperation({ operationId: 'createHrLeaveType', summary: 'Create a leave type + policy.' })
  @ApiOkResponse({ type: LeaveTypeDto })
  createType(@Security() ctx: SecurityContext, @Body() body: UpsertLeaveTypeDto) {
    return this.leave.upsertType(hrScope(ctx), body);
  }

  @Patch('types/:id')
  @RequirePermission('hr.leave.manage')
  @ApiOperation({ operationId: 'updateHrLeaveType', summary: 'Update a leave type + policy.' })
  @ApiOkResponse({ type: LeaveTypeDto })
  updateType(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpsertLeaveTypeDto,
  ) {
    return this.leave.upsertType(hrScope(ctx), body, id);
  }

  // ---- balances ---------------------------------

  @Get('balances/:employeeId')
  @RequirePermission('hr.leave.read')
  @ApiOperation({ operationId: 'hrLeaveBalances', summary: 'Leave balances for an employee.' })
  @ApiOkResponse({ type: [LeaveBalanceDto] })
  balances(@Security() ctx: SecurityContext, @Param('employeeId') employeeId: string) {
    return this.leave.balancesFor(hrScope(ctx), employeeId);
  }

  @Post('balances/adjust')
  @HttpCode(200)
  @RequirePermission('hr.leave.manage')
  @ApiOperation({
    operationId: 'adjustHrLeaveBalance',
    summary: 'Ledger adjustment to a leave balance.',
  })
  @ApiOkResponse({ type: [LeaveBalanceDto] })
  adjustBalance(@Security() ctx: SecurityContext, @Body() body: AdjustLeaveBalanceDto) {
    return this.leave.adjustBalance(hrScope(ctx), body);
  }

  // ---- requests --------------------------------

  @Get('requests')
  @RequirePermission('hr.leave.read')
  @ApiOperation({ operationId: 'listHrLeaveRequests', summary: 'Search leave requests.' })
  @ApiOkResponse({ type: LeaveRequestListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListLeaveQueryDto) {
    return this.leave.list(hrScope(ctx), query);
  }

  @Get('my-requests')
  @RequirePermission('hr.leave.request')
  @ApiOperation({ operationId: 'listMyHrLeaveRequests', summary: 'My own leave requests.' })
  @ApiOkResponse({ type: LeaveRequestListDto })
  async myRequests(@Security() ctx: SecurityContext, @Query() query: ListLeaveQueryDto) {
    const scope = hrScope(ctx);
    const employeeId = await this.selfService.myEmployeeId(scope);
    return this.leave.list(scope, { ...query, employeeId });
  }

  @Get('approval-queue')
  @RequirePermission('hr.leave.approve')
  @ApiOperation({
    operationId: 'hrLeaveApprovalQueue',
    summary: 'Leave requests awaiting my decision.',
  })
  @ApiOkResponse({ type: [LeaveRequestDto] })
  approvalQueue(@Security() ctx: SecurityContext) {
    return this.leave.approvalQueue(hrScope(ctx), ctx.permissions.has('hr.leave.manage'));
  }

  @Get('calendar')
  @RequirePermission('hr.leave.read')
  @ApiOperation({ operationId: 'hrLeaveCalendar', summary: 'Leave calendar entries in a window.' })
  @ApiOkResponse({ type: [LeaveCalendarItemDto] })
  calendar(@Security() ctx: SecurityContext, @Query() query: ListLeaveCalendarQueryDto) {
    return this.leave.calendar(hrScope(ctx), query);
  }

  @Post('requests')
  @HttpCode(200)
  @RequirePermission('hr.leave.request')
  @ApiOperation({
    operationId: 'createHrLeaveRequest',
    summary: 'Create a leave request (self-service unless employeeId given).',
  })
  @ApiOkResponse({ type: LeaveRequestDto })
  createRequest(@Security() ctx: SecurityContext, @Body() body: CreateLeaveRequestDto) {
    return this.leave.createRequest(hrScope(ctx), body);
  }

  @Get('requests/:id')
  @RequirePermission('hr.leave.read')
  @ApiOperation({ operationId: 'getHrLeaveRequest', summary: 'One leave request.' })
  @ApiOkResponse({ type: LeaveRequestDto })
  getRequest(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.leave.getRequest(hrScope(ctx), id);
  }

  @Post('requests/:id/approve')
  @HttpCode(200)
  @RequirePermission('hr.leave.approve')
  @ApiOperation({ operationId: 'approveHrLeaveRequest', summary: 'Approve a leave request.' })
  @ApiOkResponse({ type: LeaveRequestDto })
  approve(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: LeaveDecisionDto,
  ) {
    return this.leave.decide(
      hrScope(ctx),
      id,
      'APPROVED',
      body,
      ctx.permissions.has('hr.leave.manage'),
    );
  }

  @Post('requests/:id/reject')
  @HttpCode(200)
  @RequirePermission('hr.leave.approve')
  @ApiOperation({ operationId: 'rejectHrLeaveRequest', summary: 'Reject a leave request.' })
  @ApiOkResponse({ type: LeaveRequestDto })
  reject(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: LeaveDecisionDto,
  ) {
    return this.leave.decide(
      hrScope(ctx),
      id,
      'REJECTED',
      body,
      ctx.permissions.has('hr.leave.manage'),
    );
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @RequirePermission('hr.leave.request')
  @ApiOperation({ operationId: 'cancelHrLeaveRequest', summary: 'Cancel a leave request.' })
  @ApiOkResponse({ type: LeaveRequestDto })
  cancel(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.leave.cancel(hrScope(ctx), id, ctx.permissions.has('hr.leave.manage'));
  }
}
