import { and, eq } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';

/**
 * Safe template context builders (ADR 0037).
 *
 * The notification engine NEVER serialises a raw event payload into a
 * template, an email, a log line or a notification body. For each handled
 * event family a builder here reads a small, explicit set of business fields
 * (inside the event's own tenant RLS context) and returns:
 *
 *   - `context`: the whitelisted values a template may interpolate
 *   - `refs`   : ids the recipient resolver needs (owner membership, customer
 *                email/name) — already resolved so the resolver stays trivial
 *
 * An unhandled event type returns `null` and the engine does nothing.
 */

const {
  quotations,
  quotationRevisions,
  leads,
  leadSources,
  customers,
  projects,
  projectInstallations,
  visits,
  dispatches,
  purchaseOrders,
  userTenantMemberships,
} = schema;

export interface EventRefs {
  /** the membership that caused the event (from the outbox row, never payload) */
  actorMembershipId: string | null;
  /** "the assigned user" for this event's primary entity (lead/visit/installation owner) */
  assignedMembershipId: string | null;
  /** external customer contact, when the entity has one */
  customerEmail: string | null;
  customerName: string | null;
}

export interface BuiltEventContext {
  context: Record<string, unknown>;
  refs: EventRefs;
}

interface RawEvent {
  id: string;
  type: string;
  tenantId: string;
  payload: Record<string, unknown>;
  actorMembershipId: string | null;
}

function str(payload: Record<string, unknown>, key: string): string | null {
  const v = payload[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function money(value: string | null | undefined): string {
  if (!value) return '0';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : value;
}

async function tenantName(tx: Tx, tenantId: string): Promise<string> {
  const [row] = await tx
    .select({ name: schema.tenants.name })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);
  return row?.name ?? 'Aivoryx';
}

async function membershipIsActive(
  tx: Tx,
  tenantId: string,
  membershipId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ status: userTenantMemberships.status })
    .from(userTenantMemberships)
    .where(
      and(eq(userTenantMemberships.id, membershipId), eq(userTenantMemberships.tenantId, tenantId)),
    )
    .limit(1);
  return row?.status === 'active';
}

async function customerByLead(
  tx: Tx,
  tenantId: string,
  leadId: string | null,
): Promise<{ email: string | null; name: string | null }> {
  if (!leadId) return { email: null, name: null };
  const [row] = await tx
    .select({ email: customers.email, name: customers.name })
    .from(customers)
    .where(and(eq(customers.tenantId, tenantId), eq(customers.leadId, leadId)))
    .limit(1);
  return { email: row?.email ?? null, name: row?.name ?? null };
}

async function leadOwnerAndName(
  tx: Tx,
  tenantId: string,
  leadId: string | null,
): Promise<{ assigned: string | null; name: string; source: string }> {
  if (!leadId) return { assigned: null, name: 'the lead', source: 'unknown' };
  const [row] = await tx
    .select({
      assigned: leads.assignedMembershipId,
      name: leads.name,
      origin: leads.origin,
      sourceName: leadSources.name,
    })
    .from(leads)
    .leftJoin(leadSources, eq(leads.sourceId, leadSources.id))
    .where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)))
    .limit(1);
  return {
    assigned: row?.assigned ?? null,
    name: row?.name ?? 'the lead',
    source: row?.sourceName ?? row?.origin ?? 'unknown',
  };
}

export async function buildEventContext(
  tx: Tx,
  event: RawEvent,
): Promise<BuiltEventContext | null> {
  const { type, tenantId, payload } = event;
  const tenant = { name: await tenantName(tx, tenantId) };
  const baseRefs: EventRefs = {
    actorMembershipId: event.actorMembershipId,
    assignedMembershipId: null,
    customerEmail: null,
    customerName: null,
  };

  // --- quotation.* -----------------------------------------------------
  if (type === 'quotation.sent' || type === 'quotation.accepted' || type === 'quotation.booked') {
    const quotationId = str(payload, 'quotationId');
    if (!quotationId) return null;
    const [q] = await tx
      .select({
        id: quotations.id,
        number: quotations.number,
        status: quotations.status,
        leadId: quotations.leadId,
        customerId: quotations.customerId,
        currentRevisionNo: quotations.currentRevisionNo,
      })
      .from(quotations)
      .where(and(eq(quotations.tenantId, tenantId), eq(quotations.id, quotationId)))
      .limit(1);
    if (!q) return null;
    const [rev] = await tx
      .select({ total: quotationRevisions.total })
      .from(quotationRevisions)
      .where(
        and(
          eq(quotationRevisions.tenantId, tenantId),
          eq(quotationRevisions.quotationId, quotationId),
          eq(quotationRevisions.revisionNo, q.currentRevisionNo),
        ),
      )
      .limit(1);
    const owner = await leadOwnerAndName(tx, tenantId, q.leadId);
    let customer = { email: null as string | null, name: null as string | null };
    if (q.customerId) {
      const [c] = await tx
        .select({ email: customers.email, name: customers.name })
        .from(customers)
        .where(and(eq(customers.tenantId, tenantId), eq(customers.id, q.customerId)))
        .limit(1);
      customer = { email: c?.email ?? null, name: c?.name ?? null };
    }
    if (!customer.email) customer = await customerByLead(tx, tenantId, q.leadId);
    return {
      context: {
        tenant,
        quotation: { id: q.id, number: q.number, status: q.status, total: money(rev?.total) },
        customer: { name: customer.name ?? owner.name },
        lead: { name: owner.name },
      },
      refs: {
        ...baseRefs,
        assignedMembershipId: owner.assigned,
        customerEmail: customer.email,
        customerName: customer.name,
      },
    };
  }

  // --- project.completed --------------------------------------------
  if (type === 'project.completed') {
    const projectId = str(payload, 'projectId');
    if (!projectId) return null;
    const [p] = await tx
      .select({
        id: projects.id,
        number: projects.number,
        status: projects.status,
        leadId: projects.leadId,
      })
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)))
      .limit(1);
    if (!p) return null;
    const customer = await customerByLead(tx, tenantId, p.leadId);
    const owner = await leadOwnerAndName(tx, tenantId, p.leadId);
    return {
      context: {
        tenant,
        project: { id: p.id, number: p.number, status: p.status },
        customer: { name: customer.name ?? owner.name },
      },
      refs: {
        ...baseRefs,
        assignedMembershipId: owner.assigned,
        customerEmail: customer.email,
        customerName: customer.name,
      },
    };
  }

  // --- installation.assigned --------------------------------------
  if (type === 'installation.assigned') {
    const projectId = str(payload, 'projectId');
    if (!projectId) return null;
    const [p] = await tx
      .select({ id: projects.id, number: projects.number })
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)))
      .limit(1);
    const [inst] = await tx
      .select({ assigned: projectInstallations.assignedMembershipId })
      .from(projectInstallations)
      .where(
        and(
          eq(projectInstallations.tenantId, tenantId),
          eq(projectInstallations.projectId, projectId),
        ),
      )
      .limit(1);
    const assigned = inst?.assigned ?? str(payload, 'membershipId');
    return {
      context: { tenant, project: { id: projectId, number: p?.number ?? projectId } },
      refs: { ...baseRefs, assignedMembershipId: assigned ?? null },
    };
  }

  // --- visit.assigned -------------------------------------------
  if (type === 'visit.assigned') {
    const visitId = str(payload, 'visitId');
    if (!visitId) return null;
    const [v] = await tx
      .select({
        id: visits.id,
        assigned: visits.assignedMembershipId,
        leadId: visits.leadId,
        scheduledAt: visits.scheduledAt,
      })
      .from(visits)
      .where(and(eq(visits.tenantId, tenantId), eq(visits.id, visitId)))
      .limit(1);
    if (!v) return null;
    const owner = await leadOwnerAndName(tx, tenantId, v.leadId);
    return {
      context: {
        tenant,
        visit: { id: v.id, scheduledAt: v.scheduledAt?.toISOString() ?? '' },
        lead: { name: owner.name },
      },
      refs: {
        ...baseRefs,
        assignedMembershipId: v.assigned ?? str(payload, 'membershipId'),
      },
    };
  }

  // --- qc.failed / defect.created --------------------------------
  if (type === 'qc.failed' || type === 'defect.created') {
    const projectId = str(payload, 'projectId');
    if (!projectId) return null;
    const [p] = await tx
      .select({ id: projects.id, number: projects.number })
      .from(projects)
      .where(and(eq(projects.tenantId, tenantId), eq(projects.id, projectId)))
      .limit(1);
    return {
      context: {
        tenant,
        project: { id: projectId, number: p?.number ?? projectId },
        defect: { severity: str(payload, 'severity') ?? 'unspecified' },
      },
      refs: baseRefs,
    };
  }

  // --- dispatch.delivered --------------------------------------
  if (type === 'dispatch.delivered') {
    const dispatchId = str(payload, 'dispatchId');
    if (!dispatchId) return null;
    const [d] = await tx
      .select({ id: dispatches.id, number: dispatches.number, projectId: dispatches.projectId })
      .from(dispatches)
      .where(and(eq(dispatches.tenantId, tenantId), eq(dispatches.id, dispatchId)))
      .limit(1);
    let projectNumber = str(payload, 'projectId') ?? '';
    if (d?.projectId) {
      const [p] = await tx
        .select({ number: projects.number })
        .from(projects)
        .where(and(eq(projects.tenantId, tenantId), eq(projects.id, d.projectId)))
        .limit(1);
      projectNumber = p?.number ?? projectNumber;
    }
    return {
      context: {
        tenant,
        dispatch: { id: dispatchId, number: d?.number ?? dispatchId },
        project: { id: d?.projectId ?? '', number: projectNumber },
      },
      refs: baseRefs,
    };
  }

  // --- purchase_order.approved --------------------------------
  if (type === 'purchase_order.approved') {
    const purchaseOrderId = str(payload, 'purchaseOrderId');
    if (!purchaseOrderId) return null;
    const [po] = await tx
      .select({ id: purchaseOrders.id, number: purchaseOrders.number })
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.tenantId, tenantId), eq(purchaseOrders.id, purchaseOrderId)))
      .limit(1);
    return {
      context: {
        tenant,
        purchaseOrder: { id: purchaseOrderId, number: po?.number ?? purchaseOrderId },
      },
      refs: baseRefs,
    };
  }

  // --- lead.created (from inbound ingestion) ------------------
  if (type === 'lead.created') {
    const leadId = str(payload, 'leadId');
    if (!leadId) return null;
    const owner = await leadOwnerAndName(tx, tenantId, leadId);
    return {
      context: { tenant, lead: { id: leadId, name: owner.name, source: owner.source } },
      refs: { ...baseRefs, assignedMembershipId: owner.assigned },
    };
  }

  return null;
}

export { membershipIsActive };
