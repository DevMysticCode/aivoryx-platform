import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { dec, formatDec } from './decimal.js';
import { applyStockMovement } from './inventory-core.js';
import {
  isTerminalProjectStatus,
  isValidProjectTransition,
  type ProjectStatus,
} from './lifecycles.js';
import { isUniqueViolation, pageBounds, type Paged, type TenantScope } from './common.js';
import type {
  AllocateMaterialDto,
  CreateProjectDto,
  ProjectActivityDto,
  ProjectDetailDto,
  ProjectDto,
  ProjectMaterialDto,
  UpdateMaterialDto,
  UpsertMaterialDto,
} from './projects.dto.js';

const {
  projects,
  projectMaterials,
  projectActivities,
  products,
  units,
  leads,
  stockMovements,
  userTenantMemberships,
  users,
} = schema;

type ProjectActivityKind = (typeof projectActivities.type.enumValues)[number];

async function recordActivity(
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

@Injectable()
export class ProjectsService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async list(
    scope: TenantScope,
    filter: { status?: string; q?: string; leadId?: string; page?: number; pageSize?: number },
  ): Promise<Paged<ProjectDto>> {
    const { page, pageSize } = pageBounds(filter.page, filter.pageSize);
    return withTenantContext(getDb(), scope, async (tx) => {
      const conds = [eq(projects.tenantId, scope.tenantId)];
      if (filter.status) conds.push(eq(projects.status, filter.status as ProjectStatus));
      if (filter.leadId) conds.push(eq(projects.leadId, filter.leadId));
      if (filter.q?.trim()) {
        const like = `%${filter.q.trim()}%`;
        conds.push(or(ilike(projects.number, like), ilike(projects.customerName, like))!);
      }
      const where = and(...conds);
      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(projects)
        .where(where);
      const rows = await tx
        .select({ p: projects, leadName: leads.name })
        .from(projects)
        .leftJoin(leads, eq(leads.id, projects.leadId))
        .where(where)
        .orderBy(desc(projects.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      return {
        items: rows.map((r) => toProjectDto(r.p, r.leadName)),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  async get(scope: TenantScope, id: string): Promise<ProjectDetailDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const project = await loadProject(tx, scope.tenantId, id);
      if (!project) throw new AppError('PROJECT_NOT_FOUND');
      const materials = await loadMaterials(tx, scope.tenantId, id);
      return { ...project, materials };
    });
  }

  async listActivities(scope: TenantScope, id: string): Promise<ProjectActivityDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      if (!(await projectExists(tx, scope.tenantId, id))) throw new AppError('PROJECT_NOT_FOUND');
      const rows = await tx
        .select({
          a: projectActivities,
          actorName: users.name,
        })
        .from(projectActivities)
        .leftJoin(
          userTenantMemberships,
          eq(userTenantMemberships.id, projectActivities.actorMembershipId),
        )
        .leftJoin(users, eq(users.id, userTenantMemberships.userId))
        .where(
          and(eq(projectActivities.tenantId, scope.tenantId), eq(projectActivities.projectId, id)),
        )
        .orderBy(desc(projectActivities.createdAt));
      return rows.map((r) => ({
        id: r.a.id,
        type: r.a.type,
        actorName: r.actorName,
        payload: (r.a.payload ?? {}) as Record<string, unknown>,
        createdAt: r.a.createdAt.toISOString(),
      }));
    });
  }

  async create(scope: TenantScope, body: CreateProjectDto): Promise<ProjectDetailDto> {
    const projectId = await withTenantContext(getDb(), scope, async (tx) => {
      const [lead] = await tx
        .select({
          id: leads.id,
          name: leads.name,
          addressLine: leads.addressLine,
          city: leads.city,
          state: leads.state,
          postalCode: leads.postalCode,
          country: leads.country,
        })
        .from(leads)
        .where(and(eq(leads.id, body.leadId), eq(leads.tenantId, scope.tenantId)));
      if (!lead) throw new AppError('LEAD_NOT_FOUND');

      const number = body.number?.trim() || `PRJ-${randomUUID().slice(0, 8).toUpperCase()}`;
      try {
        const [row] = await tx
          .insert(projects)
          .values({
            tenantId: scope.tenantId,
            leadId: body.leadId,
            number,
            customerName: body.customerName ?? lead.name ?? null,
            status: 'DRAFT',
            siteAddressLine: lead.addressLine,
            siteCity: lead.city,
            siteState: lead.state,
            sitePostalCode: lead.postalCode,
            siteCountry: lead.country,
            createdByMembershipId: scope.actorMembershipId,
          })
          .returning({ id: projects.id });
        const id = row!.id;
        await recordActivity(tx, {
          tenantId: scope.tenantId,
          projectId: id,
          type: 'created',
          actorMembershipId: scope.actorMembershipId,
          payload: { number, leadId: body.leadId },
        });
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'project.created',
          payload: { projectId: id, leadId: body.leadId, number },
        });
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'project.created',
          entityType: 'project',
          entityId: id,
          actor: userActor(scope),
          metadata: { number, leadId: body.leadId ?? null },
        });
        return id;
      } catch (err) {
        if (isUniqueViolation(err)) throw new AppError('DUPLICATE_CODE', { details: { number } });
        throw err;
      }
    });
    return this.get(scope, projectId);
  }

  async approve(scope: TenantScope, id: string): Promise<ProjectDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await requireProject(tx, scope.tenantId, id);
      if (!isValidProjectTransition(current.status, 'APPROVED')) {
        throw new AppError('PROJECT_INVALID_TRANSITION', {
          details: { from: current.status, to: 'APPROVED' },
        });
      }
      await tx
        .update(projects)
        .set({
          status: 'APPROVED',
          approvedAt: sql`now()`,
          approvedByMembershipId: scope.actorMembershipId,
          updatedAt: new Date(),
        })
        .where(and(eq(projects.id, id), eq(projects.tenantId, scope.tenantId)));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId: id,
        type: 'approved',
        actorMembershipId: scope.actorMembershipId,
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'project.approved',
        payload: { projectId: id },
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'project.updated',
        entityType: 'project',
        entityId: id,
        actor: userActor(scope),
        metadata: { operation: 'approved' },
        changes: { status: { from: current.status, to: 'APPROVED' } },
      });
    });
    return this.get(scope, id);
  }

  async setStatus(scope: TenantScope, id: string, to: ProjectStatus): Promise<ProjectDetailDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const current = await requireProject(tx, scope.tenantId, id);
      if (to === 'APPROVED' && current.status === 'DRAFT') {
        throw new AppError('PROJECT_INVALID_TRANSITION', {
          details: { hint: 'use the approve action' },
        });
      }
      if (!isValidProjectTransition(current.status, to)) {
        throw new AppError('PROJECT_INVALID_TRANSITION', {
          details: { from: current.status, to },
        });
      }
      await tx
        .update(projects)
        .set({ status: to, updatedAt: new Date() })
        .where(and(eq(projects.id, id), eq(projects.tenantId, scope.tenantId)));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId: id,
        type:
          to === 'ON_HOLD'
            ? 'on_hold'
            : current.status === 'ON_HOLD'
              ? 'resumed'
              : 'status_changed',
        actorMembershipId: scope.actorMembershipId,
        payload: { from: current.status, to },
      });
    });
    return this.get(scope, id);
  }

  // ---- materials -------------------------------------------------

  async addMaterial(
    scope: TenantScope,
    projectId: string,
    body: UpsertMaterialDto,
  ): Promise<ProjectMaterialDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const project = await requireProject(tx, scope.tenantId, projectId);
      assertProjectEditable(project.status);
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.id, body.productId), eq(products.tenantId, scope.tenantId)));
      if (!product) throw new AppError('PRODUCT_NOT_FOUND');
      if (dec.lte(body.requiredQty, '0')) {
        throw new AppError('VALIDATION_ERROR', { details: { field: 'requiredQty' } });
      }
      await tx
        .insert(projectMaterials)
        .values({
          tenantId: scope.tenantId,
          projectId,
          productId: body.productId,
          requiredQty: body.requiredQty,
          notes: body.notes ?? null,
        })
        .onConflictDoUpdate({
          target: [
            projectMaterials.tenantId,
            projectMaterials.projectId,
            projectMaterials.productId,
          ],
          set: { requiredQty: body.requiredQty, notes: body.notes ?? null, updatedAt: new Date() },
        });
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'material_added',
        actorMembershipId: scope.actorMembershipId,
        payload: { productId: body.productId, requiredQty: body.requiredQty },
      });
      return loadMaterials(tx, scope.tenantId, projectId);
    });
  }

  async updateMaterial(
    scope: TenantScope,
    projectId: string,
    materialId: string,
    body: UpdateMaterialDto,
  ): Promise<ProjectMaterialDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const material = await requireMaterial(tx, scope.tenantId, projectId, materialId);
      if (body.requiredQty !== undefined) {
        if (dec.lt(body.requiredQty, material.allocatedQty)) {
          throw new AppError('ALLOCATION_EXCEEDS_REQUIREMENT', {
            details: { hint: 'release allocation before reducing the requirement below it' },
          });
        }
      }
      await tx
        .update(projectMaterials)
        .set({
          requiredQty: body.requiredQty ?? undefined,
          notes: body.notes ?? undefined,
          updatedAt: new Date(),
        })
        .where(
          and(eq(projectMaterials.id, materialId), eq(projectMaterials.tenantId, scope.tenantId)),
        );
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'material_updated',
        actorMembershipId: scope.actorMembershipId,
        payload: { materialId },
      });
      return loadMaterials(tx, scope.tenantId, projectId);
    });
  }

  async removeMaterial(
    scope: TenantScope,
    projectId: string,
    materialId: string,
  ): Promise<ProjectMaterialDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const material = await requireMaterial(tx, scope.tenantId, projectId, materialId);
      if (dec.isPos(material.allocatedQty) || dec.isPos(material.dispatchedQty)) {
        throw new AppError('VALIDATION_ERROR', {
          details: { hint: 'release all allocation before removing this material' },
        });
      }
      await tx
        .delete(projectMaterials)
        .where(
          and(eq(projectMaterials.id, materialId), eq(projectMaterials.tenantId, scope.tenantId)),
        );
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'material_removed',
        actorMembershipId: scope.actorMembershipId,
        payload: { materialId },
      });
      return loadMaterials(tx, scope.tenantId, projectId);
    });
  }

  // ---- allocation / release --------------------------------------

  async allocate(
    scope: TenantScope,
    projectId: string,
    body: AllocateMaterialDto,
  ): Promise<ProjectDetailDto> {
    await this.moveAllocation(scope, projectId, body, 'ALLOCATION');
    return this.get(scope, projectId);
  }

  async release(
    scope: TenantScope,
    projectId: string,
    body: AllocateMaterialDto,
  ): Promise<ProjectDetailDto> {
    await this.moveAllocation(scope, projectId, body, 'RELEASE');
    return this.get(scope, projectId);
  }

  private async moveAllocation(
    scope: TenantScope,
    projectId: string,
    body: AllocateMaterialDto,
    kind: 'ALLOCATION' | 'RELEASE',
  ): Promise<void> {
    if (!dec.isPos(body.quantity)) {
      throw new AppError('VALIDATION_ERROR', { details: { field: 'quantity' } });
    }
    await withTenantContext(getDb(), scope, async (tx) => {
      const project = await requireProject(tx, scope.tenantId, projectId);
      if (isTerminalProjectStatus(project.status)) {
        throw new AppError('PROJECT_INVALID_TRANSITION', {
          details: { hint: 'project is closed' },
        });
      }

      // lock the material row FIRST (consistent lock order: material then
      // stock_levels). Concurrent retries block here; once past the lock the
      // idempotency check below sees the committed movement.
      const [material] = await tx
        .select()
        .from(projectMaterials)
        .where(
          and(
            eq(projectMaterials.tenantId, scope.tenantId),
            eq(projectMaterials.projectId, projectId),
            eq(projectMaterials.productId, body.productId),
          ),
        )
        .for('update');
      if (!material) throw new AppError('PROJECT_MATERIAL_NOT_FOUND');

      // idempotency: a repeated call with the same key is a no-op success.
      if (body.idempotencyKey) {
        const [seen] = await tx
          .select({ id: stockMovements.id })
          .from(stockMovements)
          .where(
            and(
              eq(stockMovements.tenantId, scope.tenantId),
              eq(stockMovements.idempotencyKey, idemKey(kind, body.idempotencyKey)),
            ),
          );
        if (seen) return;
      }

      if (kind === 'ALLOCATION') {
        const remainingRequirement = formatDec(
          dec.sub(material.requiredQty, material.allocatedQty),
          4,
        );
        if (dec.gt(body.quantity, remainingRequirement)) {
          throw new AppError('ALLOCATION_EXCEEDS_REQUIREMENT', {
            details: { remainingRequirement },
          });
        }
        await applyStockMovement(tx, {
          tenantId: scope.tenantId,
          warehouseId: body.warehouseId,
          productId: body.productId,
          type: 'ALLOCATION',
          quantity: body.quantity,
          projectId,
          referenceType: 'allocation',
          referenceId: material.id,
          notes: null,
          actorMembershipId: scope.actorMembershipId,
        });
        await tx
          .update(projectMaterials)
          .set({
            allocatedQty: formatDec(dec.add(material.allocatedQty, body.quantity), 4),
            updatedAt: new Date(),
          })
          .where(eq(projectMaterials.id, material.id));
      } else {
        const releasable = formatDec(dec.sub(material.allocatedQty, material.dispatchedQty), 4);
        if (dec.gt(body.quantity, releasable)) {
          throw new AppError('RELEASE_EXCEEDS_ALLOCATED', { details: { releasable } });
        }
        await applyStockMovement(tx, {
          tenantId: scope.tenantId,
          warehouseId: body.warehouseId,
          productId: body.productId,
          type: 'RELEASE',
          quantity: body.quantity,
          projectId,
          referenceType: 'release',
          referenceId: material.id,
          notes: null,
          actorMembershipId: scope.actorMembershipId,
        });
        await tx
          .update(projectMaterials)
          .set({
            allocatedQty: formatDec(dec.sub(material.allocatedQty, body.quantity), 4),
            updatedAt: new Date(),
          })
          .where(eq(projectMaterials.id, material.id));
      }

      // stamp the idempotency key onto the movement we just created
      if (body.idempotencyKey) {
        await tx
          .update(stockMovements)
          .set({ idempotencyKey: idemKey(kind, body.idempotencyKey) })
          .where(
            and(
              eq(stockMovements.tenantId, scope.tenantId),
              eq(stockMovements.referenceId, material.id),
              eq(stockMovements.type, kind),
              sql`${stockMovements.idempotencyKey} is null`,
            ),
          );
      }

      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: kind === 'ALLOCATION' ? 'allocated' : 'released',
        actorMembershipId: scope.actorMembershipId,
        payload: {
          productId: body.productId,
          warehouseId: body.warehouseId,
          quantity: body.quantity,
        },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: kind === 'ALLOCATION' ? 'inventory.allocated' : 'inventory.released',
        payload: { projectId, productId: body.productId, quantity: body.quantity },
      });
      if (kind === 'ALLOCATION') {
        await this.audit.record(tx, {
          tenantId: scope.tenantId,
          action: 'inventory.allocated',
          entityType: 'project',
          entityId: projectId,
          actor: userActor(scope),
          metadata: {
            productId: body.productId,
            warehouseId: body.warehouseId,
            quantity: body.quantity,
          },
        });
      }
    });
  }
}

// ---- helpers -----------------------------------------------------

function idemKey(kind: string, raw: string): string {
  return `${kind.toLowerCase()}:${raw}`;
}

function assertProjectEditable(status: ProjectStatus): void {
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    throw new AppError('PROJECT_INVALID_TRANSITION', { details: { hint: 'project is closed' } });
  }
}

async function projectExists(tx: Tx, tenantId: string, id: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));
  return !!row;
}

async function requireProject(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<{ status: ProjectStatus; leadId: string }> {
  const [row] = await tx
    .select({ status: projects.status, leadId: projects.leadId })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));
  if (!row) throw new AppError('PROJECT_NOT_FOUND');
  return row;
}

async function requireMaterial(
  tx: Tx,
  tenantId: string,
  projectId: string,
  materialId: string,
): Promise<typeof projectMaterials.$inferSelect> {
  const [row] = await tx
    .select()
    .from(projectMaterials)
    .where(
      and(
        eq(projectMaterials.id, materialId),
        eq(projectMaterials.projectId, projectId),
        eq(projectMaterials.tenantId, tenantId),
      ),
    );
  if (!row) throw new AppError('PROJECT_MATERIAL_NOT_FOUND');
  return row;
}

function toProjectDto(p: typeof projects.$inferSelect, leadName: string | null): ProjectDto {
  return {
    id: p.id,
    number: p.number,
    leadId: p.leadId,
    leadName,
    customerName: p.customerName,
    status: p.status,
    siteAddressLine: p.siteAddressLine,
    siteCity: p.siteCity,
    siteState: p.siteState,
    approvedAt: p.approvedAt ? p.approvedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

async function loadProject(tx: Tx, tenantId: string, id: string): Promise<ProjectDto | undefined> {
  const [row] = await tx
    .select({ p: projects, leadName: leads.name })
    .from(projects)
    .leftJoin(leads, eq(leads.id, projects.leadId))
    .where(and(eq(projects.id, id), eq(projects.tenantId, tenantId)));
  return row ? toProjectDto(row.p, row.leadName) : undefined;
}

async function loadMaterials(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<ProjectMaterialDto[]> {
  const rows = await tx
    .select({
      m: projectMaterials,
      sku: products.sku,
      name: products.name,
      unitCode: units.code,
    })
    .from(projectMaterials)
    .leftJoin(products, eq(products.id, projectMaterials.productId))
    .leftJoin(units, eq(units.id, products.unitId))
    .where(and(eq(projectMaterials.tenantId, tenantId), eq(projectMaterials.projectId, projectId)))
    .orderBy(asc(products.sku));
  return rows.map((r) => ({
    id: r.m.id,
    productId: r.m.productId,
    productSku: r.sku ?? '',
    productName: r.name ?? '',
    unitCode: r.unitCode ?? '',
    requiredQty: r.m.requiredQty,
    allocatedQty: r.m.allocatedQty,
    dispatchedQty: r.m.dispatchedQty,
    deliveredQty: r.m.deliveredQty,
    remainingQty: formatDec(dec.sub(r.m.requiredQty, r.m.allocatedQty), 4),
    notes: r.m.notes,
  }));
}
