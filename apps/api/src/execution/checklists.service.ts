import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { ensureAndLoadTemplates } from './checklist-templates.js';
import {
  assertProjectVisible,
  loadExecProject,
  refreshMilestones,
  requireExecutionStarted,
} from './helpers.js';
import { buildView, loadChecklist } from './execution.service.js';
import { isUniqueViolation, type ExecutionVisibility, type TenantScope } from './common.js';
import type {
  AddChecklistItemDto,
  ChecklistItemDto,
  ExecutionViewDto,
  TemplateDto,
  ToggleChecklistItemDto,
  UpsertTemplateDto,
} from './execution.dto.js';

const { projectChecklistItems, checklistTemplates } = schema;
type ChecklistKind = schema.ChecklistTemplateRow['kind'];

@Injectable()
export class ChecklistsService {
  async list(
    scope: TenantScope,
    projectId: string,
    kind: ChecklistKind | undefined,
    inspectionId: string | null,
    visibility: ExecutionVisibility,
  ): Promise<ChecklistItemDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await loadExecProject(tx, scope.tenantId, projectId);
      await assertProjectVisible(tx, scope, projectId, visibility);
      if (kind) return loadChecklist(tx, scope.tenantId, projectId, kind, inspectionId);
      const inst = await loadChecklist(tx, scope.tenantId, projectId, 'installation', null);
      const ho = await loadChecklist(tx, scope.tenantId, projectId, 'handover', null);
      return [...inst, ...ho];
    });
  }

  async toggle(
    scope: TenantScope,
    projectId: string,
    itemId: string,
    body: ToggleChecklistItemDto,
    visibility: ExecutionVisibility,
  ): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      await assertProjectVisible(tx, scope, projectId, visibility);
      const [item] = await tx
        .select()
        .from(projectChecklistItems)
        .where(
          and(
            eq(projectChecklistItems.id, itemId),
            eq(projectChecklistItems.projectId, projectId),
            eq(projectChecklistItems.tenantId, scope.tenantId),
          ),
        );
      if (!item) throw new AppError('CHECKLIST_ITEM_NOT_FOUND');
      const done = body.status === 'done';
      await tx
        .update(projectChecklistItems)
        .set({
          status: body.status,
          completedAt: done ? sql`now()` : null,
          completedByMembershipId: done ? scope.actorMembershipId : null,
          notes: body.notes ?? item.notes,
          updatedAt: new Date(),
        })
        .where(eq(projectChecklistItems.id, itemId));
      await refreshMilestones(tx, scope, projectId);
    });
    return withTenantContext(getDb(), scope, (tx) => buildView(tx, scope.tenantId, projectId));
  }

  async add(
    scope: TenantScope,
    projectId: string,
    body: AddChecklistItemDto,
  ): Promise<ChecklistItemDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      const maxOrderRow = await tx
        .select({ maxOrder: sql<number>`coalesce(max(sort_order), 0)::int` })
        .from(projectChecklistItems)
        .where(
          and(
            eq(projectChecklistItems.tenantId, scope.tenantId),
            eq(projectChecklistItems.projectId, projectId),
            eq(projectChecklistItems.kind, body.kind),
          ),
        );
      await tx.insert(projectChecklistItems).values({
        tenantId: scope.tenantId,
        projectId,
        kind: body.kind,
        inspectionId: body.inspectionId ?? null,
        label: body.label.trim(),
        required: body.required ?? true,
        sortOrder: (maxOrderRow[0]?.maxOrder ?? 0) + 1,
      });
      return loadChecklist(tx, scope.tenantId, projectId, body.kind, body.inspectionId ?? null);
    });
  }

  async remove(scope: TenantScope, projectId: string, itemId: string): Promise<void> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const res = await tx
        .delete(projectChecklistItems)
        .where(
          and(
            eq(projectChecklistItems.id, itemId),
            eq(projectChecklistItems.projectId, projectId),
            eq(projectChecklistItems.tenantId, scope.tenantId),
          ),
        );
      if (res.rowCount === 0) throw new AppError('CHECKLIST_ITEM_NOT_FOUND');
      await refreshMilestones(tx, scope, projectId);
    });
  }

  // ---- templates (tenant-configurable definitions) ----------

  async listTemplates(scope: TenantScope, kind: ChecklistKind | undefined): Promise<TemplateDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const kinds: ChecklistKind[] = kind ? [kind] : ['installation', 'qc', 'handover'];
      const out: TemplateDto[] = [];
      for (const k of kinds) {
        const rows = await ensureAndLoadTemplates(tx, scope.tenantId, k);
        for (const r of rows.sort((a, b) => a.sortOrder - b.sortOrder)) {
          out.push({
            id: r.id,
            kind: r.kind,
            label: r.label,
            sortOrder: r.sortOrder,
            required: r.required,
            isActive: r.isActive,
          });
        }
      }
      return out;
    });
  }

  async createTemplate(scope: TenantScope, body: UpsertTemplateDto): Promise<TemplateDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      try {
        const [row] = await tx
          .insert(checklistTemplates)
          .values({
            tenantId: scope.tenantId,
            kind: body.kind,
            label: body.label.trim(),
            required: body.required ?? true,
            sortOrder: body.sortOrder ?? 99,
            isActive: body.isActive ?? true,
          })
          .returning();
        return toTemplateDto(row!);
      } catch (err) {
        if (isUniqueViolation(err))
          throw new AppError('DUPLICATE_CODE', { details: { label: body.label } });
        throw err;
      }
    });
  }

  async updateTemplate(
    scope: TenantScope,
    id: string,
    body: Partial<UpsertTemplateDto>,
  ): Promise<TemplateDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .update(checklistTemplates)
        .set({
          label: body.label?.trim() ?? undefined,
          required: body.required ?? undefined,
          sortOrder: body.sortOrder ?? undefined,
          isActive: body.isActive ?? undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(checklistTemplates.id, id), eq(checklistTemplates.tenantId, scope.tenantId)))
        .returning();
      if (!row) throw new AppError('CHECKLIST_ITEM_NOT_FOUND');
      return toTemplateDto(row);
    });
  }
}

function toTemplateDto(row: schema.ChecklistTemplateRow): TemplateDto {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    sortOrder: row.sortOrder,
    required: row.required,
    isActive: row.isActive,
  };
}

export { asc };
