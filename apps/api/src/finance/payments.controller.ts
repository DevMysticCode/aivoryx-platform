import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
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
import { PaymentsService } from './payments.service.js';
import { PaymentAllocationService } from './allocations.service.js';
import {
  AllocatePaymentDto,
  ListPaymentsQueryDto,
  PaymentDetailDto,
  PaymentListDto,
  RecordPaymentDto,
  ReversePaymentDto,
} from './finance.dto.js';

/** Payments + allocations (Phase 9, ADR 0038). */
@ApiTags('finance')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('finance/payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly allocations: PaymentAllocationService,
  ) {}

  @Get()
  @RequirePermission('finance.payments.read')
  @ApiOperation({ operationId: 'listPayments', summary: 'Search payments.' })
  @ApiOkResponse({ type: PaymentListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListPaymentsQueryDto) {
    return this.payments.list(scope(ctx), query);
  }

  @Get(':id')
  @RequirePermission('finance.payments.read')
  @ApiOperation({ operationId: 'getPayment', summary: 'One payment with its allocations.' })
  @ApiOkResponse({ type: PaymentDetailDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.payments.get(scope(ctx), id);
  }

  @Get(':id/print')
  @RequirePermission('finance.payments.read')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'private, max-age=0, no-store')
  @ApiProduces('text/html')
  @ApiOperation({ operationId: 'printPaymentReceipt', summary: 'Printable payment receipt.' })
  print(@Security() ctx: SecurityContext, @Param('id') id: string): Promise<string> {
    return this.payments.renderReceipt(scope(ctx), id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('finance.payments.create')
  @ApiOperation({ operationId: 'recordPayment', summary: 'Record a customer payment.' })
  @ApiOkResponse({ type: PaymentDetailDto })
  record(
    @Security() ctx: SecurityContext,
    @Body() body: RecordPaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.payments.record(scope(ctx), body, idempotencyKey);
  }

  @Post(':id/allocate')
  @HttpCode(200)
  @RequirePermission('finance.payments.allocate')
  @ApiOperation({ operationId: 'allocatePayment', summary: 'Allocate a payment to invoices.' })
  @ApiOkResponse({ type: PaymentDetailDto })
  async allocate(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: AllocatePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const s = scope(ctx);
    await this.allocations.allocate(
      s,
      id,
      body.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
      idempotencyKey,
    );
    return this.payments.get(s, id);
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermission('finance.payments.reverse')
  @ApiOperation({ operationId: 'reversePayment', summary: 'Reverse a recorded payment.' })
  @ApiOkResponse({ type: PaymentDetailDto })
  reverse(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: ReversePaymentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.payments.reverse(scope(ctx), id, body.reason, idempotencyKey);
  }
}
