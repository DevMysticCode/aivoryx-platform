import { and, eq } from 'drizzle-orm';
import { schema, type DataScope, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { recordActivity } from './activities.js';

const { leads, leadFollowups, membershipRoles, roles } = schema;

/**
 * CRM lead access for the caller (Phase 18). Two things other modules need and
 * must not re-implement:
 *
 *  1. `assertLeadAccessible` — the caller's CRM data scope applied to ONE lead, so
 *     a cross-module action (e.g. scheduling a Field visit) can never reach a
 *     lead the caller could not open in CRM. Out of scope ⇒ LEAD_NOT_FOUND (404,
 *     never a 403: no existence leak).
 *  2. `createLeadFollowupTx` — the single way to create a follow-up, joinable to
 *     the caller's transaction (Field completes a visit and the CRM follow-up is
 *     created atomically).
 *
 * Data scope is the existing model (`membership_roles.data_scope` on the caller's
 * profile; no profile ⇒ COMPANY). CRM has no team/department structure, so — as
 * in CRM analytics — only OWN narrows: the caller sees leads assigned to them.
 */

export interface LeadActor {
  tenantId: string;
  actorMembershipId: string;
}

export async function resolveCrmDataScope(
  tx: Tx,
  tenantId: string,
  membershipId: string,
): Promise<DataScope> {
  const [row] = await tx
    .select({ dataScope: membershipRoles.dataScope })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(
      and(
        eq(membershipRoles.tenantId, tenantId),
        eq(membershipRoles.membershipId, membershipId),
        eq(roles.kind, 'profile'),
      ),
    )
    .limit(1);
  return row?.dataScope ?? 'COMPANY';
}

/** The lead's contact/site facts another module may show, or a LEAD_NOT_FOUND. */
export interface AccessibleLead {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  assignedMembershipId: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

export async function assertLeadAccessible(
  tx: Tx,
  actor: LeadActor,
  leadId: string,
): Promise<AccessibleLead> {
  const [lead] = await tx
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      status: leads.status,
      assignedMembershipId: leads.assignedMembershipId,
      addressLine: leads.addressLine,
      city: leads.city,
      state: leads.state,
      postalCode: leads.postalCode,
      country: leads.country,
    })
    .from(leads)
    .where(and(eq(leads.tenantId, actor.tenantId), eq(leads.id, leadId)))
    .limit(1);
  if (!lead) throw new AppError('LEAD_NOT_FOUND');
  const scope = await resolveCrmDataScope(tx, actor.tenantId, actor.actorMembershipId);
  if (scope === 'OWN' && lead.assignedMembershipId !== actor.actorMembershipId) {
    throw new AppError('LEAD_NOT_FOUND');
  }
  return lead;
}

export interface CreateLeadFollowupInput {
  tenantId: string;
  leadId: string;
  assignedMembershipId: string;
  dueAt: Date;
  note: string | null;
  actorMembershipId: string;
}

/** Insert a pending follow-up and its timeline entry inside the caller's transaction. */
export async function createLeadFollowupTx(
  tx: Tx,
  input: CreateLeadFollowupInput,
): Promise<{ id: string }> {
  const [row] = await tx
    .insert(leadFollowups)
    .values({
      tenantId: input.tenantId,
      leadId: input.leadId,
      assignedMembershipId: input.assignedMembershipId,
      dueAt: input.dueAt,
      note: input.note,
    })
    .returning({ id: leadFollowups.id });
  await recordActivity(tx, {
    tenantId: input.tenantId,
    leadId: input.leadId,
    type: 'followup_created',
    actorMembershipId: input.actorMembershipId,
    payload: { followupId: row!.id, dueAt: input.dueAt.toISOString() },
  });
  return { id: row!.id };
}
