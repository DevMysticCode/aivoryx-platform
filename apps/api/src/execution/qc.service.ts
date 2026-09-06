import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { ensureAndLoadTemplates } from './checklist-templates.js';
import { isValidQcTransition } from './lifecycles.js';
import {
  loadExecProject,
  recordActivity,
  refreshMilestones,
  requireExecutionStarted,
} from './helpers.js';
import { incompleteRequiredItems } from './installations.service.js';
import { buildView, loadChecklist } from './execution.service.js';
import type { TenantScope } from './common.js';
import type {
  ChecklistItemDto,
  CreateQcInspectionDto,
  ExecutionViewDto,
  FailQcDto,
  QcInspectionDetailDto,
} from './execution.dto.js';

const {
  projectQcInspections,
  projectChecklistItems,
  projectDefects,
  projectInstallations,
  userTenantMemberships,
  users,
} = schema;

@Injectable()
export class QcService {
  constructor(private readonly outbox: OutboxService) {}

  private view(scope: TenantScope, projectId: string): Promise<ExecutionViewDto> {
    return withTenantContext(getDb(), scope, (tx) => buildView(tx, scope.tenantId, projectId));
  }

  async create(
    scope: TenantScope,
    projectId: string,
    body: CreateQcInspectionDto,
  ): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      // require installation complete before a QC inspection makes sense
      const [inst] = await tx
        .select({ status: projectInstallations.status })
        .from(projectInstallations)
        .where(
          and(
            eq(projectInstallations.tenantId, scope.tenantId),
            eq(projectInstallations.projectId, projectId),
          ),
        );
      if (inst?.status !== 'COMPLETED') {
        throw new AppError('INSTALLATION_INVALID_STATE', {
          details: { hint: 'installation must be completed before QC' },
        });
      }
      // no open inspection already
      const [pending] = await tx
        .select({ id: projectQcInspections.id })
        .from(projectQcInspections)
        .where(
          and(
            eq(projectQcInspections.tenantId, scope.tenantId),
            eq(projectQcInspections.projectId, projectId),
            inArray(projectQcInspections.status, ['PENDING', 'IN_PROGRESS']),
          ),
        );
      if (pending) {
        throw new AppError('QC_INVALID_STATE', {
          details: { hint: 'an open inspection already exists' },
        });
      }

      const maxSeqRow = await tx
        .select({ maxSeq: sql<number>`coalesce(max(seq), 0)::int` })
        .from(projectQcInspections)
        .where(
          and(
            eq(projectQcInspections.tenantId, scope.tenantId),
            eq(projectQcInspections.projectId, projectId),
          ),
        );
      const seq = (maxSeqRow[0]?.maxSeq ?? 0) + 1;
      const [row] = await tx
        .insert(projectQcInspections)
        .values({
          tenantId: scope.tenantId,
          projectId,
          seq,
          status: 'PENDING',
          inspectorMembershipId: body.inspectorMembershipId ?? null,
          notes: body.notes ?? null,
          createdByMembershipId: scope.actorMembershipId,
        })
        .returning({ id: projectQcInspections.id });
      const inspectionId = row!.id;

      const templates = (await ensureAndLoadTemplates(tx, scope.tenantId, 'qc')).filter(
        (t) => t.isActive,
      );
      if (templates.length > 0) {
        await tx.insert(projectChecklistItems).values(
          templates.map((t) => ({
            tenantId: scope.tenantId,
            projectId,
            inspectionId,
            templateId: t.id,
            kind: 'qc' as const,
            label: t.label,
            required: t.required,
            sortOrder: t.sortOrder,
          })),
        );
      }

      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'qc_created',
        actorMembershipId: scope.actorMembershipId,
        payload: { inspectionId, seq },
      });
      await refreshMilestones(tx, scope, projectId);
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'qc.created',
        payload: { projectId, inspectionId },
      });
    });
    return this.view(scope, projectId);
  }

  async getInspection(
    scope: TenantScope,
    projectId: string,
    inspectionId: string,
  ): Promise<QcInspectionDetailDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const insp = await loadInspection(tx, scope.tenantId, projectId, inspectionId);
      const checklist = await loadChecklist(tx, scope.tenantId, projectId, 'qc', inspectionId);
      const [inspector] = insp.inspectorMembershipId
        ? await tx
            .select({ name: users.name })
            .from(userTenantMemberships)
            .leftJoin(users, eq(users.id, userTenantMemberships.userId))
            .where(eq(userTenantMemberships.id, insp.inspectorMembershipId))
        : [];
      return {
        id: insp.id,
        seq: insp.seq,
        status: insp.status,
        inspectorMembershipId: insp.inspectorMembershipId,
        inspectorName: inspector?.name ?? null,
        inspectedAt: insp.inspectedAt ? insp.inspectedAt.toISOString() : null,
        notes: insp.notes,
        resultNote: insp.resultNote,
        createdAt: insp.createdAt.toISOString(),
        checklist,
      };
    });
  }

  async toggleChecklistItem(
    scope: TenantScope,
    projectId: string,
    inspectionId: string,
    itemId: string,
    status: 'pending' | 'done' | 'na',
    notes?: string,
  ): Promise<ChecklistItemDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await loadInspection(tx, scope.tenantId, projectId, inspectionId);
      const [item] = await tx
        .select()
        .from(projectChecklistItems)
        .where(
          and(
            eq(projectChecklistItems.id, itemId),
            eq(projectChecklistItems.inspectionId, inspectionId),
            eq(projectChecklistItems.tenantId, scope.tenantId),
          ),
        );
      if (!item) throw new AppError('CHECKLIST_ITEM_NOT_FOUND');
      const done = status === 'done';
      await tx
        .update(projectChecklistItems)
        .set({
          status,
          completedAt: done ? sql`now()` : null,
          completedByMembershipId: done ? scope.actorMembershipId : null,
          notes: notes ?? item.notes,
          updatedAt: new Date(),
        })
        .where(eq(projectChecklistItems.id, itemId));
      return loadChecklist(tx, scope.tenantId, projectId, 'qc', inspectionId);
    });
  }

  async start(
    scope: TenantScope,
    projectId: string,
    inspectionId: string,
  ): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const insp = await lockInspection(tx, scope.tenantId, projectId, inspectionId);
      if (insp.status === 'IN_PROGRESS') return;
      if (!isValidQcTransition(insp.status, 'IN_PROGRESS')) {
        throw new AppError('QC_INVALID_STATE', { details: { from: insp.status } });
      }
      await tx
        .update(projectQcInspections)
        .set({ status: 'IN_PROGRESS', updatedAt: new Date() })
        .where(eq(projectQcInspections.id, inspectionId));
    });
    return this.view(scope, projectId);
  }

  async pass(
    scope: TenantScope,
    projectId: string,
    inspectionId: string,
  ): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const insp = await lockInspection(tx, scope.tenantId, projectId, inspectionId);
      if (insp.status === 'PASSED') return; // idempotent
      if (!isValidQcTransition(insp.status, 'PASSED')) {
        throw new AppError('QC_INVALID_STATE', { details: { from: insp.status } });
      }
      const missing = await incompleteRequiredItems(
        tx,
        scope.tenantId,
        projectId,
        'qc',
        inspectionId,
      );
      if (missing.length > 0) {
        throw new AppError('QC_CHECKLIST_INCOMPLETE', { details: { missing } });
      }
      const [blocking] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(projectDefects)
        .where(
          and(
            eq(projectDefects.tenantId, scope.tenantId),
            eq(projectDefects.projectId, projectId),
            inArray(projectDefects.status, ['OPEN', 'IN_PROGRESS']),
          ),
        );
      if ((blocking?.n ?? 0) > 0) {
        throw new AppError('QC_BLOCKING_DEFECTS', { details: { open: blocking?.n ?? 0 } });
      }
      await tx
        .update(projectQcInspections)
        .set({ status: 'PASSED', inspectedAt: sql`now()`, updatedAt: new Date() })
        .where(eq(projectQcInspections.id, inspectionId));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'qc_passed',
        actorMembershipId: scope.actorMembershipId,
        payload: { inspectionId, seq: insp.seq },
      });
      await refreshMilestones(tx, scope, projectId);
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'qc.passed',
        payload: { projectId, inspectionId },
      });
    });
    return this.view(scope, projectId);
  }

  async fail(
    scope: TenantScope,
    projectId: string,
    inspectionId: string,
    body: FailQcDto,
  ): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const insp = await lockInspection(tx, scope.tenantId, projectId, inspectionId);
      if (insp.status === 'FAILED') return; // idempotent
      if (!isValidQcTransition(insp.status, 'FAILED')) {
        throw new AppError('QC_INVALID_STATE', { details: { from: insp.status } });
      }
      await tx
        .update(projectQcInspections)
        .set({
          status: 'FAILED',
          inspectedAt: sql`now()`,
          resultNote: body.resultNote ?? null,
          updatedAt: new Date(),
        })
        .where(eq(projectQcInspections.id, inspectionId));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'qc_failed',
        actorMembershipId: scope.actorMembershipId,
        payload: { inspectionId, seq: insp.seq, resultNote: body.resultNote ?? null },
      });
      await refreshMilestones(tx, scope, projectId);
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'qc.failed',
        payload: { projectId, inspectionId },
        actorMembershipId: scope.actorMembershipId,
      });
    });
    return this.view(scope, projectId);
  }
}

// ---- helpers -----------------------------------------------

async function loadInspection(
  tx: Tx,
  tenantId: string,
  projectId: string,
  inspectionId: string,
): Promise<schema.ProjectQcInspectionRow> {
  await loadExecProject(tx, tenantId, projectId);
  const [row] = await tx
    .select()
    .from(projectQcInspections)
    .where(
      and(
        eq(projectQcInspections.id, inspectionId),
        eq(projectQcInspections.projectId, projectId),
        eq(projectQcInspections.tenantId, tenantId),
      ),
    );
  if (!row) throw new AppError('QC_INSPECTION_NOT_FOUND');
  return row;
}

async function lockInspection(
  tx: Tx,
  tenantId: string,
  projectId: string,
  inspectionId: string,
): Promise<schema.ProjectQcInspectionRow> {
  await loadExecProject(tx, tenantId, projectId);
  const [row] = await tx
    .select()
    .from(projectQcInspections)
    .where(
      and(
        eq(projectQcInspections.id, inspectionId),
        eq(projectQcInspections.projectId, projectId),
        eq(projectQcInspections.tenantId, tenantId),
      ),
    )
    .for('update');
  if (!row) throw new AppError('QC_INSPECTION_NOT_FOUND');
  return row;
}

export { desc };
