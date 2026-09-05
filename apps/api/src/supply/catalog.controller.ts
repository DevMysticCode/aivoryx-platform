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
import { CatalogService } from './catalog.service.js';
import { scope } from './common.js';
import {
  CategoryDto,
  CreateProductDto,
  CreateSupplierDto,
  CreateWarehouseDto,
  ListProductsQueryDto,
  ProductDto,
  ProductListDto,
  SupplierDto,
  UnitDto,
  UpdateProductDto,
  UpdateSupplierDto,
  UpdateWarehouseDto,
  UpsertCategoryDto,
  UpsertUnitDto,
  WarehouseDto,
} from './catalog.dto.js';

/**
 * Master data for the supply chain (Phase 5, ADR 0034): units, categories,
 * products, suppliers, warehouses. All RLS-scoped, all gated by the existing
 * RBAC catalogue.
 */
@ApiTags('inventory')
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@ApiForbiddenResponse({ type: ApiErrorDto })
@Controller('inventory')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ---- units ----
  @Get('units')
  @RequirePermission('products.read')
  @ApiOperation({ operationId: 'listUnits', summary: 'Units of measure.' })
  @ApiOkResponse({ type: [UnitDto] })
  listUnits(@Security() ctx: SecurityContext) {
    return this.catalog.listUnits(scope(ctx));
  }

  @Post('units')
  @HttpCode(200)
  @RequirePermission('products.create')
  @ApiOperation({ operationId: 'upsertUnit', summary: 'Create or update a unit of measure.' })
  @ApiOkResponse({ type: UnitDto })
  upsertUnit(@Security() ctx: SecurityContext, @Body() body: UpsertUnitDto) {
    return this.catalog.upsertUnit(scope(ctx), body);
  }

  // ---- categories ----
  @Get('categories')
  @RequirePermission('products.read')
  @ApiOperation({ operationId: 'listCategories', summary: 'Product categories.' })
  @ApiOkResponse({ type: [CategoryDto] })
  listCategories(@Security() ctx: SecurityContext) {
    return this.catalog.listCategories(scope(ctx));
  }

  @Post('categories')
  @HttpCode(200)
  @RequirePermission('products.create')
  @ApiOperation({ operationId: 'upsertCategory', summary: 'Create or update a product category.' })
  @ApiOkResponse({ type: CategoryDto })
  upsertCategory(@Security() ctx: SecurityContext, @Body() body: UpsertCategoryDto) {
    return this.catalog.upsertCategory(scope(ctx), body);
  }

  // ---- products ----
  @Get('products')
  @RequirePermission('products.read')
  @ApiOperation({ operationId: 'listProducts', summary: 'Search the product catalogue.' })
  @ApiOkResponse({ type: ProductListDto })
  listProducts(@Security() ctx: SecurityContext, @Query() query: ListProductsQueryDto) {
    return this.catalog.listProducts(scope(ctx), query);
  }

  @Get('products/:id')
  @RequirePermission('products.read')
  @ApiOperation({ operationId: 'getProduct', summary: 'A single product.' })
  @ApiOkResponse({ type: ProductDto })
  getProduct(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.catalog.getProduct(scope(ctx), id);
  }

  @Post('products')
  @HttpCode(200)
  @RequirePermission('products.create')
  @ApiOperation({ operationId: 'createProduct', summary: 'Add a product.' })
  @ApiOkResponse({ type: ProductDto })
  createProduct(@Security() ctx: SecurityContext, @Body() body: CreateProductDto) {
    return this.catalog.createProduct(scope(ctx), body);
  }

  @Patch('products/:id')
  @RequirePermission('products.update')
  @ApiOperation({ operationId: 'updateProduct', summary: 'Edit a product.' })
  @ApiOkResponse({ type: ProductDto })
  updateProduct(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(scope(ctx), id, body);
  }

  // ---- suppliers ----
  @Get('suppliers')
  @RequirePermission('suppliers.read')
  @ApiOperation({ operationId: 'listSuppliers', summary: 'Suppliers/vendors.' })
  @ApiOkResponse({ type: [SupplierDto] })
  listSuppliers(@Security() ctx: SecurityContext, @Query('q') q?: string) {
    return this.catalog.listSuppliers(scope(ctx), q);
  }

  @Get('suppliers/:id')
  @RequirePermission('suppliers.read')
  @ApiOperation({ operationId: 'getSupplier', summary: 'A single supplier.' })
  @ApiOkResponse({ type: SupplierDto })
  getSupplier(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.catalog.getSupplier(scope(ctx), id);
  }

  @Post('suppliers')
  @HttpCode(200)
  @RequirePermission('suppliers.create')
  @ApiOperation({ operationId: 'createSupplier', summary: 'Add a supplier.' })
  @ApiOkResponse({ type: SupplierDto })
  createSupplier(@Security() ctx: SecurityContext, @Body() body: CreateSupplierDto) {
    return this.catalog.createSupplier(scope(ctx), body);
  }

  @Patch('suppliers/:id')
  @RequirePermission('suppliers.update')
  @ApiOperation({ operationId: 'updateSupplier', summary: 'Edit a supplier.' })
  @ApiOkResponse({ type: SupplierDto })
  updateSupplier(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateSupplierDto,
  ) {
    return this.catalog.updateSupplier(scope(ctx), id, body);
  }

  // ---- warehouses ----
  @Get('warehouses')
  @RequirePermission('warehouses.read')
  @ApiOperation({ operationId: 'listWarehouses', summary: 'Warehouses / stock locations.' })
  @ApiOkResponse({ type: [WarehouseDto] })
  listWarehouses(@Security() ctx: SecurityContext) {
    return this.catalog.listWarehouses(scope(ctx));
  }

  @Get('warehouses/:id')
  @RequirePermission('warehouses.read')
  @ApiOperation({ operationId: 'getWarehouse', summary: 'A single warehouse.' })
  @ApiOkResponse({ type: WarehouseDto })
  getWarehouse(@Security() ctx: SecurityContext, @Param('id') id: string) {
    return this.catalog.getWarehouse(scope(ctx), id);
  }

  @Post('warehouses')
  @HttpCode(200)
  @RequirePermission('warehouses.create')
  @ApiOperation({ operationId: 'createWarehouse', summary: 'Add a warehouse.' })
  @ApiOkResponse({ type: WarehouseDto })
  createWarehouse(@Security() ctx: SecurityContext, @Body() body: CreateWarehouseDto) {
    return this.catalog.createWarehouse(scope(ctx), body);
  }

  @Patch('warehouses/:id')
  @RequirePermission('warehouses.update')
  @ApiOperation({ operationId: 'updateWarehouse', summary: 'Edit a warehouse.' })
  @ApiOkResponse({ type: WarehouseDto })
  updateWarehouse(
    @Security() ctx: SecurityContext,
    @Param('id') id: string,
    @Body() body: UpdateWarehouseDto,
  ) {
    return this.catalog.updateWarehouse(scope(ctx), id, body);
  }
}
