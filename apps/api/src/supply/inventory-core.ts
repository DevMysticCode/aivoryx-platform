import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { dec, formatDec, parseDec } from './decimal.js';

const { stockLevels, stockMovements } = schema;

export type StockMovementType = (typeof stockMovements.type.enumValues)[number];

export interface ApplyMovementInput {
  tenantId: string;
  warehouseId: string;
  productId: string;
  type: StockMovementType;
  /** absolute quantity moved — must be > 0 (except ADJUSTMENT, which may be signed) */
  quantity: string;
  projectId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  notes?: string | null;
  actorMembershipId?: string | null;
  /** allow the resulting on_hand to be driven negative (only ever used by ADJUSTMENT, and only if a policy permits it — off by default) */
  allowNegative?: boolean;
}

interface Deltas {
  onHand: string;
  reserved: string;
}

/**
 * The single primitive every stock change goes through (Phase 5, ADR 0034).
 * It:
 *   1. ensures a `stock_levels` row exists for (tenant, warehouse, product)
 *   2. locks it `FOR UPDATE` — this serializes concurrent writers and makes
 *      the availability / negative-stock checks race-free
 *   3. validates the resulting balance against the invariants
 *   4. appends an immutable `stock_movements` row
 *   5. updates the `stock_levels` projection
 *
 * All within the caller's transaction — never opens its own.
 */
export async function applyStockMovement(tx: Tx, input: ApplyMovementInput): Promise<void> {
  const deltas = movementDeltas(input.type, input.quantity);

  // 1 + 2: ensure the row, then lock it.
  await tx
    .insert(stockLevels)
    .values({
      tenantId: input.tenantId,
      warehouseId: input.warehouseId,
      productId: input.productId,
      onHand: '0',
      reserved: '0',
    })
    .onConflictDoNothing();

  const [locked] = await tx
    .select({ onHand: stockLevels.onHand, reserved: stockLevels.reserved })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.tenantId, input.tenantId),
        eq(stockLevels.warehouseId, input.warehouseId),
        eq(stockLevels.productId, input.productId),
      ),
    )
    .for('update');

  if (!locked) {
    // RLS blocked the row (cross-tenant warehouse/product) — treat as not found.
    throw new AppError('WAREHOUSE_NOT_FOUND');
  }

  const nextOnHand = formatDec(dec.add(locked.onHand, deltas.onHand), 4);
  const nextReserved = formatDec(dec.add(locked.reserved, deltas.reserved), 4);

  // 3: invariants.
  if (parseDec(nextOnHand) < 0n && !input.allowNegative) {
    throw new AppError('NEGATIVE_STOCK_NOT_ALLOWED', {
      details: { warehouseId: input.warehouseId, productId: input.productId },
    });
  }
  if (parseDec(nextReserved) < 0n) {
    throw new AppError('RELEASE_EXCEEDS_ALLOCATED', {
      details: { warehouseId: input.warehouseId, productId: input.productId },
    });
  }
  if (parseDec(nextReserved) > parseDec(nextOnHand)) {
    // reserving/allocating more than is physically on hand
    throw new AppError('ALLOCATION_EXCEEDS_AVAILABLE_STOCK', {
      details: { warehouseId: input.warehouseId, productId: input.productId },
    });
  }

  // 4: the ledger row.
  await tx.insert(stockMovements).values({
    tenantId: input.tenantId,
    warehouseId: input.warehouseId,
    productId: input.productId,
    type: input.type,
    onHandDelta: deltas.onHand,
    reservedDelta: deltas.reserved,
    quantity: absStr(input.quantity),
    projectId: input.projectId ?? null,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    notes: input.notes ?? null,
    createdByMembershipId: input.actorMembershipId ?? null,
  });

  // 5: the projection.
  await tx
    .update(stockLevels)
    .set({ onHand: nextOnHand, reserved: nextReserved, updatedAt: new Date() })
    .where(
      and(
        eq(stockLevels.tenantId, input.tenantId),
        eq(stockLevels.warehouseId, input.warehouseId),
        eq(stockLevels.productId, input.productId),
      ),
    );
}

/** Map a movement type + absolute quantity to its (on_hand, reserved) deltas. */
export function movementDeltas(type: StockMovementType, quantity: string): Deltas {
  const q = quantity;
  switch (type) {
    case 'RECEIPT':
    case 'RETURN':
    case 'TRANSFER_IN':
      return { onHand: q, reserved: '0' };
    case 'DISPATCH':
      return { onHand: neg(q), reserved: neg(q) };
    case 'TRANSFER_OUT':
      return { onHand: neg(q), reserved: '0' };
    case 'ALLOCATION':
      return { onHand: '0', reserved: q };
    case 'RELEASE':
      return { onHand: '0', reserved: neg(q) };
    case 'ADJUSTMENT':
      // quantity may itself be signed for an adjustment
      return { onHand: q, reserved: '0' };
  }
}

function neg(q: string): string {
  return q.startsWith('-') ? q.slice(1) : `-${q}`;
}
function absStr(q: string): string {
  return q.startsWith('-') ? q.slice(1) : q;
}

export interface AvailabilityRow {
  onHand: string;
  reserved: string;
  available: string;
}

/** Read (without locking) the current level for a (warehouse, product). */
export async function readStockLevel(
  tx: Tx,
  tenantId: string,
  warehouseId: string,
  productId: string,
): Promise<AvailabilityRow> {
  const [row] = await tx
    .select({ onHand: stockLevels.onHand, reserved: stockLevels.reserved })
    .from(stockLevels)
    .where(
      and(
        eq(stockLevels.tenantId, tenantId),
        eq(stockLevels.warehouseId, warehouseId),
        eq(stockLevels.productId, productId),
      ),
    );
  const onHand = row?.onHand ?? '0';
  const reserved = row?.reserved ?? '0';
  return { onHand, reserved, available: formatDec(dec.sub(onHand, reserved), 4) };
}
