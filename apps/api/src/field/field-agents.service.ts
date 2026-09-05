import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, provisionFieldAgentRoleTx, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';

const { fieldAgents, users, userTenantMemberships } = schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
}

export interface FieldAgentView {
  id: string;
  membershipId: string;
  userName: string | null;
  userEmail: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

/**
 * The field-agent capability flag on an existing membership (Phase 4, ADR
 * 0033) — no employee master, no HR data. Designating a field agent also
 * grants the `FIELD_AGENT` platform role so the membership actually gains
 * the permissions it needs; deactivating revokes neither the membership nor
 * any other role, only the field-specific access.
 */
@Injectable()
export class FieldAgentsService {
  async list(scope: TenantScope): Promise<FieldAgentView[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select({
          id: fieldAgents.id,
          membershipId: fieldAgents.membershipId,
          status: fieldAgents.status,
          createdAt: fieldAgents.createdAt,
          userName: users.name,
          userEmail: users.email,
        })
        .from(fieldAgents)
        .innerJoin(userTenantMemberships, eq(userTenantMemberships.id, fieldAgents.membershipId))
        .innerJoin(users, eq(users.id, userTenantMemberships.userId))
        .where(eq(fieldAgents.tenantId, scope.tenantId));
      return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
    });
  }

  async designate(scope: TenantScope, membershipId: string): Promise<FieldAgentView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const member = await requireMembership(tx, scope.tenantId, membershipId);

      const [row] = await tx
        .insert(fieldAgents)
        .values({ tenantId: scope.tenantId, membershipId, status: 'active' })
        .onConflictDoUpdate({
          target: [fieldAgents.tenantId, fieldAgents.membershipId],
          set: { status: 'active', deactivatedAt: null, updatedAt: new Date() },
        })
        .returning();

      await provisionFieldAgentRoleTx(tx, {
        tenantId: scope.tenantId,
        actingUserId: scope.userId,
        membershipId,
      });

      return {
        id: row!.id,
        membershipId,
        userName: member.userName,
        userEmail: member.userEmail,
        status: 'active',
        createdAt: row!.createdAt.toISOString(),
      };
    });
  }

  async deactivate(scope: TenantScope, membershipId: string): Promise<FieldAgentView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .update(fieldAgents)
        .set({ status: 'inactive', deactivatedAt: new Date(), updatedAt: new Date() })
        .where(
          and(eq(fieldAgents.tenantId, scope.tenantId), eq(fieldAgents.membershipId, membershipId)),
        )
        .returning();
      if (!row) throw new AppError('FIELD_AGENT_NOT_FOUND');

      const member = await requireMembership(tx, scope.tenantId, membershipId);
      return {
        id: row.id,
        membershipId,
        userName: member.userName,
        userEmail: member.userEmail,
        status: 'inactive',
        createdAt: row.createdAt.toISOString(),
      };
    });
  }
}

async function requireMembership(
  tx: Tx,
  tenantId: string,
  membershipId: string,
): Promise<{ userName: string | null; userEmail: string }> {
  const [row] = await tx
    .select({ userName: users.name, userEmail: users.email })
    .from(userTenantMemberships)
    .innerJoin(users, eq(users.id, userTenantMemberships.userId))
    .where(
      and(eq(userTenantMemberships.id, membershipId), eq(userTenantMemberships.tenantId, tenantId)),
    )
    .limit(1);
  if (!row) throw new AppError('MEMBER_NOT_FOUND', { details: { membershipId } });
  return row;
}

/** True when the membership is currently an active field agent. */
export async function isActiveFieldAgent(
  tx: Tx,
  tenantId: string,
  membershipId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ status: fieldAgents.status })
    .from(fieldAgents)
    .where(and(eq(fieldAgents.tenantId, tenantId), eq(fieldAgents.membershipId, membershipId)))
    .limit(1);
  return row?.status === 'active';
}
