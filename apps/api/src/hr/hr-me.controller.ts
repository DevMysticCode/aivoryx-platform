import { Controller, Get, Header, Inject, Param, Query, StreamableFile } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { AppError } from '@aivoryx/shared';
import { RequireModule, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { OBJECT_STORAGE, type ObjectStorageService } from '../storage/object-storage.service.js';
import { hrScope } from './common.js';
import { SelfServiceService } from './self-service.service.js';
import { LeaveService } from './leave.service.js';
import { ExpensesService } from './expenses.service.js';
import { AttendanceService } from './attendance.service.js';
import { PayrollService } from './payroll.service.js';
import { EmployeesService } from './employees.service.js';
import { PerformanceService } from './performance.service.js';
import {
  AttendanceListDto,
  EmployeeDocumentDto,
  ExpenseClaimListDto,
  HrMeDto,
  LeaveBalanceDto,
  LeaveRequestListDto,
  ListAttendanceQueryDto,
  ListExpenseQueryDto,
  ListLeaveQueryDto,
  PayrollHistoryItemDto,
  PerformanceReviewDto,
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
    private readonly employees: EmployeesService,
    private readonly performance: PerformanceService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService,
  ) {}

  @Get()
  @RequireModule('HR')
  @ApiOperation({
    operationId: 'hrMe',
    summary: 'My HR profile, leave balances and today’s attendance.',
  })
  @ApiOkResponse({ type: HrMeDto })
  me(@Security() ctx: SecurityContext) {
    return this.selfService.me(hrScope(ctx));
  }

  @Get('leave-balances')
  @RequireModule('HR')
  @ApiOperation({ operationId: 'hrMyLeaveBalances', summary: 'My leave balances.' })
  @ApiOkResponse({ type: [LeaveBalanceDto] })
  async leaveBalances(@Security() ctx: SecurityContext) {
    const scope = hrScope(ctx);
    return this.leave.balancesFor(scope, await this.selfService.myEmployeeId(scope));
  }

  @Get('leave-requests')
  @RequireModule('HR')
  @ApiOperation({ operationId: 'hrMyLeaveRequests', summary: 'My leave requests.' })
  @ApiOkResponse({ type: LeaveRequestListDto })
  async leaveRequests(@Security() ctx: SecurityContext, @Query() query: ListLeaveQueryDto) {
    const scope = hrScope(ctx);
    const employeeId = await this.selfService.myEmployeeId(scope);
    return this.leave.list(scope, { ...query, employeeId });
  }

  @Get('attendance')
  @RequireModule('HR')
  @ApiOperation({ operationId: 'hrMyAttendance', summary: 'My attendance records.' })
  @ApiOkResponse({ type: AttendanceListDto })
  async myAttendance(@Security() ctx: SecurityContext, @Query() query: ListAttendanceQueryDto) {
    const scope = hrScope(ctx);
    const employeeId = await this.selfService.myEmployeeId(scope);
    return this.attendance.list(scope, { ...query, employeeId });
  }

  @Get('expenses')
  @RequireModule('HR')
  @ApiOperation({ operationId: 'hrMyExpenses', summary: 'My expense claims.' })
  @ApiOkResponse({ type: ExpenseClaimListDto })
  async myExpenses(@Security() ctx: SecurityContext, @Query() query: ListExpenseQueryDto) {
    const scope = hrScope(ctx);
    const employeeId = await this.selfService.myEmployeeId(scope);
    return this.expenses.list(scope, { ...query, employeeId });
  }

  @Get('documents')
  @RequireModule('HR')
  @ApiOperation({
    operationId: 'hrMyDocuments',
    summary: 'Documents HR has shared with me.',
  })
  @ApiOkResponse({ type: [EmployeeDocumentDto] })
  async myDocuments(@Security() ctx: SecurityContext) {
    const scope = hrScope(ctx);
    return this.employees.listMyDocuments(scope, await this.selfService.myEmployeeId(scope));
  }

  @Get('documents/:documentId/download')
  @RequireModule('HR')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiOperation({
    operationId: 'downloadHrMyDocument',
    summary: 'Download a document HR has shared with me.',
  })
  async downloadMyDocument(
    @Security() ctx: SecurityContext,
    @Param('documentId') documentId: string,
  ): Promise<StreamableFile> {
    const scope = hrScope(ctx);
    const key = await this.employees.myDocumentObjectKey(
      scope,
      await this.selfService.myEmployeeId(scope),
      documentId,
    );
    const object = await this.storage.getObject(key);
    if (!object)
      throw new AppError('HR_ATTACHMENT_INVALID', { details: { reason: 'missing_object' } });
    return new StreamableFile(object.body, { type: object.contentType });
  }

  @Get('performance-reviews')
  @RequireModule('HR')
  @ApiOperation({
    operationId: 'hrMyPerformanceReviews',
    summary: 'My performance reviews (submitted onward — drafts stay with the manager).',
  })
  @ApiOkResponse({ type: [PerformanceReviewDto] })
  async myPerformanceReviews(@Security() ctx: SecurityContext) {
    const scope = hrScope(ctx);
    return this.performance.listMyReviews(scope, await this.selfService.myEmployeeId(scope));
  }

  @Get('payroll-history')
  @RequireModule('HR')
  @ApiOperation({ operationId: 'hrMyPayrollHistory', summary: 'My finalized payroll history.' })
  @ApiOkResponse({ type: [PayrollHistoryItemDto] })
  async payrollHistory(@Security() ctx: SecurityContext) {
    const scope = hrScope(ctx);
    return this.payroll.historyFor(scope, await this.selfService.myEmployeeId(scope));
  }
}
