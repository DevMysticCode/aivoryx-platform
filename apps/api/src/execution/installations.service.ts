import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';
import { isActiveFieldAgent } from '../field/field-agents.service.js';
import { installationCanAssign } from './lifecycles.js';
import { installationMaterialsOk } from './readiness.js';
import {
  loadExecProject,
  loadReadiness,
  recordActivity,
  refreshMilestones,
  requireExecutionStarted,
} from './helpers.js';
import type { ExecutionVisibility, TenantScope } from './common.js';
import { buildView } from './execution.service.js';
import { loadChecklist } from './execution.service.js';
import type {
  AssignInstallationDto,
  CompleteInstallationDto,
  ExecutionViewDto,
  MaterialOverrideDto,
  StartInstallationDto,
} from './execution.dto.js';

const { projectInstallations, projectChecklistItems } = schema;

@Injectable()
export class InstallationsService {
  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  private view(scope: TenantScope, projectId: string): Promise<ExecutionViewDto> {
    return withTenantContext(getDb(), scope, (tx) => buildView(tx, scope.tenantId, projectId));
  }

  async assign(
    scope: TenantScope,
    projectId: string,
    body: AssignInstallationDto,
  ): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      const inst = await lockInstallation(tx, scope.tenantId, projectId);
      if (!installationCanAssign(inst.status)) {
        throw new AppError('INSTALLATION_INVALID_STATE', {
          details: { status: inst.status, hint: 'cannot reassign once work has started' },
        });
      }
      if (!(await isActiveFieldAgent(tx, scope.tenantId, body.membershipId))) {
        throw new AppError('FIELD_AGENT_NOT_FOUND', {
          details: { membershipId: body.membershipId },
        });
      }
      await tx
        .update(projectInstallations)
        .set({
          assignedMembershipId: body.membershipId,
          assignedAt: sql`now()`,
          assignedByMembershipId: scope.actorMembershipId,
          visitId: body.visitId ?? inst.visitId,
          status: 'ASSIGNED',
          updatedAt: new Date(),
        })
        .where(eq(projectInstallations.id, inst.id));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'installation_assigned',
        actorMembershipId: scope.actorMembershipId,
        payload: {
          membershipId: body.membershipId,
          reassigned: inst.assignedMembershipId !== null,
        },
      });
      await refreshMilestones(tx, scope, projectId);
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'installation.assigned',
        payload: { projectId, membershipId: body.membershipId },
        actorMembershipId: scope.actorMembershipId,
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'project.installation.assigned',
        entityType: 'project',
        entityId: projectId,
        actor: userActor(scope),
        metadata: { membershipId: body.membershipId },
      });
    });
    return this.view(scope, projectId);
  }

  async unassign(scope: TenantScope, projectId: string): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      const inst = await lockInstallation(tx, scope.tenantId, projectId);
      if (inst.status !== 'ASSIGNED') {
        throw new AppError('INSTALLATION_INVALID_STATE', { details: { status: inst.status } });
      }
      await tx
        .update(projectInstallations)
        .set({
          assignedMembershipId: null,
          assignedAt: null,
          status: 'UNASSIGNED',
          updatedAt: new Date(),
        })
        .where(eq(projectInstallations.id, inst.id));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'installation_assigned',
        actorMembershipId: scope.actorMembershipId,
        payload: { unassigned: true },
      });
      await refreshMilestones(tx, scope, projectId);
    });
    return this.view(scope, projectId);
  }

  async setMaterialOverride(
    scope: TenantScope,
    projectId: string,
    body: MaterialOverrideDto,
  ): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      const inst = await lockInstallation(tx, scope.tenantId, projectId);
      await tx
        .update(projectInstallations)
        .set({
          materialOverride: true,
          materialOverrideByMembershipId: scope.actorMembershipId,
          materialOverrideReason: body.reason,
          updatedAt: new Date(),
        })
        .where(eq(projectInstallations.id, inst.id));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'installation_assigned',
        actorMembershipId: scope.actorMembershipId,
        payload: { materialOverride: true, reason: body.reason },
      });
    });
    return this.view(scope, projectId);
  }

  async start(
    scope: TenantScope,
    projectId: string,
    body: StartInstallationDto,
    visibility: ExecutionVisibility,
  ): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      const inst = await lockInstallation(tx, scope.tenantId, projectId);
      assertAssignee(inst, scope, visibility);
      if (inst.status === 'IN_PROGRESS' || inst.status === 'COMPLETED') {
        return; // idempotent
      }
      if (inst.status !== 'ASSIGNED') {
        throw new AppError('INSTALLATION_INVALID_STATE', {
          details: { status: inst.status, hint: 'assign a field agent first' },
        });
      }
      const readiness = await loadReadiness(tx, scope.tenantId, projectId);
      if (!installationMaterialsOk(readiness.state, inst.materialOverride)) {
        throw new AppError('MATERIAL_NOT_READY', { details: { readiness: readiness.state } });
      }
      await tx
        .update(projectInstallations)
        .set({
          status: 'IN_PROGRESS',
          startedAt: sql`now()`,
          startLat: body.location ? String(body.location.lat) : null,
          startLng: body.location ? String(body.location.lng) : null,
          updatedAt: new Date(),
        })
        .where(eq(projectInstallations.id, inst.id));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'installation_started',
        actorMembershipId: scope.actorMembershipId,
      });
      await refreshMilestones(tx, scope, projectId);
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'installation.started',
        payload: { projectId },
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'project.installation.started',
        entityType: 'project',
        entityId: projectId,
        actor: userActor(scope),
      });
    });
    return this.view(scope, projectId);
  }

  async complete(
    scope: TenantScope,
    projectId: string,
    body: CompleteInstallationDto,
    visibility: ExecutionVisibility,
  ): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      const inst = await lockInstallation(tx, scope.tenantId, projectId);
      assertAssignee(inst, scope, visibility);
      if (inst.status === 'COMPLETED') return; // idempotent
      if (inst.status !== 'IN_PROGRESS') {
        throw new AppError('INSTALLATION_INVALID_STATE', {
          details: { status: inst.status, hint: 'start the installation first' },
        });
      }
      const missing = await incompleteRequiredItems(
        tx,
        scope.tenantId,
        projectId,
        'installation',
        null,
      );
      if (missing.length > 0) {
        throw new AppError('INSTALLATION_CHECKLIST_INCOMPLETE', { details: { missing } });
      }
      await tx
        .update(projectInstallations)
        .set({
          status: 'COMPLETED',
          completedAt: sql`now()`,
          notes: body.notes ?? inst.notes,
          equipmentInstalled: body.equipmentInstalled ?? inst.equipmentInstalled,
          issues: body.issues ?? inst.issues,
          completeLat: body.location ? String(body.location.lat) : null,
          completeLng: body.location ? String(body.location.lng) : null,
          updatedAt: new Date(),
        })
        .where(eq(projectInstallations.id, inst.id));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'installation_completed',
        actorMembershipId: scope.actorMembershipId,
      });
      await refreshMilestones(tx, scope, projectId);
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'installation.completed',
        payload: { projectId },
      });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'project.installation.completed',
        entityType: 'project',
        entityId: projectId,
        actor: userActor(scope),
      });
    });
    return this.view(scope, projectId);
  }
}

// ---- helpers -----------------------------------------------

async function lockInstallation(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<schema.ProjectInstallationRow> {
  await loadExecProject(tx, tenantId, projectId);
  const [row] = await tx
    .select()
    .from(projectInstallations)
    .where(
      and(
        eq(projectInstallations.tenantId, tenantId),
        eq(projectInstallations.projectId, projectId),
      ),
    )
    .for('update');
  if (!row) throw new AppError('INSTALLATION_NOT_FOUND');
  return row;
}

function assertAssignee(
  inst: schema.ProjectInstallationRow,
  scope: TenantScope,
  visibility: ExecutionVisibility,
): void {
  if (visibility.canSeeAll) return;
  if (inst.assignedMembershipId !== scope.actorMembershipId) {
    throw new AppError('INSTALLATION_NOT_ASSIGNED_TO_YOU');
  }
}

export async function incompleteRequiredItems(
  tx: Tx,
  tenantId: string,
  projectId: string,
  kind: 'installation' | 'qc' | 'handover',
  inspectionId: string | null,
): Promise<string[]> {
  const items = await loadChecklist(tx, tenantId, projectId, kind, inspectionId);
  return items.filter((i) => i.required && i.status === 'pending').map((i) => i.label);
}

export { projectChecklistItems };
