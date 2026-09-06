import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { dec, formatDec, lineTotal, sumMoney } from './decimal.js';
import { applyStockMovement } from './inventory-core.js';
import { isValidPoTransition, poCanReceive, poIsEditable } from './lifecycles.js';
import { isUniqueViolation, pageBounds, type Paged, type TenantScope } from './common.js';
import type {
  CreatePurchaseOrderDto,
  ListPurchaseOrdersQueryDto,
  PoLineInputDto,
  PurchaseOrderDetailDto,
  PurchaseOrderDto,
  ReceivePurchaseOrderDto,
  UpdatePurchaseOrderDto,
} from './procurement.dto.js';

const {
  purchaseOrders,
  purchaseOrderLines,
  goodsReceipts,
  goodsReceiptLines,
  suppliers,
  products,
  warehouses,
  projects,
  projectActivities,
} = schema;

type PoStatus = (typeof purchaseOrders.status.enumValues)[number];

@Injectable()
export class ProcurementService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async list(
    scope: TenantScope,
    filter: ListPurchaseOrdersQueryDto,
  ): Promise<Paged<PurchaseOrderDto>> {
    const { page, pageSize } = pageBounds(filter.page, filter.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds = [eq(purchaseOrders.tenantId, scope.tenantId)];
      if (filter.status) conds.push(eq(purchaseOrders.status, filter.status as PoStatus));
      if (filter.supplierId) conds.push(eq(purchaseOrders.supplierId, filter.supplierId));
      if (filter.projectId) conds.push(eq(purchaseOrders.projectId, filter.projectId));
      const where = and(...conds);
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(purchaseOrders)
        .where(where);
      const rows = await tx
        .select({
          po: purchaseOrders,
          supplierName: suppliers.name,
          projectNumber: projects.number,
        })
        .from(purchaseOrders)
        .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
        .leftJoin(projects, eq(projects.id, purchaseOrders.projectId))
        .where(where)
        .orderBy(desc(purchaseOrders.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows.map((r) => toPoDto(r.po, r.supplierName, r.projectNumber)),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  async get(scope: TenantScope, id: string): Promise<PurchaseOrderDetailDto> {
    return withTenantContext(getDb(), scope, (tx) => loadPoDetail(tx, scope.tenantId, id));
  }

  async create(scope: TenantScope, body: CreatePurchaseOrderDto): Promise<PurchaseOrderDetailDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      await requireSupplier(tx, scope.tenantId, body.supplierId);
      if (body.projectId) await requireProject(tx, scope.tenantId, body.projectId);
      const priced = await this.priceLines(tx, scope.tenantId, body.lines);
      const totals = poTotals(priced);
      const number = body.number?.trim() || `PO-${randomUUID().slice(0, 8).toUpperCase()}`;
      try {
        const [po] = await tx
          .insert(purchaseOrders)
          .values({
            tenantId: scope.tenantId,
            number,
            supplierId: body.supplierId,
            projectId: body.projectId ?? null,
            status: 'DRAFT',
            orderDate: body.orderDate ? new Date(body.orderDate) : new Date(),
            expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
            notes: body.notes ?? null,
            subtotal: totals.subtotal,
            taxTotal: totals.taxTotal,
            discountTotal: totals.discountTotal,
            total: totals.total,
            createdByMembershipId: scope.actorMembershipId,
          })
          .returning({ id: purchaseOrders.id });
        const poId = po!.id;
        await tx.insert(purchaseOrderLines).values(
          priced.map((l, i) => ({
            tenantId: scope.tenantId,
            purchaseOrderId: poId,
            productId: l.productId,
            lineNo: i + 1,
            orderedQty: l.orderedQty,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            discount: l.discount,
            lineTotal: l.lineTotal,
          })),
        );
        if (body.projectId) {
          await recordProjectActivity(tx, {
            tenantId: scope.tenantId,
            projectId: body.projectId,
            type: 'purchase_order_linked',
            actorMembershipId: scope.actorMembershipId,
            payload: { purchaseOrderId: poId, number },
          });
        }
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'purchase_order.created',
          payload: { purchaseOrderId: poId, number, supplierId: body.supplierId },
        });
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'purchase_order.created',
          entityType: 'purchase_order',
          entityId: poId,
          actor: userActor(scope),
          metadata: { number, supplierId: body.supplierId, projectId: body.projectId ?? null },
        });
        return poId;
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError('DUPLICATE_CODE', { details: { number } });
        throw err;
      }
    });
    return this.get(scope, id);
  }

  async update(
    scope: TenantScope,
    id: string,
    body: UpdatePurchaseOrderDto,
  ): Promise<PurchaseOrderDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const po = await requirePo(tx, scope.tenantId, id);
      if (!poIsEditable(po.status)) {
        throw new AppError('PO_INVALID_TRANSITION', {
          details: { hint: 'only a draft PO can be edited' },
        });
      }
      if (body.projectId) await requireProject(tx, scope.tenantId, body.projectId);

      let totals: ReturnType<typeof poTotals> | undefined;
      if (body.lines) {
        const priced = await this.priceLines(tx, scope.tenantId, body.lines);
        totals = poTotals(priced);
        await tx
          .delete(purchaseOrderLines)
          .where(
            and(
              eq(purchaseOrderLines.purchaseOrderId, id),
              eq(purchaseOrderLines.tenantId, scope.tenantId),
            ),
          );
        await tx.insert(purchaseOrderLines).values(
          priced.map((l, i) => ({
            tenantId: scope.tenantId,
            purchaseOrderId: id,
            productId: l.productId,
            lineNo: i + 1,
            orderedQty: l.orderedQty,
            unitPrice: l.unitPrice,
            taxRate: l.taxRate,
            discount: l.discount,
            lineTotal: l.lineTotal,
          })),
        );
      }
      await tx
        .update(purchaseOrders)
        .set({
          projectId: body.projectId === undefined ? undefined : body.projectId,
          orderDate: body.orderDate ? new Date(body.orderDate) : undefined,
          expectedDate: body.expectedDate ? new Date(body.expectedDate) : undefined,
          notes: body.notes ?? undefined,
          subtotal: totals?.subtotal,
          taxTotal: totals?.taxTotal,
          discountTotal: totals?.discountTotal,
          total: totals?.total,
          updatedAt: new Date(),
        })
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, scope.tenantId)));
    });
    return this.get(scope, id);
  }

  transition(scope: TenantScope, id: string, to: PoStatus): Promise<PurchaseOrderDetailDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const po = await requirePo(tx, scope.tenantId, id);
      if (!isValidPoTransition(po.status, to)) {
        throw new AppError('PO_INVALID_TRANSITION', { details: { from: po.status, to } });
      }
      const patch: Record<string, unknown> = { status: to, updatedAt: new Date() };
      if (to === 'APPROVED') {
        patch.approvedAt = sql`now()`;
        patch.approvedByMembershipId = scope.actorMembershipId;
      }
      await tx
        .update(purchaseOrders)
        .set(patch)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, scope.tenantId)));
      if (to === 'APPROVED') {
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'purchase_order.approved',
          payload: { purchaseOrderId: id },
          actorMembershipId: scope.actorMembershipId,
        });
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'purchase_order.approved',
          entityType: 'purchase_order',
          entityId: id,
          actor: userActor(scope),
          changes: { status: { from: po.status, to: 'APPROVED' } },
        });
      }
      return loadPoDetail(tx, scope.tenantId, id);
    });
  }

  async receive(
    scope: TenantScope,
    id: string,
    body: ReceivePurchaseOrderDto,
  ): Promise<PurchaseOrderDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      // lock the PO row first so concurrent receipts serialize; the second
      // caller only reaches the idempotency check below after the first commits.
      const [po] = await tx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, scope.tenantId)))
        .for('update');
      if (!po) throw new AppError('PO_NOT_FOUND');

      // idempotency: an existing receipt with this key = no-op.
      if (body.idempotencyKey) {
        const [seen] = await tx
          .select({ id: goodsReceipts.id })
          .from(goodsReceipts)
          .where(
            and(
              eq(goodsReceipts.tenantId, scope.tenantId),
              eq(goodsReceipts.idempotencyKey, body.idempotencyKey),
            ),
          );
        if (seen) return;
      }

      if (!poCanReceive(po.status)) {
        throw new AppError('PO_NOT_APPROVED', { details: { status: po.status } });
      }
      await requireWarehouse(tx, scope.tenantId, body.warehouseId);

      const lines = await tx
        .select()
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.purchaseOrderId, id),
            eq(purchaseOrderLines.tenantId, scope.tenantId),
          ),
        );
      const byId = new Map(lines.map((l) => [l.id, l]));

      const receiptNumber = `GRN-${randomUUID().slice(0, 8).toUpperCase()}`;
      const [gr] = await tx
        .insert(goodsReceipts)
        .values({
          tenantId: scope.tenantId,
          number: receiptNumber,
          purchaseOrderId: id,
          warehouseId: body.warehouseId,
          notes: body.notes ?? null,
          idempotencyKey: body.idempotencyKey ?? null,
          receivedByMembershipId: scope.actorMembershipId,
        })
        .returning({ id: goodsReceipts.id });
      const grId = gr!.id;

      for (const rl of body.lines) {
        const poLine = byId.get(rl.purchaseOrderLineId);
        if (!poLine)
          throw new AppError('PROJECT_MATERIAL_NOT_FOUND', {
            details: { line: rl.purchaseOrderLineId },
          });
        if (!dec.isPos(rl.receivedQty)) {
          throw new AppError('VALIDATION_ERROR', { details: { field: 'receivedQty' } });
        }
        const remaining = formatDec(dec.sub(poLine.orderedQty, poLine.receivedQty), 4);
        if (dec.gt(rl.receivedQty, remaining)) {
          throw new AppError('PO_OVER_RECEIPT', {
            details: { purchaseOrderLineId: rl.purchaseOrderLineId, remaining },
          });
        }
        await tx.insert(goodsReceiptLines).values({
          tenantId: scope.tenantId,
          goodsReceiptId: grId,
          purchaseOrderLineId: rl.purchaseOrderLineId,
          productId: poLine.productId,
          receivedQty: rl.receivedQty,
        });
        await tx
          .update(purchaseOrderLines)
          .set({
            receivedQty: formatDec(dec.add(poLine.receivedQty, rl.receivedQty), 4),
            updatedAt: new Date(),
          })
          .where(eq(purchaseOrderLines.id, rl.purchaseOrderLineId));
        await applyStockMovement(tx, {
          tenantId: scope.tenantId,
          warehouseId: body.warehouseId,
          productId: poLine.productId,
          type: 'RECEIPT',
          quantity: rl.receivedQty,
          projectId: po.projectId,
          referenceType: 'goods_receipt',
          referenceId: grId,
          notes: null,
          actorMembershipId: scope.actorMembershipId,
        });
      }

      // recompute PO status from the (now updated) lines.
      const updatedLines = await tx
        .select({
          ordered: purchaseOrderLines.orderedQty,
          received: purchaseOrderLines.receivedQty,
        })
        .from(purchaseOrderLines)
        .where(
          and(
            eq(purchaseOrderLines.purchaseOrderId, id),
            eq(purchaseOrderLines.tenantId, scope.tenantId),
          ),
        );
      const allReceived = updatedLines.every((l) => dec.gte(l.received, l.ordered));
      const anyReceived = updatedLines.some((l) => dec.isPos(l.received));
      const nextStatus: PoStatus = allReceived
        ? 'RECEIVED'
        : anyReceived
          ? 'PARTIALLY_RECEIVED'
          : po.status;
      if (nextStatus !== po.status) {
        await tx
          .update(purchaseOrders)
          .set({ status: nextStatus, updatedAt: new Date() })
          .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, scope.tenantId)));
      }

      if (po.projectId) {
        await recordProjectActivity(tx, {
          tenantId: scope.tenantId,
          projectId: po.projectId,
          type: 'goods_received',
          actorMembershipId: scope.actorMembershipId,
          payload: { purchaseOrderId: id, goodsReceiptId: grId },
        });
      }
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'purchase_order.received',
        payload: { purchaseOrderId: id, goodsReceiptId: grId, status: nextStatus },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'inventory.received',
        payload: { warehouseId: body.warehouseId, goodsReceiptId: grId },
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'inventory.received',
        entityType: 'goods_receipt',
        entityId: grId,
        actor: userActor(scope),
        metadata: { purchaseOrderId: id, warehouseId: body.warehouseId, poStatus: nextStatus },
      });
    });
    return this.get(scope, id);
  }

  // ---- helpers -----------------------------------------------

  private async priceLines(
    tx: Tx,
    tenantId: string,
    lines: PoLineInputDto[],
  ): Promise<
    Array<
      PoLineInputDto & {
        unitPrice: string;
        taxRate: string;
        discount: string;
        lineTotal: string;
      }
    >
  > {
    const out = [];
    for (const l of lines) {
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, l.productId), eq(products.tenantId, tenantId)));
      if (!product)
        throw new AppError('PRODUCT_NOT_FOUND', { details: { productId: l.productId } });
      if (!dec.isPos(l.orderedQty)) {
        throw new AppError('VALIDATION_ERROR', { details: { field: 'orderedQty' } });
      }
      const unitPrice = l.unitPrice ?? '0';
      const taxRate = l.taxRate ?? '0';
      const discount = l.discount ?? '0';
      const t = lineTotal({ quantity: l.orderedQty, unitPrice, discount, taxRate });
      out.push({ ...l, unitPrice, taxRate, discount, lineTotal: t.total });
    }
    return out;
  }
}

// ---- module-local helpers ----------------------------------

function poTotals(
  lines: Array<{
    orderedQty: string;
    unitPrice: string;
    discount: string;
    taxRate: string;
  }>,
): { subtotal: string; taxTotal: string; discountTotal: string; total: string } {
  const nets: string[] = [];
  const taxes: string[] = [];
  const discounts: string[] = [];
  for (const l of lines) {
    const t = lineTotal({
      quantity: l.orderedQty,
      unitPrice: l.unitPrice,
      discount: l.discount,
      taxRate: l.taxRate,
    });
    nets.push(t.net);
    taxes.push(t.tax);
    discounts.push(l.discount);
  }
  const subtotalStr = sumMoney(nets);
  const taxTotal = sumMoney(taxes);
  const discountTotal = sumMoney(discounts);
  return {
    subtotal: subtotalStr,
    taxTotal,
    discountTotal,
    total: sumMoney([subtotalStr, taxTotal]),
  };
}

type ProjectActivityKind = (typeof projectActivities.type.enumValues)[number];
async function recordProjectActivity(
  tx: Tx,
  input: {
    tenantId: string;
    projectId: string;
    type: ProjectActivityKind;
    actorMembershipId: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(projectActivities).values({
    tenantId: input.tenantId,
    projectId: input.projectId,
    type: input.type,
    actorMembershipId: input.actorMembershipId,
    payload: input.payload ?? {},
  });
}

async function requireSupplier(tx: Tx, tenantId: string, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
  if (!row) throw new AppError('SUPPLIER_NOT_FOUND');
}
async function requireProject(tx: Tx, tenantId: string, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));
  if (!row) throw new AppError('PROJECT_NOT_FOUND');
}
async function requireWarehouse(tx: Tx, tenantId: string, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId)));
  if (!row) throw new AppError('WAREHOUSE_NOT_FOUND');
}
async function requirePo(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<typeof purchaseOrders.$inferSelect> {
  const [row] = await tx
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
  if (!row) throw new AppError('PO_NOT_FOUND');
  return row;
}

function toPoDto(
  po: typeof purchaseOrders.$inferSelect,
  supplierName: string | null,
  projectNumber: string | null,
): PurchaseOrderDto {
  return {
    id: po.id,
    number: po.number,
    supplierId: po.supplierId,
    supplierName: supplierName ?? '',
    projectId: po.projectId,
    projectNumber,
    status: po.status,
    orderDate: po.orderDate ? po.orderDate.toISOString() : null,
    expectedDate: po.expectedDate ? po.expectedDate.toISOString() : null,
    notes: po.notes,
    subtotal: po.subtotal,
    taxTotal: po.taxTotal,
    discountTotal: po.discountTotal,
    total: po.total,
    approvedAt: po.approvedAt ? po.approvedAt.toISOString() : null,
    createdAt: po.createdAt.toISOString(),
  };
}

async function loadPoDetail(tx: Tx, tenantId: string, id: string): Promise<PurchaseOrderDetailDto> {
  const [row] = await tx
    .select({ po: purchaseOrders, supplierName: suppliers.name, projectNumber: projects.number })
    .from(purchaseOrders)
    .leftJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .leftJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.tenantId, tenantId)));
  if (!row) throw new AppError('PO_NOT_FOUND');

  const lineRows = await tx
    .select({ l: purchaseOrderLines, sku: products.sku, name: products.name })
    .from(purchaseOrderLines)
    .leftJoin(products, eq(products.id, purchaseOrderLines.productId))
    .where(
      and(eq(purchaseOrderLines.purchaseOrderId, id), eq(purchaseOrderLines.tenantId, tenantId)),
    )
    .orderBy(asc(purchaseOrderLines.lineNo));

  const receiptRows = await tx
    .select({ gr: goodsReceipts, whName: warehouses.name })
    .from(goodsReceipts)
    .leftJoin(warehouses, eq(warehouses.id, goodsReceipts.warehouseId))
    .where(and(eq(goodsReceipts.purchaseOrderId, id), eq(goodsReceipts.tenantId, tenantId)))
    .orderBy(desc(goodsReceipts.receivedAt));

  const grLineRows = await tx
    .select()
    .from(goodsReceiptLines)
    .where(eq(goodsReceiptLines.tenantId, tenantId));

  return {
    ...toPoDto(row.po, row.supplierName, row.projectNumber),
    lines: lineRows.map((r) => ({
      id: r.l.id,
      lineNo: r.l.lineNo,
      productId: r.l.productId,
      productSku: r.sku ?? '',
      productName: r.name ?? '',
      orderedQty: r.l.orderedQty,
      receivedQty: r.l.receivedQty,
      unitPrice: r.l.unitPrice,
      taxRate: r.l.taxRate,
      discount: r.l.discount,
      lineTotal: r.l.lineTotal,
    })),
    receipts: receiptRows.map((r) => ({
      id: r.gr.id,
      number: r.gr.number,
      warehouseId: r.gr.warehouseId,
      warehouseName: r.whName ?? '',
      notes: r.gr.notes,
      receivedAt: r.gr.receivedAt.toISOString(),
      lines: Object.fromEntries(
        grLineRows
          .filter((gl) => gl.goodsReceiptId === r.gr.id)
          .map((gl) => [gl.purchaseOrderLineId, gl.receivedQty]),
      ),
    })),
  };
}
