import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { isValidProjectTransition, type ProjectStatus } from '../supply/lifecycles.js';
import { ensureAndLoadTemplates } from './checklist-templates.js';
import {
  completionFromSnapshot,
  loadExecProject,
  loadExecutionSnapshot,
  loadReadiness,
  MILESTONE_ORDER,
  recordActivity,
  recordLeadProjectMilestone,
  refreshMilestones,
  syncMilestone,
} from './helpers.js';
import type { ExecutionVisibility, Paged, TenantScope } from './common.js';
import { pageBounds } from './common.js';
import type {
  ChecklistItemDto,
  ExecutionViewDto,
  FieldProjectDto,
  MilestoneDto,
  ProjectCompletionResultDto,
} from './execution.dto.js';

const {
  projects,
  projectMilestones,
  projectChecklistItems,
  projectInstallations,
  projectQcInspections,
  projectDefects,
  projectNetMetering,
  projectHandover,
  leads,
  customers,
  userTenantMemberships,
  users,
} = schema;

@Injectable()
export class ExecutionService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  // ---- execution view ------------------------------------------

  async getView(
    scope: TenantScope,
    projectId: string,
    visibility: ExecutionVisibility,
  ): Promise<ExecutionViewDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await assertVisibleForView(tx, scope, projectId, visibility);
      return buildView(tx, scope.tenantId, projectId);
    });
  }

  async listFieldProjects(scope: TenantScope): Promise<FieldProjectDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({
          projectId: projects.id,
          projectNumber: projects.number,
          customerName: projects.customerName,
          siteCity: projects.siteCity,
          installationStatus: projectInstallations.status,
        })
        .from(projectInstallations)
        .innerJoin(
          projects,
          and(
            eq(projects.id, projectInstallations.projectId),
            eq(projects.tenantId, projects.tenantId),
          ),
        )
        .where(
          and(
            eq(projectInstallations.tenantId, scope.tenantId),
            eq(projectInstallations.assignedMembershipId, scope.actorMembershipId),
            inArray(projectInstallations.status, ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED']),
          ),
        )
        .orderBy(desc(projects.updatedAt));

      const out: FieldProjectDto[] = [];
      for (const r of rows) {
        const readiness = await loadReadiness(tx, scope.tenantId, r.projectId);
        const [defectRow] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(projectDefects)
          .where(
            and(
              eq(projectDefects.tenantId, scope.tenantId),
              eq(projectDefects.projectId, r.projectId),
              eq(projectDefects.assignedMembershipId, scope.actorMembershipId),
              inArray(projectDefects.status, ['OPEN', 'IN_PROGRESS']),
            ),
          );
        out.push({
          projectId: r.projectId,
          projectNumber: r.projectNumber,
          customerName: r.customerName,
          siteCity: r.siteCity,
          installationStatus: r.installationStatus,
          readinessState: readiness.state,
          openDefects: defectRow?.n ?? 0,
        });
      }
      return out;
    });
  }

  // ---- start execution ----------------------------------------

  async startExecution(scope: TenantScope, projectId: string): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      const project = await loadExecProject(tx, scope.tenantId, projectId);
      if (project.status === 'DRAFT') {
        throw new AppError('PROJECT_INVALID_TRANSITION', {
          details: { hint: 'approve/book the project before starting execution' },
        });
      }

      // milestones (idempotent)
      await tx
        .insert(projectMilestones)
        .values(
          MILESTONE_ORDER.map((key, i) => ({
            tenantId: scope.tenantId,
            projectId,
            key,
            sortOrder: i,
            status: key === 'PLANNING' ? ('done' as const) : ('pending' as const),
            completedAt: key === 'PLANNING' ? sql`now()` : null,
            completedByMembershipId: key === 'PLANNING' ? scope.actorMembershipId : null,
          })),
        )
        .onConflictDoNothing();

      // installation record
      await tx
        .insert(projectInstallations)
        .values({
          tenantId: scope.tenantId,
          projectId,
          status: 'UNASSIGNED',
          createdByMembershipId: scope.actorMembershipId,
        })
        .onConflictDoNothing();

      // net metering + handover records
      await tx
        .insert(projectNetMetering)
        .values({
          tenantId: scope.tenantId,
          projectId,
          status: 'NOT_STARTED',
          createdByMembershipId: scope.actorMembershipId,
        })
        .onConflictDoNothing();
      await tx
        .insert(projectHandover)
        .values({
          tenantId: scope.tenantId,
          projectId,
          status: 'PENDING',
          createdByMembershipId: scope.actorMembershipId,
        })
        .onConflictDoNothing();

      // installation + handover checklists from the tenant templates
      for (const kind of ['installation', 'handover'] as const) {
        const [countRow] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(projectChecklistItems)
          .where(
            and(
              eq(projectChecklistItems.tenantId, scope.tenantId),
              eq(projectChecklistItems.projectId, projectId),
              eq(projectChecklistItems.kind, kind),
            ),
          );
        if ((countRow?.n ?? 0) === 0) {
          const templates = await ensureAndLoadTemplates(tx, scope.tenantId, kind);
          const active = templates.filter((t) => t.isActive);
          if (active.length > 0) {
            await tx.insert(projectChecklistItems).values(
              active.map((t) => ({
                tenantId: scope.tenantId,
                projectId,
                templateId: t.id,
                kind,
                label: t.label,
                required: t.required,
                sortOrder: t.sortOrder,
              })),
            );
          }
        }
      }

      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'execution_started',
        actorMembershipId: scope.actorMembershipId,
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'project.execution.started',
        payload: { projectId },
      });

      await refreshMilestones(tx, scope, projectId);
    });
    return this.getView(scope, projectId, { canSeeAll: true });
  }

  // ---- milestones -------------------------------------------

  async listMilestones(scope: TenantScope, projectId: string): Promise<MilestoneDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await loadExecProject(tx, scope.tenantId, projectId);
      return loadMilestones(tx, scope.tenantId, projectId);
    });
  }

  async completeMilestone(
    scope: TenantScope,
    projectId: string,
    milestoneId: string,
    notes?: string,
  ): Promise<MilestoneDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select()
        .from(projectMilestones)
        .where(
          and(
            eq(projectMilestones.id, milestoneId),
            eq(projectMilestones.projectId, projectId),
            eq(projectMilestones.tenantId, scope.tenantId),
          ),
        );
      if (!row) throw new AppError('MILESTONE_NOT_FOUND');
      if (row.status !== 'done') {
        await tx
          .update(projectMilestones)
          .set({
            status: 'done',
            completedAt: sql`now()`,
            completedByMembershipId: scope.actorMembershipId,
            notes: notes ?? row.notes,
            updatedAt: new Date(),
          })
          .where(eq(projectMilestones.id, milestoneId));
        await recordActivity(tx, {
          tenantId: scope.tenantId,
          projectId,
          type: 'milestone_completed',
          actorMembershipId: scope.actorMembershipId,
          payload: { milestone: row.key, manual: true },
        });
      } else if (notes !== undefined) {
        await tx
          .update(projectMilestones)
          .set({ notes, updatedAt: new Date() })
          .where(eq(projectMilestones.id, milestoneId));
      }
      return loadMilestones(tx, scope.tenantId, projectId);
    });
  }

  // ---- project completion ---------------------------------

  async completeProject(
    scope: TenantScope,
    projectId: string,
  ): Promise<ProjectCompletionResultDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [project] = await tx
        .select({ id: projects.id, status: projects.status, leadId: projects.leadId })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.tenantId, scope.tenantId)))
        .for('update');
      if (!project) throw new AppError('PROJECT_NOT_FOUND');

      if (project.status === 'COMPLETED') {
        return { completed: true, projectStatus: 'COMPLETED', missing: [] };
      }

      const snap = await loadExecutionSnapshot(tx, scope.tenantId, projectId);
      const result = completionFromSnapshot(snap);
      if (!result.ok) {
        throw new AppError('PROJECT_COMPLETION_BLOCKED', { details: { missing: result.missing } });
      }

      await advanceProjectStatus(tx, scope, projectId, project.status, 'COMPLETED');
      await syncMilestone(tx, scope, projectId, 'COMPLETED', 'done');
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'completed',
        actorMembershipId: scope.actorMembershipId,
      });
      await recordLeadProjectMilestone(tx, {
        tenantId: scope.tenantId,
        leadId: project.leadId,
        actorMembershipId: scope.actorMembershipId,
        payload: { projectId },
      });
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'project.completed',
        payload: { projectId, leadId: project.leadId },
        actorMembershipId: scope.actorMembershipId,
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'project.completed',
        entityType: 'project',
        entityId: projectId,
        actor: userActor(scope),
        changes: { status: { from: project.status, to: 'COMPLETED' } },
      });
      return { completed: true, projectStatus: 'COMPLETED', missing: [] };
    });
  }
}

// ---- shared view builder (used by controllers + field endpoints) --

export async function buildView(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<ExecutionViewDto> {
  const [prow] = await tx
    .select({
      p: projects,
      leadName: leads.name,
      customerId: customers.id,
      customerName: customers.name,
    })
    .from(projects)
    .leftJoin(leads, eq(leads.id, projects.leadId))
    .leftJoin(
      customers,
      and(eq(customers.leadId, projects.leadId), eq(customers.tenantId, projects.tenantId)),
    )
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
  if (!prow) throw new AppError('PROJECT_NOT_FOUND');

  const readiness = await loadReadiness(tx, tenantId, projectId);
  const milestones = await loadMilestones(tx, tenantId, projectId);
  const executionStarted = milestones.length > 0;
  const snap = await loadExecutionSnapshot(tx, tenantId, projectId);

  const instChecklist = await loadChecklist(tx, tenantId, projectId, 'installation', null);
  const handoverChecklist = await loadChecklist(tx, tenantId, projectId, 'handover', null);

  const qcRows = await tx
    .select({ q: projectQcInspections, inspectorName: users.name })
    .from(projectQcInspections)
    .leftJoin(
      userTenantMemberships,
      eq(userTenantMemberships.id, projectQcInspections.inspectorMembershipId),
    )
    .leftJoin(users, eq(users.id, userTenantMemberships.userId))
    .where(
      and(
        eq(projectQcInspections.tenantId, tenantId),
        eq(projectQcInspections.projectId, projectId),
      ),
    )
    .orderBy(desc(projectQcInspections.seq));

  const defectRows = await tx
    .select({ d: projectDefects, assignedName: users.name })
    .from(projectDefects)
    .leftJoin(
      userTenantMemberships,
      eq(userTenantMemberships.id, projectDefects.assignedMembershipId),
    )
    .leftJoin(users, eq(users.id, userTenantMemberships.userId))
    .where(and(eq(projectDefects.tenantId, tenantId), eq(projectDefects.projectId, projectId)))
    .orderBy(desc(projectDefects.createdAt));

  let installation = null as ExecutionViewDto['installation'];
  if (snap.installation) {
    const [assignee] = snap.installation.assignedMembershipId
      ? await tx
          .select({ name: users.name })
          .from(userTenantMemberships)
          .leftJoin(users, eq(users.id, userTenantMemberships.userId))
          .where(eq(userTenantMemberships.id, snap.installation.assignedMembershipId))
      : [];
    installation = toInstallationDto(snap.installation, assignee?.name ?? null);
  }

  const completion = completionFromSnapshot(snap);
  const progress = {
    materials: readinessPct(readiness.state),
    installation: checklistPct(instChecklist),
    qc: snap.latestQc?.status === 'PASSED' ? 100 : snap.latestQc ? 40 : 0,
    netMetering:
      snap.netMetering?.status === 'COMPLETED' || snap.netMetering?.notRequired
        ? 100
        : netMeteringPct(snap.netMetering?.status),
    handover:
      snap.handover?.status === 'COMPLETED' ? 100 : snap.handover?.status === 'READY' ? 60 : 0,
    overall:
      milestones.length > 0
        ? Math.round(
            (milestones.filter((m) => m.status === 'done').length / milestones.length) * 100,
          )
        : 0,
  };

  return {
    projectId,
    projectNumber: prow.p.number,
    projectStatus: prow.p.status,
    leadId: prow.p.leadId,
    leadName: prow.leadName,
    customerId: prow.customerId,
    customerName: prow.customerName,
    executionStarted,
    readiness: { ...readiness },
    milestones,
    installation,
    installationChecklist: instChecklist,
    qcInspections: qcRows.map((r) => toQcDto(r.q, r.inspectorName)),
    defects: defectRows.map((r) => toDefectDto(r.d, r.assignedName)),
    netMetering: snap.netMetering ? toNetMeteringDto(snap.netMetering) : null,
    handover: snap.handover ? toHandoverDto(snap.handover) : null,
    handoverChecklist,
    progress,
    completionMissing: completion.missing,
    canComplete: completion.ok && prow.p.status !== 'COMPLETED',
  };
}

// ---- shared loaders + mappers ---------------------------------

export async function loadMilestones(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<MilestoneDto[]> {
  const rows = await tx
    .select({ m: projectMilestones, byName: users.name })
    .from(projectMilestones)
    .leftJoin(
      userTenantMemberships,
      eq(userTenantMemberships.id, projectMilestones.completedByMembershipId),
    )
    .leftJoin(users, eq(users.id, userTenantMemberships.userId))
    .where(
      and(eq(projectMilestones.tenantId, tenantId), eq(projectMilestones.projectId, projectId)),
    )
    .orderBy(asc(projectMilestones.sortOrder));
  return rows.map((r) => ({
    id: r.m.id,
    key: r.m.key,
    sortOrder: r.m.sortOrder,
    status: r.m.status,
    completedAt: r.m.completedAt ? r.m.completedAt.toISOString() : null,
    completedByName: r.byName,
    notes: r.m.notes,
  }));
}

export async function loadChecklist(
  tx: Tx,
  tenantId: string,
  projectId: string,
  kind: 'installation' | 'qc' | 'handover',
  inspectionId: string | null,
): Promise<ChecklistItemDto[]> {
  const conds = [
    eq(projectChecklistItems.tenantId, tenantId),
    eq(projectChecklistItems.projectId, projectId),
    eq(projectChecklistItems.kind, kind),
  ];
  if (inspectionId) conds.push(eq(projectChecklistItems.inspectionId, inspectionId));
  const rows = await tx
    .select({ c: projectChecklistItems, byName: users.name })
    .from(projectChecklistItems)
    .leftJoin(
      userTenantMemberships,
      eq(userTenantMemberships.id, projectChecklistItems.completedByMembershipId),
    )
    .leftJoin(users, eq(users.id, userTenantMemberships.userId))
    .where(and(...conds))
    .orderBy(asc(projectChecklistItems.sortOrder));
  return rows
    .filter((r) => (inspectionId ? true : kind === 'qc' ? false : r.c.inspectionId === null))
    .map((r) => ({
      id: r.c.id,
      kind: r.c.kind,
      inspectionId: r.c.inspectionId,
      label: r.c.label,
      sortOrder: r.c.sortOrder,
      required: r.c.required,
      status: r.c.status,
      completedAt: r.c.completedAt ? r.c.completedAt.toISOString() : null,
      completedByName: r.byName,
      notes: r.c.notes,
    }));
}

export function toInstallationDto(
  row: schema.ProjectInstallationRow,
  assignedName: string | null,
): NonNullable<ExecutionViewDto['installation']> {
  return {
    id: row.id,
    status: row.status,
    assignedMembershipId: row.assignedMembershipId,
    assignedName,
    assignedAt: row.assignedAt ? row.assignedAt.toISOString() : null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    notes: row.notes,
    equipmentInstalled: row.equipmentInstalled,
    issues: row.issues,
    materialOverride: row.materialOverride,
    materialOverrideReason: row.materialOverrideReason,
  };
}

export function toQcDto(row: schema.ProjectQcInspectionRow, inspectorName: string | null) {
  return {
    id: row.id,
    seq: row.seq,
    status: row.status,
    inspectorMembershipId: row.inspectorMembershipId,
    inspectorName,
    inspectedAt: row.inspectedAt ? row.inspectedAt.toISOString() : null,
    notes: row.notes,
    resultNote: row.resultNote,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toDefectDto(row: schema.ProjectDefectRow, assignedName: string | null) {
  return {
    id: row.id,
    inspectionId: row.inspectionId,
    description: row.description,
    severity: row.severity,
    status: row.status,
    assignedMembershipId: row.assignedMembershipId,
    assignedName,
    resolutionNote: row.resolutionNote,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toNetMeteringDto(row: schema.ProjectNetMeteringRow) {
  return {
    id: row.id,
    status: row.status,
    notRequired: row.notRequired,
    referenceNumber: row.referenceNumber,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    notes: row.notes,
  };
}

export function toHandoverDto(row: schema.ProjectHandoverRow) {
  return {
    id: row.id,
    status: row.status,
    notes: row.notes,
    customerAcknowledged: row.customerAcknowledged,
    acknowledgedByName: row.acknowledgedByName,
    handoverAt: row.handoverAt ? row.handoverAt.toISOString() : null,
  };
}

// ---- project-status auto-advance ---------------------------

/** Walk the Phase 5 project lifecycle to reach `target`, recording each hop. */
export async function advanceProjectStatus(
  tx: Tx,
  scope: TenantScope,
  projectId: string,
  from: ProjectStatus,
  target: ProjectStatus,
): Promise<void> {
  if (from === target) return;
  const route: ProjectStatus[] = planRoute(from, target);
  if (route.length === 0) {
    throw new AppError('PROJECT_INVALID_TRANSITION', { details: { from, to: target } });
  }
  let current = from;
  for (const next of route) {
    if (!isValidProjectTransition(current, next)) {
      throw new AppError('PROJECT_INVALID_TRANSITION', { details: { from: current, to: next } });
    }
    await tx
      .update(projects)
      .set({ status: next, updatedAt: new Date() })
      .where(and(eq(projects.id, projectId), eq(projects.tenantId, scope.tenantId)));
    await recordActivity(tx, {
      tenantId: scope.tenantId,
      projectId,
      type: 'status_changed',
      actorMembershipId: scope.actorMembershipId,
      payload: { from: current, to: next, via: 'execution' },
    });
    current = next;
  }
}

function planRoute(from: ProjectStatus, target: ProjectStatus): ProjectStatus[] {
  if (target === 'IN_PROGRESS') {
    switch (from) {
      case 'APPROVED':
      case 'PROCUREMENT':
        return ['READY_FOR_DISPATCH', 'IN_PROGRESS'];
      case 'READY_FOR_DISPATCH':
        return ['IN_PROGRESS'];
      case 'ON_HOLD':
        return ['IN_PROGRESS'];
      case 'IN_PROGRESS':
        return [];
      default:
        return [];
    }
  }
  if (target === 'COMPLETED') {
    if (from === 'IN_PROGRESS') return ['COMPLETED'];
    if (from === 'READY_FOR_DISPATCH') return ['IN_PROGRESS', 'COMPLETED'];
    if (from === 'APPROVED' || from === 'PROCUREMENT')
      return ['READY_FOR_DISPATCH', 'IN_PROGRESS', 'COMPLETED'];
    if (from === 'ON_HOLD') return ['IN_PROGRESS', 'COMPLETED'];
    return [];
  }
  return [];
}

// ---- misc ------------------------------------------------

async function assertVisibleForView(
  tx: Tx,
  scope: TenantScope,
  projectId: string,
  visibility: ExecutionVisibility,
): Promise<void> {
  if (visibility.canSeeAll) return;
  const [inst] = await tx
    .select({ id: projectInstallations.id })
    .from(projectInstallations)
    .where(
      and(
        eq(projectInstallations.tenantId, scope.tenantId),
        eq(projectInstallations.projectId, projectId),
        eq(projectInstallations.assignedMembershipId, scope.actorMembershipId),
      ),
    )
    .limit(1);
  if (!inst) throw new AppError('INSTALLATION_NOT_ASSIGNED_TO_YOU');
}

function readinessPct(state: string): number {
  return state === 'READY' ? 100 : state === 'PARTIALLY_READY' ? 50 : 0;
}
function checklistPct(items: ChecklistItemDto[]): number {
  if (items.length === 0) return 0;
  const done = items.filter((i) => i.status === 'done' || i.status === 'na').length;
  return Math.round((done / items.length) * 100);
}
function netMeteringPct(status: string | undefined): number {
  const idx = [
    'NOT_STARTED',
    'DOCUMENTS_PENDING',
    'SUBMITTED',
    'UNDER_REVIEW',
    'APPROVED',
    'COMPLETED',
  ].indexOf(status ?? 'NOT_STARTED');
  return idx <= 0 ? 0 : Math.round((idx / 5) * 100);
}

export { pageBounds };
export type { Paged };
