import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import {
  buildEntityAttachmentKey,
  OBJECT_STORAGE,
  type ObjectStorageService,
  type StoredObject,
} from '../storage/object-storage.service.js';
import { dec, formatDec } from './decimal.js';
import { applyStockMovement } from './inventory-core.js';
import { dispatchIsEditable, isValidDispatchTransition } from './lifecycles.js';
import { isUniqueViolation, pageBounds, type Paged, type TenantScope } from './common.js';
import type {
  CreateDispatchDto,
  DeliverDispatchDto,
  DispatchAttachmentDto,
  DispatchDetailDto,
  DispatchDto,
  DispatchLineInputDto,
  ListDispatchesQueryDto,
  UpdateDispatchDto,
} from './logistics.dto.js';

const {
  dispatches,
  dispatchLines,
  dispatchAttachments,
  projects,
  projectMaterials,
  projectActivities,
  products,
  warehouses,
} = schema;

type DispatchStatus = (typeof dispatches.status.enumValues)[number];

const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]);

@Injectable()
export class LogisticsService {
  constructor(
    private readonly outbox: OutboxService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorageService,
    private readonly audit: AuditService,
  ) {}

  async list(scope: TenantScope, filter: ListDispatchesQueryDto): Promise<Paged<DispatchDto>> {
    const { page, pageSize } = pageBounds(filter.page, filter.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds = [eq(dispatches.tenantId, scope.tenantId)];
      if (filter.status) conds.push(eq(dispatches.status, filter.status as DispatchStatus));
      if (filter.projectId) conds.push(eq(dispatches.projectId, filter.projectId));
      if (filter.warehouseId) conds.push(eq(dispatches.warehouseId, filter.warehouseId));
      const where = and(...conds);
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(dispatches)
        .where(where);
      const rows = await tx
        .select({ d: dispatches, projectNumber: projects.number, whName: warehouses.name })
        .from(dispatches)
        .leftJoin(projects, eq(projects.id, dispatches.projectId))
        .leftJoin(warehouses, eq(warehouses.id, dispatches.warehouseId))
        .where(where)
        .orderBy(desc(dispatches.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows.map((r) => toDispatchDto(r.d, r.projectNumber, r.whName)),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  get(scope: TenantScope, id: string): Promise<DispatchDetailDto> {
    return withTenantContext(getDb(), scope, (tx) => loadDispatchDetail(tx, scope.tenantId, id));
  }

  async create(scope: TenantScope, body: CreateDispatchDto): Promise<DispatchDetailDto> {
    const id = await withTenantContext(getDb(), scope, async (tx) => {
      const [project] = await tx
        .select({
          id: projects.id,
          status: projects.status,
          addr: projects.siteAddressLine,
          city: projects.siteCity,
        })
        .from(projects)
        .where(and(eq(projects.id, body.projectId), eq(projects.tenantId, scope.tenantId)));
      if (!project) throw new AppError('PROJECT_NOT_FOUND');
      await requireWarehouse(tx, scope.tenantId, body.warehouseId);

      const resolved = await this.resolveLines(tx, scope.tenantId, body.projectId, body.lines);

      const number = `DSP-${randomUUID().slice(0, 8).toUpperCase()}`;
      try {
        const [d] = await tx
          .insert(dispatches)
          .values({
            tenantId: scope.tenantId,
            number,
            projectId: body.projectId,
            warehouseId: body.warehouseId,
            status: 'DRAFT',
            destinationAddress:
              body.destinationAddress ??
              [project.addr, project.city].filter(Boolean).join(', ') ??
              null,
            notes: body.notes ?? null,
            createdByMembershipId: scope.actorMembershipId,
          })
          .returning({ id: dispatches.id });
        const dispatchId = d!.id;
        await tx.insert(dispatchLines).values(
          resolved.map((l, i) => ({
            tenantId: scope.tenantId,
            dispatchId,
            productId: l.productId,
            projectMaterialId: l.projectMaterialId,
            lineNo: i + 1,
            quantity: l.quantity,
          })),
        );
        await recordProjectActivity(tx, {
          tenantId: scope.tenantId,
          projectId: body.projectId,
          type: 'dispatch_created',
          actorMembershipId: scope.actorMembershipId,
          payload: { dispatchId, number },
        });
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'dispatch.created',
          payload: { dispatchId, projectId: body.projectId, number },
        });
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'project.updated',
          module: 'supply',
          entityType: 'dispatch',
          entityId: dispatchId,
          actor: userActor(scope),
          metadata: { operation: 'dispatch_created', number, projectId: body.projectId },
        });
        return dispatchId;
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
    body: UpdateDispatchDto,
  ): Promise<DispatchDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const d = await requireDispatch(tx, scope.tenantId, id);
      if (!dispatchIsEditable(d.status)) {
        throw new AppError('DISPATCH_INVALID_STATE', {
          details: { hint: 'only a draft dispatch can be edited' },
        });
      }
      if (body.lines) {
        const resolved = await this.resolveLines(tx, scope.tenantId, d.projectId, body.lines);
        await tx
          .delete(dispatchLines)
          .where(and(eq(dispatchLines.dispatchId, id), eq(dispatchLines.tenantId, scope.tenantId)));
        await tx.insert(dispatchLines).values(
          resolved.map((l, i) => ({
            tenantId: scope.tenantId,
            dispatchId: id,
            productId: l.productId,
            projectMaterialId: l.projectMaterialId,
            lineNo: i + 1,
            quantity: l.quantity,
          })),
        );
      }
      await tx
        .update(dispatches)
        .set({
          destinationAddress: body.destinationAddress ?? undefined,
          notes: body.notes ?? undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(dispatches.id, id), eq(dispatches.tenantId, scope.tenantId)));
    });
    return this.get(scope, id);
  }

  async cancel(scope: TenantScope, id: string): Promise<DispatchDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const d = await requireDispatch(tx, scope.tenantId, id);
      if (!isValidDispatchTransition(d.status, 'CANCELLED')) {
        throw new AppError('DISPATCH_INVALID_STATE', { details: { from: d.status } });
      }
      await tx
        .update(dispatches)
        .set({ status: 'CANCELLED', updatedAt: new Date() })
        .where(and(eq(dispatches.id, id), eq(dispatches.tenantId, scope.tenantId)));
    });
    return this.get(scope, id);
  }

  async dispatch(scope: TenantScope, id: string): Promise<DispatchDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const [d] = await tx
        .select()
        .from(dispatches)
        .where(and(eq(dispatches.id, id), eq(dispatches.tenantId, scope.tenantId)))
        .for('update');
      if (!d) throw new AppError('DISPATCH_NOT_FOUND');
      if (d.status === 'DISPATCHED' || d.status === 'DELIVERED') return; // idempotent
      if (!isValidDispatchTransition(d.status, 'DISPATCHED')) {
        throw new AppError('DISPATCH_INVALID_STATE', { details: { from: d.status } });
      }

      const lines = await tx
        .select()
        .from(dispatchLines)
        .where(and(eq(dispatchLines.dispatchId, id), eq(dispatchLines.tenantId, scope.tenantId)))
        .orderBy(asc(dispatchLines.lineNo));
      if (lines.length === 0) {
        throw new AppError('DISPATCH_INVALID_STATE', {
          details: { hint: 'dispatch has no lines' },
        });
      }

      for (const l of lines) {
        // lock material, verify allocated-and-not-yet-dispatched covers this line
        const [material] = await tx
          .select()
          .from(projectMaterials)
          .where(
            and(
              eq(projectMaterials.id, l.projectMaterialId),
              eq(projectMaterials.tenantId, scope.tenantId),
            ),
          )
          .for('update');
        if (!material) throw new AppError('PROJECT_MATERIAL_NOT_FOUND');
        const dispatchable = formatDec(dec.sub(material.allocatedQty, material.dispatchedQty), 4);
        if (dec.gt(l.quantity, dispatchable)) {
          throw new AppError('DISPATCH_EXCEEDS_ALLOCATED', {
            details: { productId: l.productId, dispatchable },
          });
        }
        await applyStockMovement(tx, {
          tenantId: scope.tenantId,
          warehouseId: d.warehouseId,
          productId: l.productId,
          type: 'DISPATCH',
          quantity: l.quantity,
          projectId: d.projectId,
          referenceType: 'dispatch',
          referenceId: id,
          notes: null,
          actorMembershipId: scope.actorMembershipId,
        });
        await tx
          .update(projectMaterials)
          .set({
            dispatchedQty: formatDec(dec.add(material.dispatchedQty, l.quantity), 4),
            updatedAt: new Date(),
          })
          .where(eq(projectMaterials.id, material.id));
      }

      await tx
        .update(dispatches)
        .set({ status: 'DISPATCHED', dispatchedAt: sql`now()`, updatedAt: new Date() })
        .where(and(eq(dispatches.id, id), eq(dispatches.tenantId, scope.tenantId)));
      await recordProjectActivity(tx, {
        tenantId: scope.tenantId,
        projectId: d.projectId,
        type: 'dispatched',
        actorMembershipId: scope.actorMembershipId,
        payload: { dispatchId: id },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'dispatch.dispatched',
        payload: { dispatchId: id, projectId: d.projectId },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'inventory.dispatched',
        payload: { dispatchId: id, warehouseId: d.warehouseId },
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'inventory.dispatched',
        entityType: 'dispatch',
        entityId: id,
        actor: userActor(scope),
        metadata: { projectId: d.projectId, warehouseId: d.warehouseId },
      });
    });
    return this.get(scope, id);
  }

  async deliver(
    scope: TenantScope,
    id: string,
    body: DeliverDispatchDto,
  ): Promise<DispatchDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const [d] = await tx
        .select()
        .from(dispatches)
        .where(and(eq(dispatches.id, id), eq(dispatches.tenantId, scope.tenantId)))
        .for('update');
      if (!d) throw new AppError('DISPATCH_NOT_FOUND');
      if (d.status === 'DELIVERED') return; // idempotent
      if (!isValidDispatchTransition(d.status, 'DELIVERED')) {
        throw new AppError('DELIVERY_INVALID_STATE', { details: { from: d.status } });
      }

      const lines = await tx
        .select()
        .from(dispatchLines)
        .where(and(eq(dispatchLines.dispatchId, id), eq(dispatchLines.tenantId, scope.tenantId)));
      const requested = new Map((body.lines ?? []).map((l) => [l.dispatchLineId, l.deliveredQty]));

      for (const l of lines) {
        const deliveredQty = requested.get(l.id) ?? l.quantity;
        if (dec.isNeg(deliveredQty) || dec.gt(deliveredQty, l.quantity)) {
          throw new AppError('DELIVERY_EXCEEDS_DISPATCHED', {
            details: { dispatchLineId: l.id, dispatched: l.quantity },
          });
        }
        await tx
          .update(dispatchLines)
          .set({ deliveredQty, updatedAt: new Date() })
          .where(eq(dispatchLines.id, l.id));
        const [material] = await tx
          .select()
          .from(projectMaterials)
          .where(
            and(
              eq(projectMaterials.id, l.projectMaterialId),
              eq(projectMaterials.tenantId, scope.tenantId),
            ),
          )
          .for('update');
        if (material) {
          await tx
            .update(projectMaterials)
            .set({
              deliveredQty: formatDec(dec.add(material.deliveredQty, deliveredQty), 4),
              updatedAt: new Date(),
            })
            .where(eq(projectMaterials.id, material.id));
        }
      }

      await tx
        .update(dispatches)
        .set({
          status: 'DELIVERED',
          deliveredAt: sql`now()`,
          deliveryNotes: body.deliveryNotes ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(dispatches.id, id), eq(dispatches.tenantId, scope.tenantId)));
      await recordProjectActivity(tx, {
        tenantId: scope.tenantId,
        projectId: d.projectId,
        type: 'delivered',
        actorMembershipId: scope.actorMembershipId,
        payload: { dispatchId: id },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'dispatch.delivered',
        payload: { dispatchId: id, projectId: d.projectId },
        actorMembershipId: scope.actorMembershipId,
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'inventory.delivered',
        entityType: 'dispatch',
        entityId: id,
        actor: userActor(scope),
        metadata: { projectId: d.projectId },
      });
    });
    return this.get(scope, id);
  }

  // ---- attachments -------------------------------------------

  async listAttachments(scope: TenantScope, id: string): Promise<DispatchAttachmentDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await requireDispatch(tx, scope.tenantId, id);
      const rows = await tx
        .select()
        .from(dispatchAttachments)
        .where(
          and(
            eq(dispatchAttachments.tenantId, scope.tenantId),
            eq(dispatchAttachments.dispatchId, id),
          ),
        )
        .orderBy(desc(dispatchAttachments.createdAt));
      return rows.map(toAttachmentDto);
    });
  }

  async uploadAttachment(
    scope: TenantScope,
    id: string,
    file: { buffer: Buffer; originalFilename: string; contentType: string; size: number },
  ): Promise<DispatchAttachmentDto> {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new AppError('ATTACHMENT_INVALID', { details: { reason: 'file_too_large' } });
    }
    if (!ALLOWED_CONTENT_TYPES.has(file.contentType)) {
      throw new AppError('ATTACHMENT_INVALID', { details: { reason: 'unsupported_content_type' } });
    }
    await withTenantContext(getDb(), scope, (tx) => requireDispatch(tx, scope.tenantId, id));
    const objectKey = buildEntityAttachmentKey(
      scope.tenantId,
      'dispatches',
      id,
      file.originalFilename,
    );
    await this.storage.putObject({
      key: objectKey,
      body: file.buffer,
      contentType: file.contentType,
    });
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .insert(dispatchAttachments)
        .values({
          tenantId: scope.tenantId,
          dispatchId: id,
          objectKey,
          originalFilename: file.originalFilename,
          contentType: file.contentType,
          fileSize: file.size,
          uploadedByMembershipId: scope.actorMembershipId,
        })
        .returning();
      return toAttachmentDto(row!);
    });
  }

  async downloadAttachment(
    scope: TenantScope,
    id: string,
    attachmentId: string,
  ): Promise<StoredObject & { originalFilename: string | null }> {
    const row = await withTenantContext(getDb(), scope, async (tx) => {
      await requireDispatch(tx, scope.tenantId, id);
      const [r] = await tx
        .select()
        .from(dispatchAttachments)
        .where(
          and(
            eq(dispatchAttachments.tenantId, scope.tenantId),
            eq(dispatchAttachments.dispatchId, id),
            eq(dispatchAttachments.id, attachmentId),
          ),
        );
      return r;
    });
    if (!row) throw new AppError('ATTACHMENT_NOT_FOUND');
    const object = await this.storage.getObject(row.objectKey);
    if (!object) throw new AppError('ATTACHMENT_NOT_FOUND');
    return { ...object, originalFilename: row.originalFilename };
  }

  async deleteAttachment(scope: TenantScope, id: string, attachmentId: string): Promise<void> {
    const row = await withTenantContext(getDb(), scope, async (tx) => {
      await requireDispatch(tx, scope.tenantId, id);
      const [r] = await tx
        .delete(dispatchAttachments)
        .where(
          and(
            eq(dispatchAttachments.tenantId, scope.tenantId),
            eq(dispatchAttachments.dispatchId, id),
            eq(dispatchAttachments.id, attachmentId),
          ),
        )
        .returning();
      if (!r) throw new AppError('ATTACHMENT_NOT_FOUND');
      return r;
    });
    await this.storage.deleteObject(row.objectKey);
  }

  // ---- helpers ---------------------------------------------

  private async resolveLines(
    tx: Tx,
    tenantId: string,
    projectId: string,
    lines: DispatchLineInputDto[],
  ): Promise<Array<{ productId: string; quantity: string; projectMaterialId: string }>> {
    const out = [];
    for (const l of lines) {
      if (!dec.isPos(l.quantity)) {
        throw new AppError('VALIDATION_ERROR', { details: { field: 'quantity' } });
      }
      const [material] = await tx
        .select({
          id: projectMaterials.id,
          allocated: projectMaterials.allocatedQty,
          dispatched: projectMaterials.dispatchedQty,
        })
        .from(projectMaterials)
        .where(
          and(
            eq(projectMaterials.tenantId, tenantId),
            eq(projectMaterials.projectId, projectId),
            eq(projectMaterials.productId, l.productId),
          ),
        );
      if (!material)
        throw new AppError('PROJECT_MATERIAL_NOT_FOUND', { details: { productId: l.productId } });
      const dispatchable = formatDec(dec.sub(material.allocated, material.dispatched), 4);
      if (dec.gt(l.quantity, dispatchable)) {
        throw new AppError('DISPATCH_EXCEEDS_ALLOCATED', {
          details: { productId: l.productId, dispatchable },
        });
      }
      out.push({ productId: l.productId, quantity: l.quantity, projectMaterialId: material.id });
    }
    return out;
  }
}

// ---- module-local helpers ------------------------------------

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

async function requireWarehouse(tx: Tx, tenantId: string, id: string): Promise<void> {
  const [row] = await tx
    .select({ id: warehouses.id })
    .from(warehouses)
    .where(and(eq(warehouses.id, id), eq(warehouses.tenantId, tenantId)));
  if (!row) throw new AppError('WAREHOUSE_NOT_FOUND');
}

async function requireDispatch(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<typeof dispatches.$inferSelect> {
  const [row] = await tx
    .select()
    .from(dispatches)
    .where(and(eq(dispatches.id, id), eq(dispatches.tenantId, tenantId)));
  if (!row) throw new AppError('DISPATCH_NOT_FOUND');
  return row;
}

function toDispatchDto(
  d: typeof dispatches.$inferSelect,
  projectNumber: string | null,
  whName: string | null,
): DispatchDto {
  return {
    id: d.id,
    number: d.number,
    projectId: d.projectId,
    projectNumber: projectNumber ?? '',
    warehouseId: d.warehouseId,
    warehouseName: whName ?? '',
    status: d.status,
    destinationAddress: d.destinationAddress,
    notes: d.notes,
    deliveryNotes: d.deliveryNotes,
    dispatchedAt: d.dispatchedAt ? d.dispatchedAt.toISOString() : null,
    deliveredAt: d.deliveredAt ? d.deliveredAt.toISOString() : null,
    createdAt: d.createdAt.toISOString(),
  };
}

function toAttachmentDto(r: typeof dispatchAttachments.$inferSelect): DispatchAttachmentDto {
  return {
    id: r.id,
    dispatchId: r.dispatchId,
    originalFilename: r.originalFilename,
    contentType: r.contentType,
    fileSize: r.fileSize,
    createdAt: r.createdAt.toISOString(),
  };
}

async function loadDispatchDetail(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<DispatchDetailDto> {
  const [row] = await tx
    .select({ d: dispatches, projectNumber: projects.number, whName: warehouses.name })
    .from(dispatches)
    .leftJoin(projects, eq(projects.id, dispatches.projectId))
    .leftJoin(warehouses, eq(warehouses.id, dispatches.warehouseId))
    .where(and(eq(dispatches.id, id), eq(dispatches.tenantId, tenantId)));
  if (!row) throw new AppError('DISPATCH_NOT_FOUND');
  const lineRows = await tx
    .select({ l: dispatchLines, sku: products.sku, name: products.name })
    .from(dispatchLines)
    .leftJoin(products, eq(products.id, dispatchLines.productId))
    .where(and(eq(dispatchLines.dispatchId, id), eq(dispatchLines.tenantId, tenantId)))
    .orderBy(asc(dispatchLines.lineNo));
  const attRows = await tx
    .select()
    .from(dispatchAttachments)
    .where(and(eq(dispatchAttachments.tenantId, tenantId), eq(dispatchAttachments.dispatchId, id)))
    .orderBy(desc(dispatchAttachments.createdAt));
  return {
    ...toDispatchDto(row.d, row.projectNumber, row.whName),
    lines: lineRows.map((r) => ({
      id: r.l.id,
      lineNo: r.l.lineNo,
      productId: r.l.productId,
      productSku: r.sku ?? '',
      productName: r.name ?? '',
      quantity: r.l.quantity,
      deliveredQty: r.l.deliveredQty,
    })),
    attachments: attRows.map(toAttachmentDto),
  };
}
