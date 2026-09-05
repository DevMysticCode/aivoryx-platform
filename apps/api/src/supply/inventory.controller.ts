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
import { InventoryService } from './inventory.service.js';
import { scope } from './common.js';
import {
  AdjustStockDto,
  ListMovementsQueryDto,
  ListStockQueryDto,
  StockLevelDto,
  StockLevelListDto,
  StockMovementListDto,
  TransferStockDto,
} from './inventory.dto.js';

/**
 * Inventory reads and manual movements (Phase 5, ADR 0034). Stock is
 * accounted through the `stock_movements` ledger; these endpoints read the
 * maintained projection and post manual adjustments / transfers.
 */
@ApiTags('inventory')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('stock')
  @RequirePermission('inventory.read')
  @ApiOperation({ operationId: 'listStock', summary: 'Current stock levels across warehouses.' })
  @ApiOkResponse({ type: StockLevelListDto })
  listStock(@Security() ctx: SecurityContext, @Query() query: ListStockQueryDto) {
    return this.inventory.listStock(scope(ctx), query);
  }

  @Get('movements')
  @RequirePermission('inventory.read')
  @ApiOperation({ operationId: 'listStockMovements', summary: 'The stock movement ledger.' })
  @ApiOkResponse({ type: StockMovementListDto })
  listMovements(@Security() ctx: SecurityContext, @Query() query: ListMovementsQueryDto) {
    return this.inventory.listMovements(scope(ctx), query);
  }

  @Post('adjustments')
  @HttpCode(200)
  @RequirePermission('inventory.adjust')
  @ApiOperation({ operationId: 'adjustStock', summary: 'Post a manual stock adjustment.' })
  @ApiOkResponse({ type: [StockLevelDto] })
  adjust(@Security() ctx: SecurityContext, @Body() body: AdjustStockDto) {
    return this.inventory.adjust(scope(ctx), body);
  }

  @Post('transfers')
  @HttpCode(200)
  @RequirePermission('inventory.transfer')
  @ApiOperation({ operationId: 'transferStock', summary: 'Transfer stock between warehouses.' })
  @ApiOkResponse({ type: [StockLevelDto] })
  transfer(@Security() ctx: SecurityContext, @Body() body: TransferStockDto) {
    return this.inventory.transfer(scope(ctx), body);
  }

  @Get('warehouses/:id/stock')
  @RequirePermission('inventory.read')
  @ApiOperation({ operationId: 'listWarehouseStock', summary: 'Stock held in one warehouse.' })
  @ApiOkResponse({ type: [StockLevelDto] })
  warehouseStock(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.inventory.warehouseStock(scope(ctx), id);
  }
}
