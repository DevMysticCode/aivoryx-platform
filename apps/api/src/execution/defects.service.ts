import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { OutboxService } from '../admin/outbox.service.js';
import { isValidDefectTransition } from './lifecycles.js';
import {
  loadExecProject,
  recordActivity,
  refreshMilestones,
  requireExecutionStarted,
} from './helpers.js';
import type { ExecutionVisibility, TenantScope } from './common.js';
import type { CreateDefectDto, DefectDto, UpdateDefectDto } from './execution.dto.js';

const { projectDefects, userTenantMemberships, users } = schema;

@Injectable()
export class DefectsService {
  constructor(private readonly outbox: OutboxService) {}

  async list(
    scope: TenantScope,
    projectId: string,
    visibility: ExecutionVisibility,
  ): Promise<DefectDto[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await loadExecProject(tx, scope.tenantId, projectId);
      const conds = [
        eq(projectDefects.tenantId, scope.tenantId),
        eq(projectDefects.projectId, projectId),
      ];
      if (!visibility.canSeeAll) {
        conds.push(eq(projectDefects.assignedMembershipId, scope.actorMembershipId));
      }
      const rows = await tx
        .select({ d: projectDefects, assignedName: users.name })
        .from(projectDefects)
        .leftJoin(
          userTenantMemberships,
          eq(userTenantMemberships.id, projectDefects.assignedMembershipId),
        )
        .leftJoin(users, eq(users.id, userTenantMemberships.userId))
        .where(and(...conds))
        .orderBy(desc(projectDefects.createdAt));
      return rows.map((r) => toDefectDto(r.d, r.assignedName));
    });
  }

  async create(scope: TenantScope, projectId: string, body: CreateDefectDto): Promise<DefectDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await requireExecutionStarted(tx, scope.tenantId, projectId);
      const [row] = await tx
        .insert(projectDefects)
        .values({
          tenantId: scope.tenantId,
          projectId,
          inspectionId: body.inspectionId ?? null,
          description: body.description.trim(),
          severity: body.severity ?? 'medium',
          status: 'OPEN',
          assignedMembershipId: body.assignedMembershipId ?? null,
          createdByMembershipId: scope.actorMembershipId,
        })
        .returning();
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        projectId,
        type: 'defect_created',
        actorMembershipId: scope.actorMembershipId,
        payload: { defectId: row!.id, severity: row!.severity },
      });
      await refreshMilestones(tx, scope, projectId);
      await this.outbox.emit(tx, {
        tenantId: scope.tenantId,
        type: 'defect.created',
        payload: { projectId, defectId: row!.id, severity: row!.severity },
        actorMembershipId: scope.actorMembershipId,
      });
      return toDefectDto(row!, null);
    });
  }

  async update(
    scope: TenantScope,
    projectId: string,
    defectId: string,
    body: UpdateDefectDto,
    visibility: ExecutionVisibility,
  ): Promise<DefectDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [cur] = await tx
        .select()
        .from(projectDefects)
        .where(
          and(
            eq(projectDefects.id, defectId),
            eq(projectDefects.projectId, projectId),
            eq(projectDefects.tenantId, scope.tenantId),
          ),
        )
        .for('update');
      if (!cur) throw new AppError('DEFECT_NOT_FOUND');
      if (!visibility.canSeeAll && cur.assignedMembershipId !== scope.actorMembershipId) {
        throw new AppError('INSTALLATION_NOT_ASSIGNED_TO_YOU');
      }

      let nextStatus = cur.status;
      if (body.status && body.status !== cur.status) {
        if (!isValidDefectTransition(cur.status, body.status)) {
          throw new AppError('DEFECT_INVALID_STATE', {
            details: { from: cur.status, to: body.status },
          });
        }
        nextStatus = body.status;
      }
      const resolving = nextStatus === 'RESOLVED' && cur.status !== 'RESOLVED';
      const verifying = nextStatus === 'VERIFIED' && cur.status !== 'VERIFIED';

      const [row] = await tx
        .update(projectDefects)
        .set({
          status: nextStatus,
          severity: body.severity ?? undefined,
          assignedMembershipId:
            body.assignedMembershipId === undefined ? undefined : body.assignedMembershipId,
          resolutionNote: body.resolutionNote ?? undefined,
          resolvedAt: resolving ? sql`now()` : nextStatus === 'OPEN' ? null : undefined,
          verifiedAt: verifying ? sql`now()` : nextStatus === 'OPEN' ? null : undefined,
          updatedAt: new Date(),
        })
        .where(eq(projectDefects.id, defectId))
        .returning();

      if (resolving || verifying) {
        await recordActivity(tx, {
          tenantId: scope.tenantId,
          projectId,
          type: 'defect_resolved',
          actorMembershipId: scope.actorMembershipId,
          payload: { defectId, status: nextStatus },
        });
        await this.outbox.emit(tx, {
          tenantId: scope.tenantId,
          type: 'defect.resolved',
          payload: { projectId, defectId, status: nextStatus },
        });
      }
      await refreshMilestones(tx, scope, projectId);
      const [name] = row!.assignedMembershipId
        ? await tx
            .select({ name: users.name })
            .from(userTenantMemberships)
            .leftJoin(users, eq(users.id, userTenantMemberships.userId))
            .where(eq(userTenantMemberships.id, row!.assignedMembershipId))
        : [];
      return toDefectDto(row!, name?.name ?? null);
    });
  }
}

function toDefectDto(row: schema.ProjectDefectRow, assignedName: string | null): DefectDto {
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

export type { Tx };
