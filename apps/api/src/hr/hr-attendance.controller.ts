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
import { AttendanceService } from './attendance.service.js';
import {
  AttendanceListDto,
  AttendanceRecordDto,
  CheckInDto,
  CorrectAttendanceDto,
  ListAttendanceQueryDto,
  RecordAttendanceDto,
} from './hr.dto.js';

/**
 * Attendance (Phase 12, ADR 0041). Server time is authoritative — client
 * timestamps are never trusted for check-in/out. GPS is optional and, where
 * captured, is a straight-line distance only (not road distance, not proof of
 * exact presence). Corrections are immutable and audited; ordinary employees
 * cannot silently rewrite history.
 */
@ApiTags('hr')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('hr/attendance')
export class HrAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  // ---- self-service -------------------------------

  @Post('check-in')
  @HttpCode(200)
  @RequirePermission('hr.attendance.self')
  @ApiOperation({ operationId: 'hrCheckIn', summary: 'Check in (own attendance).' })
  @ApiOkResponse({ type: AttendanceRecordDto })
  checkIn(@Security() ctx: SecurityContext, @Body() body: CheckInDto) {
    return this.attendance.checkIn(hrScope(ctx), body, 'WEB');
  }

  @Post('check-out')
  @HttpCode(200)
  @RequirePermission('hr.attendance.self')
  @ApiOperation({ operationId: 'hrCheckOut', summary: 'Check out (own attendance).' })
  @ApiOkResponse({ type: AttendanceRecordDto })
  checkOut(@Security() ctx: SecurityContext, @Body() body: CheckInDto) {
    return this.attendance.checkOut(hrScope(ctx), body, 'WEB');
  }

  // ---- admin -------------------------------------

  @Get()
  @RequirePermission('hr.attendance.read')
  @ApiOperation({ operationId: 'listHrAttendance', summary: 'Search attendance records.' })
  @ApiOkResponse({ type: AttendanceListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListAttendanceQueryDto) {
    return this.attendance.list(hrScope(ctx), query);
  }

  @Post('record')
  @HttpCode(200)
  @RequirePermission('hr.attendance.manage')
  @ApiOperation({
    operationId: 'recordHrAttendance',
    summary: 'Record/replace a day of attendance for an employee.',
  })
  @ApiOkResponse({ type: AttendanceRecordDto })
  record(@Security() ctx: SecurityContext, @Body() body: RecordAttendanceDto) {
    return this.attendance.record(hrScope(ctx), body);
  }

  @Post('employees/:employeeId/check-in')
  @HttpCode(200)
  @RequirePermission('hr.attendance.manage')
  @ApiOperation({ operationId: 'hrCheckInFor', summary: 'Check in on behalf of an employee.' })
  @ApiOkResponse({ type: AttendanceRecordDto })
  checkInFor(
    @Security() ctx: SecurityContext,
    @Param('employeeId') employeeId: string,
    @Body() body: CheckInDto,
  ) {
    return this.attendance.checkInFor(hrScope(ctx), employeeId, body);
  }

  @Post('employees/:employeeId/check-out')
  @HttpCode(200)
  @RequirePermission('hr.attendance.manage')
  @ApiOperation({ operationId: 'hrCheckOutFor', summary: 'Check out on behalf of an employee.' })
  @ApiOkResponse({ type: AttendanceRecordDto })
  checkOutFor(
    @Security() ctx: SecurityContext,
    @Param('employeeId') employeeId: string,
    @Body() body: CheckInDto,
  ) {
    return this.attendance.checkOutFor(hrScope(ctx), employeeId, body);
  }

  @Post(':id/corrections')
  @HttpCode(200)
  @RequirePermission('hr.attendance.correct')
  @ApiOperation({
    operationId: 'correctHrAttendance',
    summary: 'Correct a historical attendance record.',
  })
  @ApiOkResponse({ type: AttendanceRecordDto })
  correct(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: CorrectAttendanceDto,
  ) {
    return this.attendance.correct(hrScope(ctx), id, body);
  }
}
