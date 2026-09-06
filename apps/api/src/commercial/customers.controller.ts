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
import { scope } from '../supply/common.js';
import { CustomersService } from './customers.service.js';
import {
  CreateCustomerDto,
  CustomerDetailDto,
  CustomerListDto,
  ListCustomersQueryDto,
  PromoteLeadDto,
  UpdateCustomerDto,
} from './commercial.dto.js';

/**
 * Customers — the reusable commercial party (Phase 6, ADR 0035). A lead is
 * promoted to a customer rather than its data being copied.
 */
@ApiTags('customers')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customers.read')
  @ApiOperation({ operationId: 'listCustomers', summary: 'Search customers.' })
  @ApiOkResponse({ type: CustomerListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListCustomersQueryDto) {
    return this.customers.list(scope(ctx), query);
  }

  @Get(':id')
  @RequirePermission('customers.read')
  @ApiOperation({ operationId: 'getCustomer', summary: 'A customer with linked records.' })
  @ApiOkResponse({ type: CustomerDetailDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.customers.get(scope(ctx), id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('customers.create')
  @ApiOperation({ operationId: 'createCustomer', summary: 'Create a customer.' })
  @ApiOkResponse({ type: CustomerDetailDto })
  create(@Security() ctx: SecurityContext, @Body() body: CreateCustomerDto) {
    return this.customers.create(scope(ctx), body);
  }

  @Patch(':id')
  @RequirePermission('customers.update')
  @ApiOperation({ operationId: 'updateCustomer', summary: 'Edit a customer.' })
  @ApiOkResponse({ type: CustomerDetailDto })
  update(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateCustomerDto,
  ) {
    return this.customers.update(scope(ctx), id, body);
  }

  @Post('from-lead/:leadId')
  @HttpCode(200)
  @RequirePermission('customers.create')
  @ApiOperation({
    operationId: 'promoteLeadToCustomer',
    summary: 'Promote a CRM lead to a customer.',
  })
  @ApiOkResponse({ type: CustomerDetailDto })
  promote(
    @Security() ctx: SecurityContext,
    @Param('leadId') leadId: string,
    @Body() body: PromoteLeadDto,
  ) {
    return this.customers.promoteFromLead(scope(ctx), leadId, body.number);
  }
}
