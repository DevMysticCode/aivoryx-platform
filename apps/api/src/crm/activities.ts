import { and, desc, eq } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';

const { leadActivities } = schema;

export type LeadActivityType = (typeof leadActivities.type.enumValues)[number];

export interface RecordActivityInput {
  tenantId: string;
  leadId: string;
  type: LeadActivityType;
  /** null = a system/ingestion actor */
  actorMembershipId: string | null;
  payload?: Record<string, unknown>;
}

/** Append one immutable timeline entry. Called inside the caller's own transaction. */
export async function recordActivity(tx: Tx, input: RecordActivityInput): Promise<void> {
  await tx.insert(leadActivities).values({
    tenantId: input.tenantId,
    leadId: input.leadId,
    type: input.type,
    actorMembershipId: input.actorMembershipId,
    payload: input.payload ?? {},
  });
}

export interface LeadActivityView {
  id: string;
  type: LeadActivityType;
  actorMembershipId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export async function listActivitiesForLead(
  tx: Tx,
  tenantId: string,
  leadId: string,
): Promise<LeadActivityView[]> {
  const { users, userTenantMemberships } = schema;
  const rows = await tx
    .select({
      id: leadActivities.id,
      type: leadActivities.type,
      actorMembershipId: leadActivities.actorMembershipId,
      actorName: users.name,
      actorEmail: users.email,
      payload: leadActivities.payload,
      createdAt: leadActivities.createdAt,
    })
    .from(leadActivities)
    .leftJoin(userTenantMemberships, eq(userTenantMemberships.id, leadActivities.actorMembershipId))
    .leftJoin(users, eq(users.id, userTenantMemberships.userId))
    .where(and(eq(leadActivities.tenantId, tenantId), eq(leadActivities.leadId, leadId)))
    .orderBy(desc(leadActivities.createdAt));

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    actorMembershipId: r.actorMembershipId,
    actorName: r.actorName,
    actorEmail: r.actorEmail,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    createdAt: r.createdAt.toISOString(),
  }));
}
