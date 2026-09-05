import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { dec, formatDec } from './decimal.js';
import { applyStockMovement } from './inventory-core.js';
import { pageBounds, type Paged, type TenantScope } from './common.js';
import type {
  AdjustStockDto,
  ListMovementsQueryDto,
  ListStockQueryDto,
  StockLevelDto,
  StockMovementDto,
  TransferStockDto,
} from './inventory.dto.js';

const { stockLevels, stockMovements, products, units, warehouses } = schema;

type MovementType = (typeof stockMovements.type.enumValues)[number];

@Injectable()
export class InventoryService {
  constructor(private readonly outbox: OutboxService) {}

  async listStock(scope: TenantScope, filter: ListStockQueryDto): Promise<Paged<StockLevelDto>> {
    const { page, pageSize } = pageBounds(filter.page, filter.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds = [eq(stockLevels.tenantId, scope.tenantId)];
      if (filter.warehouseId) conds.push(eq(stockLevels.warehouseId, filter.warehouseId));
      if (filter.productId) conds.push(eq(stockLevels.productId, filter.productId));
      if (filter.lowStock) {
        conds.push(
          sql`${products.reorderLevel} is not null and ${stockLevels.onHand} <= ${products.reorderLevel}`,
        );
      }
      const where = and(...conds);
      const base = tx
        .select({
          s: stockLevels,
          whCode: warehouses.code,
          whName: warehouses.name,
          sku: products.sku,
          name: products.name,
          unitCode: units.code,
          reorderLevel: products.reorderLevel,
        })
        .from(stockLevels)
        .leftJoin(warehouses, eq(warehouses.id, stockLevels.warehouseId))
        .leftJoin(products, eq(products.id, stockLevels.productId))
        .leftJoin(units, eq(units.id, products.unitId))
        .where(where);

      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(stockLevels)
        .leftJoin(products, eq(products.id, stockLevels.productId))
        .where(where);

      const rows = await base
        .orderBy(sql`${products.sku} asc`)
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        items: rows.map((r) => {
          const available = formatDec(dec.sub(r.s.onHand, r.s.reserved), 4);
          const lowStock = r.reorderLevel != null && dec.lte(r.s.onHand, r.reorderLevel);
          return {
            warehouseId: r.s.warehouseId,
            warehouseCode: r.whCode ?? '',
            warehouseName: r.whName ?? '',
            productId: r.s.productId,
            productSku: r.sku ?? '',
            productName: r.name ?? '',
            unitCode: r.unitCode ?? '',
            onHand: r.s.onHand,
            reserved: r.s.reserved,
            available,
            reorderLevel: r.reorderLevel,
            lowStock,
          };
        }),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  async warehouseStock(scope: TenantScope, warehouseId: string): Promise<StockLevelDto[]> {
    const res = await this.listStock(scope, { warehouseId, pageSize: 200 });
    return res.items;
  }

  async listMovements(
    scope: TenantScope,
    filter: ListMovementsQueryDto,
  ): Promise<Paged<StockMovementDto>> {
    const { page, pageSize } = pageBounds(filter.page, filter.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds = [eq(stockMovements.tenantId, scope.tenantId)];
      if (filter.warehouseId) conds.push(eq(stockMovements.warehouseId, filter.warehouseId));
      if (filter.productId) conds.push(eq(stockMovements.productId, filter.productId));
      if (filter.projectId) conds.push(eq(stockMovements.projectId, filter.projectId));
      if (filter.type) conds.push(eq(stockMovements.type, filter.type as MovementType));
      const where = and(...conds);
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(stockMovements)
        .where(where);
      const rows = await tx
        .select({
          m: stockMovements,
          whCode: warehouses.code,
          sku: products.sku,
        })
        .from(stockMovements)
        .leftJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
        .leftJoin(products, eq(products.id, stockMovements.productId))
        .where(where)
        .orderBy(desc(stockMovements.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows.map((r) => ({
          id: r.m.id,
          type: r.m.type,
          warehouseId: r.m.warehouseId,
          warehouseCode: r.whCode ?? '',
          productId: r.m.productId,
          productSku: r.sku ?? '',
          quantity: r.m.quantity,
          onHandDelta: r.m.onHandDelta,
          reservedDelta: r.m.reservedDelta,
          projectId: r.m.projectId,
          referenceType: r.m.referenceType,
          notes: r.m.notes,
          createdAt: r.m.createdAt.toISOString(),
        })),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  async adjust(scope: TenantScope, body: AdjustStockDto): Promise<StockLevelDto[]> {
    if (dec.isZero(body.delta)) {
      throw new AppError('VALIDATION_ERROR', {
        details: { field: 'delta', hint: 'must be non-zero' },
      });
    }
    return withTenantContext(getDb(), scope, async (tx) => {
      if (
        body.idempotencyKey &&
        (await seenKey(tx, scope.tenantId, `adjust:${body.idempotencyKey}`))
      ) {
        return this.warehouseStock(scope, body.warehouseId);
      }
      await requireWarehouse(tx, scope.tenantId, body.warehouseId);
      await requireProduct(tx, scope.tenantId, body.productId);
      await applyStockMovement(tx, {
        tenantId: scope.tenantId,
        warehouseId: body.warehouseId,
        productId: body.productId,
        type: 'ADJUSTMENT',
        quantity: body.delta,
        referenceType: 'adjustment',
        notes: body.reason,
        actorMembershipId: scope.actorMembershipId,
      });
      await stampKey(
        tx,
        scope.tenantId,
        body.warehouseId,
        body.productId,
        'ADJUSTMENT',
        body.idempotencyKey ? `adjust:${body.idempotencyKey}` : null,
      );
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'inventory.adjusted',
        payload: {
          warehouseId: body.warehouseId,
          productId: body.productId,
          delta: body.delta,
        },
      });
      return this.warehouseStock(scope, body.warehouseId);
    });
  }

  async transfer(scope: TenantScope, body: TransferStockDto): Promise<StockLevelDto[]> {
    if (body.sourceWarehouseId === body.destinationWarehouseId) {
      throw new AppError('TRANSFER_SAME_WAREHOUSE');
    }
    if (!dec.isPos(body.quantity)) {
      throw new AppError('VALIDATION_ERROR', { details: { field: 'quantity' } });
    }
    return withTenantContext(getDb(), scope, async (tx) => {
      if (
        body.idempotencyKey &&
        (await seenKey(tx, scope.tenantId, `transfer_out:${body.idempotencyKey}`))
      ) {
        return this.warehouseStock(scope, body.sourceWarehouseId);
      }
      await requireWarehouse(tx, scope.tenantId, body.sourceWarehouseId);
      await requireWarehouse(tx, scope.tenantId, body.destinationWarehouseId);
      await requireProduct(tx, scope.tenantId, body.productId);

      // consistent lock order: lower warehouse id first is impractical; instead
      // both movements go through applyStockMovement which locks each level row
      // individually — the source is decremented first (and checked for
      // sufficiency), then the destination is incremented.
      await applyStockMovement(tx, {
        tenantId: scope.tenantId,
        warehouseId: body.sourceWarehouseId,
        productId: body.productId,
        type: 'TRANSFER_OUT',
        quantity: body.quantity,
        referenceType: 'transfer',
        notes: body.notes ?? null,
        actorMembershipId: scope.actorMembershipId,
      });
      await applyStockMovement(tx, {
        tenantId: scope.tenantId,
        warehouseId: body.destinationWarehouseId,
        productId: body.productId,
        type: 'TRANSFER_IN',
        quantity: body.quantity,
        referenceType: 'transfer',
        notes: body.notes ?? null,
        actorMembershipId: scope.actorMembershipId,
      });
      if (body.idempotencyKey) {
        await stampKey(
          tx,
          scope.tenantId,
          body.sourceWarehouseId,
          body.productId,
          'TRANSFER_OUT',
          `transfer_out:${body.idempotencyKey}`,
        );
      }
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'inventory.transferred',
        payload: {
          sourceWarehouseId: body.sourceWarehouseId,
          destinationWarehouseId: body.destinationWarehouseId,
          productId: body.productId,
          quantity: body.quantity,
        },
      });
      return this.warehouseStock(scope, body.sourceWarehouseId);
    });
  }
}

// ---- helpers ---------------------------------------------------

async function seenKey(tx: Tx, tenantId: string, key: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(and(eq(stockMovements.tenantId, tenantId), eq(stockMovements.idempotencyKey, key)));
  return !!row;
}

async function stampKey(
  tx: Tx,
  tenantId: string,
  warehouseId: string,
  productId: string,
  type: MovementType,
  key: string | undefined | null,
): Promise<void> {
  if (!key) return;
  await tx
    .update(stockMovements)
    .set({ idempotencyKey: key })
    .where(
      and(
        eq(stockMovements.tenantId, tenantId),
        eq(stockMovements.warehouseId, warehouseId),
        eq(stockMovements.productId, productId),
        eq(stockMovements.type, type),
        sql`${stockMovements.idempotencyKey} is null`,
      ),
    );
}

async function requireWarehouse(tx: Tx, tenantId: string, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId)));
  if (!row) throw new AppError('WAREHOUSE_NOT_FOUND', { details: { warehouseId: id } });
}

async function requireProduct(tx: Tx, tenantId: string, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.id, id), eq(products.tenantId, tenantId)));
  if (!row) throw new AppError('PRODUCT_NOT_FOUND', { details: { productId: id } });
}
