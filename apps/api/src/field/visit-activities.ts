import { and, desc, eq } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';

const { visitActivities, leadActivities } = schema;

export type VisitActivityType = (typeof visitActivities.type.enumValues)[number];
/** The subset of `lead_activities.type` that surface a visit milestone onto the lead timeline. */
export type LeadVisitMilestoneType = Extract<
  (typeof leadActivities.type.enumValues)[number],
  | 'visit_scheduled'
  | 'visit_checked_in'
  | 'visit_survey_completed'
  | 'visit_checked_out'
  | 'visit_completed'
  | 'visit_cancelled'
>;

export interface RecordVisitActivityInput {
  tenantId: string;
  visitId: string;
  type: VisitActivityType;
  actorMembershipId: string | null;
  payload?: Record<string, unknown>;
}

/** Append one immutable entry to the visit's own detailed timeline. */
export async function recordVisitActivity(tx: Tx, input: RecordVisitActivityInput): Promise<void> {
  await tx.insert(visitActivities).values({
    tenantId: input.tenantId,
    visitId: input.visitId,
    type: input.type,
    actorMembershipId: input.actorMembershipId,
    payload: input.payload ?? {},
  });
}

export interface RecordLeadVisitMilestoneInput {
  tenantId: string;
  leadId: string;
  type: LeadVisitMilestoneType;
  actorMembershipId: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Surface a visit milestone onto the EXISTING CRM lead timeline (Phase 4,
 * ADR 0033) — not a second lead-timeline system. Only the handful of
 * milestones a CRM user cares about land here; the full step-by-step detail
 * lives in `visit_activities`.
 */
export async function recordLeadVisitMilestone(
  tx: Tx,
  input: RecordLeadVisitMilestoneInput,
): Promise<void> {
  await tx.insert(leadActivities).values({
    tenantId: input.tenantId,
    leadId: input.leadId,
    type: input.type,
    actorMembershipId: input.actorMembershipId,
    payload: input.payload ?? {},
  });
}

export interface VisitActivityView {
  id: string;
  type: VisitActivityType;
  actorMembershipId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export async function listActivitiesForVisit(
  tx: Tx,
  tenantId: string,
  visitId: string,
): Promise<VisitActivityView[]> {
  const { users, userTenantMemberships } = schema;
  const rows = await tx
    .select({
      id: visitActivities.id,
      type: visitActivities.type,
      actorMembershipId: visitActivities.actorMembershipId,
      actorName: users.name,
      actorEmail: users.email,
      payload: visitActivities.payload,
      createdAt: visitActivities.createdAt,
    })
    .from(visitActivities)
    .leftJoin(
      userTenantMemberships,
      eq(userTenantMemberships.id, visitActivities.actorMembershipId),
    )
    .leftJoin(users, eq(users.id, userTenantMemberships.userId))
    .where(and(eq(visitActivities.tenantId, tenantId), eq(visitActivities.visitId, visitId)))
    .orderBy(desc(visitActivities.createdAt));

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
