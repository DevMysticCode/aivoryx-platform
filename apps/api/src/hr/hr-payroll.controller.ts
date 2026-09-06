import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RequirePermission, Security } from '../security/security.decorators.js';
import type { SecurityContext } from '../security/security-context.js';
import { AppError } from '@aivoryx/shared';
import { ApiErrorDto } from '../auth/auth.dto.js';
import { hrScope } from './common.js';
import { PayrollService } from './payroll.service.js';
import { SelfServiceService } from './self-service.service.js';
import {
  CreatePayrollPeriodDto,
  ListPayrollQueryDto,
  PayrollPeriodDetailDto,
  PayrollPeriodDto,
  PayrollPeriodListDto,
  RecordPayrollPaymentDto,
} from './hr.dto.js';

/**
 * Payroll (Phase 12, ADR 0041). Operational, not statutory — no tax filing, no
 * government submissions. Money is exact fixed-point. FINALIZE freezes each
 * entry into an immutable snapshot: later changes to salary, department, leave,
 * incentives or expenses never alter a finalized period. Payment recording is
 * operational state only — Aivoryx is not a bank.
 */
@ApiTags('hr')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('hr/payroll')
export class HrPayrollController {
  constructor(
    private readonly payroll: PayrollService,
    private readonly selfService: SelfServiceService,
  ) {}

  @Get('periods')
  @RequirePermission('hr.payroll.read')
  @ApiOperation({ operationId: 'listHrPayrollPeriods', summary: 'List payroll periods.' })
  @ApiOkResponse({ type: PayrollPeriodListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListPayrollQueryDto) {
    return this.payroll.list(hrScope(ctx), query);
  }

  @Post('periods')
  @HttpCode(200)
  @RequirePermission('hr.payroll.manage')
  @ApiOperation({ operationId: 'createHrPayrollPeriod', summary: 'Create a draft payroll period.' })
  @ApiOkResponse({ type: PayrollPeriodDto })
  create(@Security() ctx: SecurityContext, @Body() body: CreatePayrollPeriodDto) {
    return this.payroll.create(hrScope(ctx), body);
  }

  @Get('periods/:id')
  @RequirePermission('hr.payroll.read')
  @ApiOperation({
    operationId: 'getHrPayrollPeriod',
    summary: 'One payroll period with its entries.',
  })
  @ApiOkResponse({ type: PayrollPeriodDetailDto })
  detail(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.payroll.detail(hrScope(ctx), id);
  }

  @Post('periods/:id/process')
  @HttpCode(200)
  @RequirePermission('hr.payroll.process')
  @ApiOperation({
    operationId: 'processHrPayrollPeriod',
    summary: 'Calculate all entries for a draft period.',
  })
  @ApiOkResponse({ type: PayrollPeriodDetailDto })
  process(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.payroll.process(hrScope(ctx), id);
  }

  @Post('periods/:id/finalize')
  @HttpCode(200)
  @RequirePermission('hr.payroll.finalize')
  @ApiOperation({
    operationId: 'finalizeHrPayrollPeriod',
    summary: 'Finalize a period (freezes snapshots).',
  })
  @ApiOkResponse({ type: PayrollPeriodDetailDto })
  finalize(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.payroll.finalize(hrScope(ctx), id);
  }

  @Post('periods/:id/payments')
  @HttpCode(200)
  @RequirePermission('hr.payroll.payment')
  @ApiOperation({
    operationId: 'recordHrPayrollPayment',
    summary: 'Record a payroll payment for an entry.',
  })
  @ApiOkResponse({ type: PayrollPeriodDetailDto })
  recordPayment(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: RecordPayrollPaymentDto,
  ) {
    return this.payroll.recordPayment(hrScope(ctx), id, body);
  }

  @Get('entries/:entryId/payslip')
  @RequirePermission('hr.payroll.read')
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiProduces('application/pdf')
  @ApiOperation({
    operationId: 'hrPayslipPdf',
    summary: 'Branded payslip PDF for a payroll entry.',
  })
  async payslip(
    @Security() ctx: SecurityContext,
    @Param('entryId') entryId: string,
  ): Promise<StreamableFile> {
    const { filename, body } = await this.payroll.payslip(hrScope(ctx), entryId);
    return new StreamableFile(body, {
      type: 'application/pdf',
      disposition: `inline; filename="${filename}"`,
    });
  }

  // ---- self-service payslip ---------------------

  @Get('me/entries/:entryId/payslip')
  @RequirePermission('hr.attendance.self')
  @Header('Content-Type', 'application/pdf')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiProduces('application/pdf')
  @ApiOperation({ operationId: 'hrMyPayslipPdf', summary: 'My own payslip PDF.' })
  async myPayslip(
    @Security() ctx: SecurityContext,
    @Param('entryId') entryId: string,
  ): Promise<StreamableFile> {
    const scope = hrScope(ctx);
    const employeeId = await this.selfService.myEmployeeId(scope);
    const history = await this.payroll.historyFor(scope, employeeId);
    if (!history.some((h) => h.payrollEntryId === entryId)) {
      throw new AppError('HR_PAYROLL_ENTRY_NOT_FOUND');
    }
    const { filename, body } = await this.payroll.payslip(scope, entryId);
    return new StreamableFile(body, {
      type: 'application/pdf',
      disposition: `inline; filename="${filename}"`,
    });
  }
}
