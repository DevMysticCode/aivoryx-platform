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
import { ProcurementService } from './procurement.service.js';
import { scope } from './common.js';
import {
  CreatePurchaseOrderDto,
  ListPurchaseOrdersQueryDto,
  PurchaseOrderDetailDto,
  PurchaseOrderListDto,
  ReceivePurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './procurement.dto.js';

/**
 * Procurement — purchase orders and goods receipts (Phase 5, ADR 0034).
 */
@ApiTags('procurement')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('procurement/purchase-orders')
export class ProcurementController {
  constructor(private readonly procurement: ProcurementService) {}

  @Get()
  @RequirePermission('procurement.read')
  @ApiOperation({ operationId: 'listPurchaseOrders', summary: 'Search purchase orders.' })
  @ApiOkResponse({ type: PurchaseOrderListDto })
  list(@Security() ctx: SecurityContext, @Query() query: ListPurchaseOrdersQueryDto) {
    return this.procurement.list(scope(ctx), query);
  }

  @Get(':id')
  @RequirePermission('procurement.read')
  @ApiOperation({
    operationId: 'getPurchaseOrder',
    summary: 'A purchase order with lines and receipts.',
  })
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  get(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.procurement.get(scope(ctx), id);
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('procurement.create')
  @ApiOperation({ operationId: 'createPurchaseOrder', summary: 'Create a draft purchase order.' })
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  create(@Security() ctx: SecurityContext, @Body() body: CreatePurchaseOrderDto) {
    return this.procurement.create(scope(ctx), body);
  }

  @Patch(':id')
  @RequirePermission('procurement.update')
  @ApiOperation({ operationId: 'updatePurchaseOrder', summary: 'Edit a draft purchase order.' })
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  update(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdatePurchaseOrderDto,
  ) {
    return this.procurement.update(scope(ctx), id, body);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('procurement.update')
  @ApiOperation({ operationId: 'submitPurchaseOrder', summary: 'Submit a draft PO for approval.' })
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  submit(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.procurement.transition(scope(ctx), id, 'SUBMITTED');
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('procurement.approve')
  @ApiOperation({ operationId: 'approvePurchaseOrder', summary: 'Approve a submitted PO.' })
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  approve(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.procurement.transition(scope(ctx), id, 'APPROVED');
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('procurement.update')
  @ApiOperation({
    operationId: 'cancelPurchaseOrder',
    summary: 'Cancel a PO before it is received.',
  })
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  cancel(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.procurement.transition(scope(ctx), id, 'CANCELLED');
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermission('procurement.update')
  @ApiOperation({ operationId: 'closePurchaseOrder', summary: 'Close a received PO.' })
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  close(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.procurement.transition(scope(ctx), id, 'CLOSED');
  }

  @Post(':id/receive')
  @HttpCode(200)
  @RequirePermission('procurement.receive')
  @ApiOperation({
    operationId: 'receivePurchaseOrder',
    summary: 'Record goods received against a PO.',
  })
  @ApiOkResponse({ type: PurchaseOrderDetailDto })
  receive(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: ReceivePurchaseOrderDto,
  ) {
    return this.procurement.receive(scope(ctx), id, body);
  }
}
