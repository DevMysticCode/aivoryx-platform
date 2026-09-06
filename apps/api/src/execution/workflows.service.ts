import { Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { isValidHandoverTransition, isValidNetMeteringTransition } from './lifecycles.js';
import {
  loadExecProject,
  recordActivity,
  refreshMilestones,
  requireExecutionStarted,
} from './helpers.js';
import { incompleteRequiredItems } from './installations.service.js';
import { buildView } from './execution.service.js';
import type { TenantScope } from './common.js';
import type {
  ExecutionViewDto,
  NetMeteringDto,
  UpdateHandoverDto,
  UpdateNetMeteringDto,
} from './execution.dto.js';

const { projectNetMetering, projectHandover, projectInstallations, projectQcInspections } = schema;

@Injectable()
export class ProjectWorkflowsService {
  constructor(private readonly outbox: OutboxService) {}

  private view(scope: TenantScope, projectId: string): Promise<ExecutionViewDto> {
    return withTenantContext(getDb(), scope, (tx) => buildView(tx, scope.tenantId, projectId));
  }

  // ---- net metering --------------------------------------

  async getNetMetering(scope: TenantScope, projectId: string): Promise<NetMeteringDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await loadExecProject(tx, scope.tenantId, projectId);
      const row = await loadNetMetering(tx, scope.tenantId, projectId);
      return toNetMeteringDto(row);
    });
  }

  async updateNetMetering(
    scope: TenantScope,
    projectId: string,
    body: UpdateNetMeteringDto,
  ): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      const [cur] = await tx
        .select()
        .from(projectNetMetering)
        .where(
          and(
            eq(projectNetMetering.tenantId, scope.tenantId),
            eq(projectNetMetering.projectId, projectId),
          ),
        )
        .for('update');
      if (!cur) throw new AppError('EXECUTION_NOT_STARTED');

      let nextStatus = cur.status;
      if (body.status && body.status !== cur.status) {
        if (!isValidNetMeteringTransition(cur.status, body.status)) {
          throw new AppError('NET_METERING_INVALID_STATE', {
            details: { from: cur.status, to: body.status },
          });
        }
        nextStatus = body.status;
      }
      const submitting = nextStatus === 'SUBMITTED' && cur.status !== 'SUBMITTED';
      const approving = nextStatus === 'APPROVED' && cur.status !== 'APPROVED';

      await tx
        .update(projectNetMetering)
        .set({
          status: nextStatus,
          notRequired: body.notRequired ?? undefined,
          referenceNumber: body.referenceNumber ?? undefined,
          notes: body.notes ?? undefined,
          submittedAt: submitting ? sql`now()` : undefined,
          approvedAt: approving ? sql`now()` : undefined,
          updatedAt: new Date(),
        })
        .where(eq(projectNetMetering.id, cur.id));

      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: submitting
          ? 'net_metering_submitted'
          : approving
            ? 'net_metering_approved'
            : 'net_metering_updated',
        actorMembershipId: scope.actorMembershipId,
        payload: { status: nextStatus, notRequired: body.notRequired ?? cur.notRequired },
      });
      await refreshMilestones(tx, scope, projectId);
      if (submitting) {
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'net_metering.submitted',
          payload: { projectId },
        });
      }
      if (approving) {
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'net_metering.approved',
          payload: { projectId },
        });
      }
    });
    return this.view(scope, projectId);
  }

  // ---- handover -----------------------------------------

  async updateHandover(
    scope: TenantScope,
    projectId: string,
    body: UpdateHandoverDto,
  ): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      const [cur] = await tx
        .select()
        .from(projectHandover)
        .where(
          and(
            eq(projectHandover.tenantId, scope.tenantId),
            eq(projectHandover.projectId, projectId),
          ),
        )
        .for('update');
      if (!cur) throw new AppError('EXECUTION_NOT_STARTED');
      if (cur.status === 'COMPLETED') {
        throw new AppError('HANDOVER_INVALID_STATE', { details: { status: 'COMPLETED' } });
      }

      const ack = body.customerAcknowledged ?? cur.customerAcknowledged;
      // "READY" once prerequisites hold and the customer has acknowledged
      const ready = ack && (await handoverPrereqsOk(tx, scope.tenantId, projectId));
      const nextStatus = ready ? 'READY' : 'PENDING';

      await tx
        .update(projectHandover)
        .set({
          notes: body.notes ?? undefined,
          customerAcknowledged: ack,
          acknowledgedByName: body.acknowledgedByName ?? undefined,
          status: nextStatus,
          updatedAt: new Date(),
        })
        .where(eq(projectHandover.id, cur.id));
      await refreshMilestones(tx, scope, projectId);
    });
    return this.view(scope, projectId);
  }

  async completeHandover(scope: TenantScope, projectId: string): Promise<ExecutionViewDto> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      const [cur] = await tx
        .select()
        .from(projectHandover)
        .where(
          and(
            eq(projectHandover.tenantId, scope.tenantId),
            eq(projectHandover.projectId, projectId),
          ),
        )
        .for('update');
      if (!cur) throw new AppError('EXECUTION_NOT_STARTED');
      if (cur.status === 'COMPLETED') return; // idempotent
      if (!isValidHandoverTransition(cur.status, 'COMPLETED')) {
        throw new AppError('HANDOVER_INVALID_STATE', { details: { from: cur.status } });
      }

      const missingChecklist = await incompleteRequiredItems(
        tx,
        scope.tenantId,
        projectId,
        'handover',
        null,
      );
      const prereqMissing: string[] = [...missingChecklist];
      if (!cur.customerAcknowledged) prereqMissing.push('Customer acknowledgement not recorded');
      if (!(await handoverPrereqsOk(tx, scope.tenantId, projectId))) {
        prereqMissing.push('Installation and QC must be complete');
      }
      if (prereqMissing.length > 0) {
        throw new AppError('HANDOVER_NOT_READY', { details: { missing: prereqMissing } });
      }

      await tx
        .update(projectHandover)
        .set({
          status: 'COMPLETED',
          handoverAt: sql`now()`,
          handedOverByMembershipId: scope.actorMembershipId,
          updatedAt: new Date(),
        })
        .where(eq(projectHandover.id, cur.id));
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'handover_completed',
        actorMembershipId: scope.actorMembershipId,
      });
      await refreshMilestones(tx, scope, projectId);
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'handover.completed',
        payload: { projectId },
      });
    });
    return this.view(scope, projectId);
  }
}

// ---- helpers -----------------------------------------------

async function loadNetMetering(
  tx: Tx,
  tenantId: string,
  projectId: string,
): Promise<schema.ProjectNetMeteringRow> {
  const [row] = await tx
    .select()
    .from(projectNetMetering)
    .where(
      and(eq(projectNetMetering.tenantId, tenantId), eq(projectNetMetering.projectId, projectId)),
    );
  if (!row) throw new AppError('EXECUTION_NOT_STARTED');
  return row;
}

async function handoverPrereqsOk(tx: Tx, tenantId: string, projectId: string): Promise<boolean> {
  const [inst] = await tx
    .select({ status: projectInstallations.status })
    .from(projectInstallations)
    .where(
      and(
        eq(projectInstallations.tenantId, tenantId),
        eq(projectInstallations.projectId, projectId),
      ),
    );
  const [qc] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(projectQcInspections)
    .where(
      and(
        eq(projectQcInspections.tenantId, tenantId),
        eq(projectQcInspections.projectId, projectId),
        inArray(projectQcInspections.status, ['PASSED']),
      ),
    );
  return inst?.status === 'COMPLETED' && (qc?.n ?? 0) > 0;
}

function toNetMeteringDto(row: schema.ProjectNetMeteringRow): NetMeteringDto {
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
