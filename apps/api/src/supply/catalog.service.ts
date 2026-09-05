import { Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { isUniqueViolation, pageBounds, type Paged, type TenantScope } from './common.js';
import type {
  CategoryDto,
  CreateProductDto,
  CreateSupplierDto,
  CreateWarehouseDto,
  ProductDto,
  SupplierDto,
  UnitDto,
  UpdateProductDto,
  UpdateSupplierDto,
  UpdateWarehouseDto,
  UpsertCategoryDto,
  UpsertUnitDto,
  WarehouseDto,
} from './catalog.dto.js';

const { units, productCategories, products, suppliers, warehouses } = schema;

@Injectable()
export class CatalogService {
  // ---- units ------------------------------------------------------

  listUnits(scope: TenantScope): Promise<UnitDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(units)
        .where(eq(units.tenantId, scope.tenantId))
        .orderBy(asc(units.code));
      return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, isActive: r.isActive }));
    });
  }

  async upsertUnit(scope: TenantScope, body: UpsertUnitDto): Promise<UnitDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      try {
        const [row] = await tx
          .insert(units)
          .values({
            tenantId: scope.tenantId,
            code: body.code,
            name: body.name,
            isActive: body.isActive ?? true,
          })
          .onConflictDoUpdate({
            target: [units.tenantId, units.code],
            set: { name: body.name, isActive: body.isActive ?? true, updatedAt: new Date() },
          })
          .returning();
        return { id: row!.id, code: row!.code, name: row!.name, isActive: row!.isActive };
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('DUPLICATE_CODE', { details: { code: body.code } });
        throw err;
      }
    });
  }

  // ---- categories -----------------------------------------------

  listCategories(scope: TenantScope): Promise<CategoryDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(productCategories)
        .where(eq(productCategories.tenantId, scope.tenantId))
        .orderBy(asc(productCategories.code));
      return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, isActive: r.isActive }));
    });
  }

  async upsertCategory(scope: TenantScope, body: UpsertCategoryDto): Promise<CategoryDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      try {
        const [row] = await tx
          .insert(productCategories)
          .values({
            tenantId: scope.tenantId,
            code: body.code,
            name: body.name,
            isActive: body.isActive ?? true,
          })
          .onConflictDoUpdate({
            target: [productCategories.tenantId, productCategories.code],
            set: { name: body.name, isActive: body.isActive ?? true, updatedAt: new Date() },
          })
          .returning();
        return { id: row!.id, code: row!.code, name: row!.name, isActive: row!.isActive };
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('DUPLICATE_CODE', { details: { code: body.code } });
        throw err;
      }
    });
  }

  // ---- products -----------------------------------------------

  async listProducts(
    scope: TenantScope,
    filter: {
      q?: string;
      categoryId?: string;
      isActive?: boolean;
      page?: number;
      pageSize?: number;
    },
  ): Promise<Paged<ProductDto>> {
    const { page, pageSize } = pageBounds(filter.page, filter.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds = [eq(products.tenantId, scope.tenantId)];
      if (filter.categoryId) conds.push(eq(products.categoryId, filter.categoryId));
      if (filter.isActive !== undefined) conds.push(eq(products.isActive, filter.isActive));
      if (filter.q?.trim()) {
        const like = `%${filter.q.trim()}%`;
        conds.push(or(ilike(products.name, like), ilike(products.sku, like))!);
      }
      const where = and(...conds);
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(products)
        .where(where);
      const rows = await tx
        .select({
          p: products,
          unitCode: units.code,
          categoryName: productCategories.name,
        })
        .from(products)
        .leftJoin(units, eq(units.id, products.unitId))
        .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
        .where(where)
        .orderBy(asc(products.sku))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows.map((r) => toProductDto(r.p, r.unitCode, r.categoryName)),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  async getProduct(scope: TenantScope, id: string): Promise<ProductDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const row = await loadProduct(tx, scope.tenantId, id);
      if (!row) throw new AppError('PRODUCT_NOT_FOUND');
      return row;
    });
  }

  async createProduct(scope: TenantScope, body: CreateProductDto): Promise<ProductDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireUnit(tx, scope.tenantId, body.unitId);
      if (body.categoryId) await this.requireCategory(tx, scope.tenantId, body.categoryId);
      try {
        const [row] = await tx
          .insert(products)
          .values({
            tenantId: scope.tenantId,
            sku: body.sku,
            name: body.name,
            description: body.description ?? null,
            unitId: body.unitId,
            categoryId: body.categoryId ?? null,
            brand: body.brand ?? null,
            model: body.model ?? null,
            reorderLevel: body.reorderLevel ?? null,
            isActive: body.isActive ?? true,
          })
          .returning({ id: products.id });
        return (await loadProduct(tx, scope.tenantId, row!.id))!;
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('DUPLICATE_CODE', { details: { sku: body.sku } });
        throw err;
      }
    });
  }

  async updateProduct(scope: TenantScope, id: string, body: UpdateProductDto): Promise<ProductDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const current = await loadProduct(tx, scope.tenantId, id);
      if (!current) throw new AppError('PRODUCT_NOT_FOUND');
      if (body.unitId) await this.requireUnit(tx, scope.tenantId, body.unitId);
      if (body.categoryId) await this.requireCategory(tx, scope.tenantId, body.categoryId);
      await tx
        .update(products)
        .set({
          name: body.name ?? undefined,
          description: body.description ?? undefined,
          unitId: body.unitId ?? undefined,
          categoryId: body.categoryId === undefined ? undefined : body.categoryId,
          brand: body.brand ?? undefined,
          model: body.model ?? undefined,
          reorderLevel: body.reorderLevel ?? undefined,
          isActive: body.isActive ?? undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(products.id, id), eq(products.tenantId, scope.tenantId)));
      return (await loadProduct(tx, scope.tenantId, id))!;
    });
  }

  // ---- suppliers --------------------------------------------

  listSuppliers(scope: TenantScope, q?: string): Promise<SupplierDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds = [eq(suppliers.tenantId, scope.tenantId)];
      if (q?.trim()) {
        const like = `%${q.trim()}%`;
        conds.push(or(ilike(suppliers.name, like), ilike(suppliers.code, like))!);
      }
      const rows = await tx
        .select()
        .from(suppliers)
        .where(and(...conds))
        .orderBy(asc(suppliers.name));
      return rows.map(toSupplierDto);
    });
  }

  async getSupplier(scope: TenantScope, id: string): Promise<SupplierDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, scope.tenantId)));
      if (!row) throw new AppError('SUPPLIER_NOT_FOUND');
      return toSupplierDto(row);
    });
  }

  async createSupplier(scope: TenantScope, body: CreateSupplierDto): Promise<SupplierDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      try {
        const [row] = await tx
          .insert(suppliers)
          .values({
            ...supplierValues(body),
            tenantId: scope.tenantId,
            code: body.code,
            name: body.name,
          })
          .returning();
        return toSupplierDto(row!);
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('DUPLICATE_CODE', { details: { code: body.code } });
        throw err;
      }
    });
  }

  async updateSupplier(
    scope: TenantScope,
    id: string,
    body: UpdateSupplierDto,
  ): Promise<SupplierDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [current] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, scope.tenantId)));
      if (!current) throw new AppError('SUPPLIER_NOT_FOUND');
      await tx
        .update(suppliers)
        .set({
          ...supplierValues(body),
          code: body.code ?? undefined,
          name: body.name ?? undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, scope.tenantId)));
      return this.getSupplier(scope, id);
    });
  }

  // ---- warehouses ----------------------------------------

  listWarehouses(scope: TenantScope): Promise<WarehouseDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(warehouses)
        .where(eq(warehouses.tenantId, scope.tenantId))
        .orderBy(asc(warehouses.name));
      return rows.map(toWarehouseDto);
    });
  }

  async getWarehouse(scope: TenantScope, id: string): Promise<WarehouseDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, scope.tenantId)));
      if (!row) throw new AppError('WAREHOUSE_NOT_FOUND');
      return toWarehouseDto(row);
    });
  }

  async createWarehouse(scope: TenantScope, body: CreateWarehouseDto): Promise<WarehouseDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      try {
        const [row] = await tx
          .insert(warehouses)
          .values({
            ...warehouseValues(body),
            tenantId: scope.tenantId,
            code: body.code,
            name: body.name,
            type: body.type,
          })
          .returning();
        return toWarehouseDto(row!);
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('DUPLICATE_CODE', { details: { code: body.code } });
        throw err;
      }
    });
  }

  async updateWarehouse(
    scope: TenantScope,
    id: string,
    body: UpdateWarehouseDto,
  ): Promise<WarehouseDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [current] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, scope.tenantId)));
      if (!current) throw new AppError('WAREHOUSE_NOT_FOUND');
      await tx
        .update(warehouses)
        .set({
          ...warehouseValues(body),
          code: body.code ?? undefined,
          name: body.name ?? undefined,
          type: body.type ?? undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, scope.tenantId)));
      return this.getWarehouse(scope, id);
    });
  }

  // ---- helpers ----------------------------------------

  private async requireUnit(tx: Tx, tenantId: string, unitId: string): Promise<void> {
    const [row] = await tx
      .select({ id: units.id })
      .from(units)
      .where(and(eq(units.id, unitId), eq(units.tenantId, tenantId)));
    if (!row) throw new AppError('UNIT_NOT_FOUND', { details: { unitId } });
  }

  private async requireCategory(tx: Tx, tenantId: string, categoryId: string): Promise<void> {
    const [row] = await tx
      .select({ id: productCategories.id })
      .from(productCategories)
      .where(and(eq(productCategories.id, categoryId), eq(productCategories.tenantId, tenantId)));
    if (!row) throw new AppError('CATEGORY_NOT_FOUND', { details: { categoryId } });
  }
}

// ---- row -> dto ------------------------------------------------

function toProductDto(
  p: typeof products.$inferSelect,
  unitCode: string | null,
  categoryName: string | null,
): ProductDto {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    unitId: p.unitId,
    unitCode: unitCode ?? '',
    categoryId: p.categoryId,
    categoryName,
    brand: p.brand,
    model: p.model,
    reorderLevel: p.reorderLevel,
    isActive: p.isActive,
    createdAt: p.createdAt.toISOString(),
  };
}

async function loadProduct(tx: Tx, tenantId: string, id: string): Promise<ProductDto | undefined> {
  const [row] = await tx
    .select({ p: products, unitCode: units.code, categoryName: productCategories.name })
    .from(products)
    .leftJoin(units, eq(units.id, products.unitId))
    .leftJoin(productCategories, eq(productCategories.id, products.categoryId))
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId)));
  return row ? toProductDto(row.p, row.unitCode, row.categoryName) : undefined;
}

function supplierValues(body: Partial<CreateSupplierDto>) {
  return {
    contactName: body.contactName ?? undefined,
    contactEmail: body.contactEmail ?? undefined,
    contactPhone: body.contactPhone ?? undefined,
    addressLine: body.addressLine ?? undefined,
    city: body.city ?? undefined,
    state: body.state ?? undefined,
    postalCode: body.postalCode ?? undefined,
    country: body.country ?? undefined,
    taxReference: body.taxReference ?? undefined,
    notes: body.notes ?? undefined,
    isActive: body.isActive ?? undefined,
  };
}

function toSupplierDto(r: typeof suppliers.$inferSelect): SupplierDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    contactName: r.contactName,
    contactEmail: r.contactEmail,
    contactPhone: r.contactPhone,
    addressLine: r.addressLine,
    city: r.city,
    state: r.state,
    postalCode: r.postalCode,
    country: r.country,
    taxReference: r.taxReference,
    notes: r.notes,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  };
}

function warehouseValues(body: Partial<CreateWarehouseDto>) {
  return {
    addressLine: body.addressLine ?? undefined,
    city: body.city ?? undefined,
    state: body.state ?? undefined,
    postalCode: body.postalCode ?? undefined,
    country: body.country ?? undefined,
    isActive: body.isActive ?? undefined,
  };
}

function toWarehouseDto(r: typeof warehouses.$inferSelect): WarehouseDto {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    addressLine: r.addressLine,
    city: r.city,
    state: r.state,
    postalCode: r.postalCode,
    country: r.country,
    isActive: r.isActive,
    createdAt: r.createdAt.toISOString(),
  };
}
