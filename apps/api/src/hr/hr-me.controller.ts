import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AuthOnly, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { hrScope } from './common.js';
import { SelfServiceService } from './self-service.service.js';
import { LeaveService } from './leave.service.js';
import { ExpensesService } from './expenses.service.js';
import { AttendanceService } from './attendance.service.js';
import { PayrollService } from './payroll.service.js';
import {
  AttendanceListDto,
  ExpenseClaimListDto,
  HrMeDto,
  LeaveBalanceDto,
  LeaveRequestListDto,
  ListAttendanceQueryDto,
  ListExpenseQueryDto,
  ListLeaveQueryDto,
  PayrollHistoryItemDto,
} from './hr.dto.js';

/**
 * Employee self-service (`/hr/me`, Phase 12, ADR 0041). Identity is resolved
 * strictly as authenticated membership → linked employee → own data. A
 * client-provided employeeId is NEVER honoured here. If the caller's account is
 * not linked to an employee, every route fails closed with
 * `HR_EMPLOYEE_NOT_LINKED`. Only own data is ever returned — never another
 * employee's salary, bank details, private notes or expenses.
 */
@ApiTags('hr')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('hr/me')
export class HrMeController {
  constructor(
    private readonly selfService: SelfServiceService,
    private readonly leave: LeaveService,
    private readonly expenses: ExpensesService,
    private readonly attendance: AttendanceService,
    private readonly payroll: PayrollService,
  ) {}

  @Get()
  @AuthOnly()
  @ApiOperation({
    operationId: 'hrMe',
    summary: 'My HR profile, leave balances and today’s attendance.',
  })
  @ApiOkResponse({ type: HrMeDto })
  me(@Security() ctx: SecurityContext) {
    return this.selfService.me(hrScope(ctx));
  }

  @Get('leave-balances')
  @AuthOnly()
  @ApiOperation({ operationId: 'hrMyLeaveBalances', summary: 'My leave balances.' })
  @ApiOkResponse({ type: [LeaveBalanceDto] })
  async leaveBalances(@Security() ctx: SecurityContext) {
    const scope = hrScope(ctx);
    return this.leave.balancesFor(scope, await this.selfService.myEmployeeId(scope));
  }

  @Get('leave-requests')
  @AuthOnly()
  @ApiOperation({ operationId: 'hrMyLeaveRequests', summary: 'My leave requests.' })
  @ApiOkResponse({ type: LeaveRequestListDto })
  async leaveRequests(@Security() ctx: SecurityContext, @Query() query: ListLeaveQueryDto) {
    const scope = hrScope(ctx);
    const employeeId = await this.selfService.myEmployeeId(scope);
    return this.leave.list(scope, { ...query, employeeId });
  }

  @Get('attendance')
  @AuthOnly()
  @ApiOperation({ operationId: 'hrMyAttendance', summary: 'My attendance records.' })
  @ApiOkResponse({ type: AttendanceListDto })
  async myAttendance(@Security() ctx: SecurityContext, @Query() query: ListAttendanceQueryDto) {
    const scope = hrScope(ctx);
    const employeeId = await this.selfService.myEmployeeId(scope);
    return this.attendance.list(scope, { ...query, employeeId });
  }

  @Get('expenses')
  @AuthOnly()
  @ApiOperation({ operationId: 'hrMyExpenses', summary: 'My expense claims.' })
  @ApiOkResponse({ type: ExpenseClaimListDto })
  async myExpenses(@Security() ctx: SecurityContext, @Query() query: ListExpenseQueryDto) {
    const scope = hrScope(ctx);
    const employeeId = await this.selfService.myEmployeeId(scope);
    return this.expenses.list(scope, { ...query, employeeId });
  }

  @Get('payroll-history')
  @AuthOnly()
  @ApiOperation({ operationId: 'hrMyPayrollHistory', summary: 'My finalized payroll history.' })
  @ApiOkResponse({ type: [PayrollHistoryItemDto] })
  async payrollHistory(@Security() ctx: SecurityContext) {
    const scope = hrScope(ctx);
    return this.payroll.historyFor(scope, await this.selfService.myEmployeeId(scope));
  }
}
