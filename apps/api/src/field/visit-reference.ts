import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';

const { visits } = schema;

/** The minimum another module (Commercial) may know about a visit. */
export interface VisitReference {
  id: string;
  leadId: string;
  status: string;
  scheduledAt: string;
  outcome: string | null;
}

/**
 * Field's narrow capability for other modules (Phase 18): "may this caller
 * reference this visit?". Returns `null` for a visit that does not exist in the
 * tenant OR that the caller may not see — indistinguishable by design, so a
 * cross-module reference never reveals an inaccessible record.
 *
 * Visibility mirrors Field's own rule: everyone with Field read access sees every
 * visit if they can also see all CRM leads; otherwise only visits assigned to them.
 * Callers must already have confirmed the FIELD module is entitled and that the
 * caller holds `field.visits.read`.
 */
export async function findReferencableVisit(
  tx: Tx,
  input: { tenantId: string; visitId: string; actorMembershipId: string; canSeeAll: boolean },
): Promise<VisitReference | null> {
  const [row] = await tx
    .select({
      id: visits.id,
      leadId: visits.leadId,
      status: visits.status,
      scheduledAt: visits.scheduledAt,
      outcome: visits.outcome,
      assignedMembershipId: visits.assignedMembershipId,
    })
    .from(visits)
    .where(and(eq(visits.tenantId, input.tenantId), eq(visits.id, input.visitId)))
    .limit(1);
  if (!row) return null;
  if (!input.canSeeAll && row.assignedMembershipId !== input.actorMembershipId) return null;
  return {
    id: row.id,
    leadId: row.leadId,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    outcome: row.outcome,
  };
}
