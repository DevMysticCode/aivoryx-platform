import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
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
import { ApiErrorDto } from '../auth/auth.dto.js';
import { scope } from './common.js';
import { InvoicesService } from './invoices.service.js';
import {
  CancelInvoiceDto,
  CreateInvoiceDto,
  CreateInvoiceFromQuotationDto,
  InvoiceDetailDto,
  InvoiceListDto,
  IssueInvoiceDto,
  ListInvoicesQueryDto,
  UpdateInvoiceDto,
} from './finance.dto.js';

/**
 * Invoices (Phase 9, ADR 0038). Every route derives tenant + actor from the
 * SecurityContext — a DTO never carries financial ownership. Mutating routes
 * accept an optional `Idempotency-Key` header.
 */
@ApiTags('finance')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('finance/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequirePermission('finance.invoices.read')
  @ApiOperation({ operationId: 'listInvoices', summary: 'Search invoices.' })
  @ApiOkResponse({ type: InvoiceListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListInvoicesQueryDto) {
    return this.invoices.list(scope(ctx), query);
  }

  @Get(':id')
  @RequirePermission('finance.invoices.read')
  @ApiOperation({ operationId: 'getInvoice', summary: 'One invoice with lines and payments.' })
  @ApiOkResponse({ type: InvoiceDetailDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.invoices.get(scope(ctx), id);
  }

  @Get(':id/print')
  @RequirePermission('finance.invoices.read')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiProduces('text/html')
  @ApiOperation({ operationId: 'printInvoice', summary: 'Server-rendered printable invoice.' })
  print(@Security() ctx: SecurityContext, @Param('id') id: string): Promise<string> {
    return this.invoices.renderPrintable(scope(ctx), id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('finance.invoices.create')
  @ApiOperation({ operationId: 'createInvoice', summary: 'Create a draft invoice.' })
  @ApiOkResponse({ type: InvoiceDetailDto })
  create(
    @Security() ctx: SecurityContext,
    @Body() body: CreateInvoiceDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.invoices.create(scope(ctx), body, idempotencyKey);
  }

  @Post('from-quotation')
  @HttpCode(200)
  @RequirePermission('finance.invoices.create')
  @ApiOperation({
    operationId: 'createInvoiceFromQuotation',
    summary: 'Create a draft invoice from an accepted/booked quotation.',
  })
  @ApiOkResponse({ type: InvoiceDetailDto })
  fromQuotation(
    @Security() ctx: SecurityContext,
    @Body() body: CreateInvoiceFromQuotationDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.invoices.createFromQuotation(scope(ctx), body, idempotencyKey);
  }

  @Patch(':id')
  @RequirePermission('finance.invoices.update')
  @ApiOperation({ operationId: 'updateInvoice', summary: 'Edit a draft invoice.' })
  @ApiOkResponse({ type: InvoiceDetailDto })
  update(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateInvoiceDto,
  ) {
    return this.invoices.update(scope(ctx), id, body);
  }

  @Post(':id/issue')
  @HttpCode(200)
  @RequirePermission('finance.invoices.issue')
  @ApiOperation({
    operationId: 'issueInvoice',
    summary: 'Issue an invoice (freezes its snapshot).',
  })
  @ApiOkResponse({ type: InvoiceDetailDto })
  issue(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: IssueInvoiceDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.invoices.issue(scope(ctx), id, body, idempotencyKey);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('finance.invoices.cancel')
  @ApiOperation({ operationId: 'cancelInvoice', summary: 'Cancel or void an invoice.' })
  @ApiOkResponse({ type: InvoiceDetailDto })
  cancel(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: CancelInvoiceDto,
  ) {
    return this.invoices.cancel(scope(ctx), id, body);
  }
}
