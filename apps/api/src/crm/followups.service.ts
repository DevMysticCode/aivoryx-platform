import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { recordActivity } from './activities.js';
import { membershipExistsInTenant } from './lead-queries.js';

const { leadFollowups, leads } = schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
  actorMembershipId: string;
}

export interface FollowupView {
  id: string;
  leadId: string;
  assignedMembershipId: string | null;
  dueAt: string;
  status: 'pending' | 'completed' | 'cancelled';
  note: string | null;
  result: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateFollowupInput {
  assignedMembershipId?: string;
  dueAt: string;
  note?: string;
}

@Injectable()
export class FollowupsService {
  async create(
    scope: TenantScope,
    leadId: string,
    input: CreateFollowupInput,
  ): Promise<FollowupView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await requireLead(tx, scope.tenantId, leadId);
      const assignee = input.assignedMembershipId ?? scope.actorMembershipId;
      if (!(await membershipExistsInTenant(tx, scope.tenantId, assignee))) {
        throw new AppError('LEAD_ASSIGNEE_INVALID');
      }
      const [row] = await tx
        .insert(leadFollowups)
        .values({
          tenantId: scope.tenantId,
          leadId,
          assignedMembershipId: assignee,
          dueAt: new Date(input.dueAt),
          note: input.note ?? null,
        })
        .returning();
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        leadId,
        type: 'followup_created',
        actorMembershipId: scope.actorMembershipId,
        payload: { followupId: row!.id, dueAt: input.dueAt },
      });
      return toView(row!);
    });
  }

  list(scope: TenantScope, leadId: string): Promise<FollowupView[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(leadFollowups)
        .where(and(eq(leadFollowups.tenantId, scope.tenantId), eq(leadFollowups.leadId, leadId)))
        .orderBy(leadFollowups.dueAt);
      return rows.map(toView);
    });
  }

  async complete(
    scope: TenantScope,
    leadId: string,
    followupId: string,
    result?: string,
  ): Promise<FollowupView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const current = await requireFollowup(tx, scope.tenantId, leadId, followupId);
      if (current.status !== 'pending') throw new AppError('FOLLOWUP_ALREADY_COMPLETED');
      const [row] = await tx
        .update(leadFollowups)
        .set({
          status: 'completed',
          result: result ?? null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(leadFollowups.id, followupId))
        .returning();
      await recordActivity(tx, {
        tenantId: scope.tenantId,
        leadId,
        type: 'followup_completed',
        actorMembershipId: scope.actorMembershipId,
        payload: { followupId, result: result ?? null },
      });
      return toView(row!);
    });
  }

  async reschedule(
    scope: TenantScope,
    leadId: string,
    followupId: string,
    dueAt: string,
  ): Promise<FollowupView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const current = await requireFollowup(tx, scope.tenantId, leadId, followupId);
      if (current.status !== 'pending') throw new AppError('FOLLOWUP_ALREADY_COMPLETED');
      const [row] = await tx
        .update(leadFollowups)
        .set({ dueAt: new Date(dueAt), updatedAt: new Date() })
        .where(eq(leadFollowups.id, followupId))
        .returning();
      return toView(row!);
    });
  }
}

async function requireLead(tx: Tx, tenantId: string, leadId: string): Promise<void> {
  const [row] = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .limit(1);
  if (!row) throw new AppError('LEAD_NOT_FOUND');
}

async function requireFollowup(
  tx: Tx,
  tenantId: string,
  leadId: string,
  followupId: string,
): Promise<{ status: 'pending' | 'completed' | 'cancelled' }> {
  const [row] = await tx
    .select({ status: leadFollowups.status })
    .from(leadFollowups)
    .where(
      and(
        eq(leadFollowups.id, followupId),
        eq(leadFollowups.leadId, leadId),
        eq(leadFollowups.tenantId, tenantId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError('FOLLOWUP_NOT_FOUND');
  return row;
}

function toView(row: typeof leadFollowups.$inferSelect): FollowupView {
  return {
    id: row.id,
    leadId: row.leadId,
    assignedMembershipId: row.assignedMembershipId,
    dueAt: row.dueAt.toISOString(),
    status: row.status,
    note: row.note,
    result: row.result,
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}
