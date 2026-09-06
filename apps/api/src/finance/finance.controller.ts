import { Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
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
import { InvoicesService } from './invoices.service.js';
import {
  CustomerFinancialViewDto,
  FinanceOverviewDto,
  FinancialSummaryDto,
  OverdueSweepResultDto,
} from './finance.dto.js';

/**
 * Finance overview + read-only financial summaries for customers / projects
 * (Phase 9, ADR 0038). The summaries are computed live from the finance domain
 * — nothing is duplicated onto the customer / project tables.
 */
@ApiTags('finance')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('finance')
export class FinanceController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get('overview')
  @RequirePermission('finance.read')
  @ApiOperation({
    operationId: 'financeOverview',
    summary: 'Workspace financial totals by currency.',
  })
  @ApiOkResponse({ type: FinanceOverviewDto })
  overview(@Security() ctx: SecurityContext) {
    return this.invoices.overview(scope(ctx));
  }

  @Get('customers/:customerId/summary')
  @RequirePermission('finance.read')
  @ApiOperation({
    operationId: 'customerFinancialSummary',
    summary: 'A customer’s invoiced / paid / outstanding / overdue plus recent records.',
  })
  @ApiOkResponse({ type: CustomerFinancialViewDto })
  customerSummary(@Security() ctx: SecurityContext, @Param('customerId') customerId: string) {
    return this.invoices.customerFinancialView(scope(ctx), customerId);
  }

  @Get('projects/:projectId/summary')
  @RequirePermission('finance.read')
  @ApiOperation({
    operationId: 'projectFinancialSummary',
    summary: 'A project’s invoiced / paid / outstanding / overdue.',
  })
  @ApiOkResponse({ type: FinancialSummaryDto })
  projectSummary(@Security() ctx: SecurityContext, @Param('projectId') projectId: string) {
    return this.invoices.projectFinancialSummary(scope(ctx), projectId);
  }

  @Post('maintenance/overdue-sweep')
  @HttpCode(200)
  @RequirePermission('finance.invoices.update')
  @ApiOperation({
    operationId: 'financeOverdueSweep',
    summary:
      'Emit invoice.overdue for newly-overdue invoices (idempotent; a scheduler may call this).',
  })
  @ApiOkResponse({ type: OverdueSweepResultDto })
  overdueSweep(@Security() ctx: SecurityContext) {
    return this.invoices.overdueSweep(scope(ctx));
  }
}
