import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { computeReadiness, type Readiness } from './readiness.js';
import { checkProjectCompletion, type CompletionResult } from './completion.js';
import type { ExecutionVisibility, TenantScope } from './common.js';

const {
  projects,
  projectMaterials,
  projectActivities,
  projectMilestones,
  projectInstallations,
  projectQcInspections,
  projectDefects,
  projectNetMetering,
  projectHandover,
  leads,
  leadActivities,
} = schema;

export type ProjectActivityKind = (typeof projectActivities.type.enumValues)[number];
export type MilestoneKey = (typeof projectMilestones.key.enumValues)[number];
export type MilestoneStatus = (typeof projectMilestones.status.enumValues)[number];

/** The 11 execution milestones, in order. */
export const MILESTONE_ORDER: MilestoneKey[] = [
  'PLANNING',
  'MATERIAL_READY',
  'INSTALLATION_SCHEDULED',
  'INSTALLATION_STARTED',
  'INSTALLATION_COMPLETED',
  'QC_PENDING',
  'QC_PASSED',
  'NET_METERING',
  'HANDOVER_READY',
  'HANDED_OVER',
  'COMPLETED',
];

export interface ExecProject {
  id: string;
  status: schema.ProjectRow['status'];
  leadId: string;
  number: string;
}

export async function loadExecProject(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<ExecProject> {
  const [row] = await tx
    .select({
      id: projects.id,
      status: projects.status,
      leadId: projects.leadId,
      number: projects.number,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)));
  if (!row) throw new AppError('PROJECT_NOT_FOUND');
  return row;
}

export async function executionExists(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: projectMilestones.id })
    .from(projectMilestones)
    .where(
      and(eq(projectMilestones.tenantId, tenantId), eq(projectMilestones.projectId, projectId)),
    )
    .limit(1);
  return !!row;
}

export async function requireExecutionStarted(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<void> {
  if (!(await executionExists(tx, tenantId, projectId))) {
    throw new AppError('EXECUTION_NOT_STARTED');
  }
}

export async function recordActivity(
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

/** Surface a project execution milestone onto the CRM lead timeline. */
export async function recordLeadProjectMilestone(
  tx: Tx,
  input: {
    tenantId: string;
    leadId: string;
    actorMembershipId: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await tx.insert(leadActivities).values({
    tenantId: input.tenantId,
    leadId: input.leadId,
    type: 'project_completed',
    actorMembershipId: input.actorMembershipId,
    payload: input.payload ?? {},
  });
}

/**
 * Move a milestone to a status. Idempotent (only writes if it changes),
 * stamps completed_at/by when moving to `done`, and records a
 * `milestone_completed` activity on a done transition.
 */
export async function syncMilestone(
  tx: Tx,
  scope: TenantScope,
  projectId: string,
  key: MilestoneKey,
  status: MilestoneStatus,
): Promise<void> {
  const [current] = await tx
    .select()
    .from(projectMilestones)
    .where(
      and(
        eq(projectMilestones.tenantId, scope.tenantId),
        eq(projectMilestones.projectId, projectId),
        eq(projectMilestones.key, key),
      ),
    );
  if (!current || current.status === status) return;
  const becomingDone = status === 'done' && current.status !== 'done';
  await tx
    .update(projectMilestones)
    .set({
      status,
      completedAt: becomingDone ? sql`now()` : status === 'done' ? current.completedAt : null,
      completedByMembershipId: becomingDone
        ? scope.actorMembershipId
        : status === 'done'
          ? current.completedByMembershipId
          : null,
      updatedAt: new Date(),
    })
    .where(eq(projectMilestones.id, current.id));
  if (becomingDone) {
    await recordActivity(tx, {
      tenantId: scope.tenantId,
      projectId,
      type: 'milestone_completed',
      actorMembershipId: scope.actorMembershipId,
      payload: { milestone: key },
    });
  }
}

/**
 * Re-derive the auto-managed milestone states from the current workflow
 * records. `PLANNING` and manually-completed milestones are left alone. Pure
 * (no outbox) so every sub-service can call it after a write.
 */
export async function refreshMilestones(
  tx: Tx,
  scope: TenantScope,
  projectId: string,
): Promise<void> {
  const readiness = await loadReadiness(tx, scope.tenantId, projectId);
  const snap = await loadExecutionSnapshot(tx, scope.tenantId, projectId);

  await syncMilestone(
    tx,
    scope,
    projectId,
    'MATERIAL_READY',
    readiness.state === 'READY' ? 'done' : 'pending',
  );

  const inst = snap.installation;
  await syncMilestone(
    tx,
    scope,
    projectId,
    'INSTALLATION_SCHEDULED',
    inst && inst.status !== 'UNASSIGNED' ? 'done' : 'pending',
  );
  await syncMilestone(
    tx,
    scope,
    projectId,
    'INSTALLATION_STARTED',
    inst && (inst.status === 'IN_PROGRESS' || inst.status === 'COMPLETED') ? 'done' : 'pending',
  );
  await syncMilestone(
    tx,
    scope,
    projectId,
    'INSTALLATION_COMPLETED',
    inst?.status === 'COMPLETED' ? 'done' : 'pending',
  );

  const qc = snap.latestQc;
  await syncMilestone(tx, scope, projectId, 'QC_PENDING', qc ? 'done' : 'pending');
  await syncMilestone(
    tx,
    scope,
    projectId,
    'QC_PASSED',
    qc?.status === 'PASSED' ? 'done' : qc?.status === 'FAILED' ? 'blocked' : 'pending',
  );

  const nm = snap.netMetering;
  await syncMilestone(
    tx,
    scope,
    projectId,
    'NET_METERING',
    nm && (nm.status === 'COMPLETED' || nm.notRequired) ? 'done' : 'pending',
  );

  const ho = snap.handover;
  await syncMilestone(
    tx,
    scope,
    projectId,
    'HANDOVER_READY',
    ho && (ho.status === 'READY' || ho.status === 'COMPLETED') ? 'done' : 'pending',
  );
  await syncMilestone(
    tx,
    scope,
    projectId,
    'HANDED_OVER',
    ho?.status === 'COMPLETED' ? 'done' : 'pending',
  );
}

export async function loadReadiness(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<Readiness> {
  const rows = await tx
    .select({
      requiredQty: projectMaterials.requiredQty,
      allocatedQty: projectMaterials.allocatedQty,
      dispatchedQty: projectMaterials.dispatchedQty,
      deliveredQty: projectMaterials.deliveredQty,
    })
    .from(projectMaterials)
    .where(and(eq(projectMaterials.tenantId, tenantId), eq(projectMaterials.projectId, projectId)));
  return computeReadiness(rows);
}

export interface ExecutionSnapshot {
  installation: schema.ProjectInstallationRow | undefined;
  latestQc: schema.ProjectQcInspectionRow | undefined;
  netMetering: schema.ProjectNetMeteringRow | undefined;
  handover: schema.ProjectHandoverRow | undefined;
  openDefects: number;
}

export async function loadExecutionSnapshot(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<ExecutionSnapshot> {
  const [installation] = await tx
    .select()
    .from(projectInstallations)
    .where(
      and(
        eq(projectInstallations.tenantId, tenantId),
        eq(projectInstallations.projectId, projectId),
      ),
    );
  const [latestQc] = await tx
    .select()
    .from(projectQcInspections)
    .where(
      and(
        eq(projectQcInspections.tenantId, tenantId),
        eq(projectQcInspections.projectId, projectId),
      ),
    )
    .orderBy(desc(projectQcInspections.seq))
    .limit(1);
  const [netMetering] = await tx
    .select()
    .from(projectNetMetering)
    .where(
      and(eq(projectNetMetering.tenantId, tenantId), eq(projectNetMetering.projectId, projectId)),
    );
  const [handover] = await tx
    .select()
    .from(projectHandover)
    .where(and(eq(projectHandover.tenantId, tenantId), eq(projectHandover.projectId, projectId)));
  const [defectRow] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(projectDefects)
    .where(
      and(
        eq(projectDefects.tenantId, tenantId),
        eq(projectDefects.projectId, projectId),
        inArray(projectDefects.status, ['OPEN', 'IN_PROGRESS']),
      ),
    );
  return {
    installation,
    latestQc,
    netMetering,
    handover,
    openDefects: defectRow?.n ?? 0,
  };
}

export function completionFromSnapshot(snap: ExecutionSnapshot): CompletionResult {
  return checkProjectCompletion({
    installationStatus: snap.installation?.status ?? null,
    latestQcStatus: snap.latestQc?.status ?? null,
    netMeteringDone: snap.netMetering?.status === 'COMPLETED',
    netMeteringNotRequired: snap.netMetering?.notRequired ?? false,
    handoverStatus: snap.handover?.status ?? null,
    openDefects: snap.openDefects,
  });
}

/**
 * Enforce the field-agent boundary: a caller who cannot see all projects may
 * only touch a project where they are the assigned installation agent or a
 * defect assignee.
 */
export async function assertProjectVisible(
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
  if (inst) return;
  const [def] = await tx
    .select({ id: projectDefects.id })
    .from(projectDefects)
    .where(
      and(
        eq(projectDefects.tenantId, scope.tenantId),
        eq(projectDefects.projectId, projectId),
        eq(projectDefects.assignedMembershipId, scope.actorMembershipId),
      ),
    )
    .limit(1);
  if (def) return;
  throw new AppError('INSTALLATION_NOT_ASSIGNED_TO_YOU');
}

export async function emitExecutionEvent(
  outbox: OutboxService,
  tx: Tx,
  tenantId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await outbox.emit(tx, { tenantId, type, payload });
}

export { leads };
