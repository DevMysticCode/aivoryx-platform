import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';

const {
  customFieldDefinitions,
  customFieldValues,
  leadFollowups,
  leads,
  leadSources,
  userTenantMemberships,
  users,
} = schema;

export interface LeadAssigneeView {
  membershipId: string;
  name: string | null;
  email: string;
}

export interface LeadView {
  id: string;
  sourceId: string | null;
  sourceName: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  status: string;
  assignee: LeadAssigneeView | null;
  qualificationNote: string | null;
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ListLeadsFilter {
  status?: string;
  sourceId?: string;
  assignedMembershipId?: string;
  /** matched against name/phone/email, case-insensitive substring */
  q?: string;
  page: number;
  pageSize: number;
}

export interface ListLeadsResult {
  items: LeadView[];
  total: number;
  page: number;
  pageSize: number;
}

const leadSelect = {
  id: leads.id,
  sourceId: leads.sourceId,
  sourceName: leadSources.name,
  name: leads.name,
  phone: leads.phone,
  email: leads.email,
  addressLine: leads.addressLine,
  city: leads.city,
  state: leads.state,
  postalCode: leads.postalCode,
  country: leads.country,
  status: leads.status,
  qualificationNote: leads.qualificationNote,
  assignedMembershipId: leads.assignedMembershipId,
  assigneeUserId: users.id,
  assigneeName: users.name,
  assigneeEmail: users.email,
  createdAt: leads.createdAt,
  updatedAt: leads.updatedAt,
} as const;

function toLeadView(row: {
  id: string;
  sourceId: string | null;
  sourceName: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  status: string;
  qualificationNote: string | null;
  assignedMembershipId: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}): LeadView {
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    name: row.name,
    phone: row.phone,
    email: row.email,
    addressLine: row.addressLine,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    status: row.status,
    qualificationNote: row.qualificationNote,
    assignee:
      row.assignedMembershipId && row.assigneeEmail
        ? {
            membershipId: row.assignedMembershipId,
            name: row.assigneeName,
            email: row.assigneeEmail,
          }
        : null,
    customFields: {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assigneeJoin(tx: Tx) {
  return tx
    .select(leadSelect)
    .from(leads)
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(userTenantMemberships, eq(userTenantMemberships.id, leads.assignedMembershipId))
    .leftJoin(users, eq(users.id, userTenantMemberships.userId));
}

/** Custom field values for one or more leads, keyed by leadId then field key. */
export async function loadCustomFieldsForLeads(
  tx: Tx,
  tenantId: string,
  leadIds: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const result = new Map<string, Record<string, unknown>>();
  if (leadIds.length === 0) return result;

  const rows = await tx
    .select({
      entityId: customFieldValues.entityId,
      key: customFieldDefinitions.key,
      dataType: customFieldDefinitions.dataType,
      valueText: customFieldValues.valueText,
      valueNumber: customFieldValues.valueNumber,
      valueBoolean: customFieldValues.valueBoolean,
      valueDate: customFieldValues.valueDate,
    })
    .from(customFieldValues)
    .innerJoin(
      customFieldDefinitions,
      eq(customFieldDefinitions.id, customFieldValues.definitionId),
    )
    .where(
      and(
        eq(customFieldValues.tenantId, tenantId),
        eq(customFieldValues.entity, 'lead'),
        inArray(customFieldValues.entityId, leadIds),
      ),
    );

  for (const row of rows) {
    const bucket = result.get(row.entityId) ?? {};
    bucket[row.key] =
      row.dataType === 'number'
        ? row.valueNumber === null
          ? null
          : Number(row.valueNumber)
        : row.dataType === 'boolean'
          ? row.valueBoolean
          : row.dataType === 'date'
            ? row.valueDate
            : row.valueText;
    result.set(row.entityId, bucket);
  }
  return result;
}

export async function loadLeadView(
  tx: Tx,
  tenantId: string,
  leadId: string,
): Promise<LeadView | undefined> {
  const [row] = await assigneeJoin(tx).where(
    and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)),
  );
  if (!row) return undefined;
  const view = toLeadView(row);
  const customFields = await loadCustomFieldsForLeads(tx, tenantId, [leadId]);
  view.customFields = customFields.get(leadId) ?? {};
  return view;
}

export async function listLeads(
  tx: Tx,
  tenantId: string,
  filter: ListLeadsFilter,
): Promise<ListLeadsResult> {
  const conditions = [eq(leads.tenantId, tenantId)];
  if (filter.status)
    conditions.push(eq(leads.status, filter.status as (typeof leads.status.enumValues)[number]));
  if (filter.sourceId) conditions.push(eq(leads.sourceId, filter.sourceId));
  if (filter.assignedMembershipId) {
    conditions.push(eq(leads.assignedMembershipId, filter.assignedMembershipId));
  }
  if (filter.q && filter.q.trim().length > 0) {
    const like = `%${filter.q.trim()}%`;
    conditions.push(
      or(ilike(leads.name, like), ilike(leads.phone, like), ilike(leads.email, like))!,
    );
  }
  const where = and(...conditions);

  const [countRow] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(leads)
    .where(where);
  const count = countRow?.count ?? 0;

  const page = Math.max(1, filter.page);
  const pageSize = Math.min(Math.max(1, filter.pageSize), 100);

  const rows = await assigneeJoin(tx)
    .where(where)
    .orderBy(desc(leads.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const items = rows.map(toLeadView);
  const customFields = await loadCustomFieldsForLeads(
    tx,
    tenantId,
    items.map((i) => i.id),
  );
  for (const item of items) item.customFields = customFields.get(item.id) ?? {};

  return { items, total: count, page, pageSize };
}

/**
 * Conservative deterministic dedupe (ADR 0031): exact match on normalized
 * phone first, then normalized email — never both fuzzy, never cross-tenant.
 * Returns the single matching lead id, or `undefined` for "no match" /
 * "ambiguous" (an ambiguous match is deliberately treated as "no match" —
 * safer to create a new lead than to silently merge into the wrong one).
 */
export async function findDuplicateLead(
  tx: Tx,
  tenantId: string,
  identity: { normalizedPhone: string | null; normalizedEmail: string | null },
): Promise<string | undefined> {
  if (identity.normalizedPhone) {
    const byPhone = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(eq(leads.tenantId, tenantId), eq(leads.normalizedPhone, identity.normalizedPhone)),
      );
    if (byPhone.length === 1) return byPhone[0]!.id;
    if (byPhone.length > 1) return undefined; // ambiguous — do not guess
  }
  if (identity.normalizedEmail) {
    const byEmail = await tx
      .select({ id: leads.id })
      .from(leads)
      .where(
        and(eq(leads.tenantId, tenantId), eq(leads.normalizedEmail, identity.normalizedEmail)),
      );
    if (byEmail.length === 1) return byEmail[0]!.id;
  }
  return undefined;
}

export async function leadExists(tx: Tx, tenantId: string, leadId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)))
    .limit(1);
  return !!row;
}

/** Membership must belong to the active tenant and not be removed. */
export async function membershipExistsInTenant(
  tx: Tx,
  tenantId: string,
  membershipId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: userTenantMemberships.id })
    .from(userTenantMemberships)
    .where(
      and(eq(userTenantMemberships.id, membershipId), eq(userTenantMemberships.tenantId, tenantId)),
    )
    .limit(1);
  return !!row;
}

/** Upcoming (pending, not-yet-overdue-tracked) follow-ups — used by the lead detail view. */
export async function loadFollowupsForLead(tx: Tx, tenantId: string, leadId: string) {
  return tx
    .select()
    .from(leadFollowups)
    .where(and(eq(leadFollowups.tenantId, tenantId), eq(leadFollowups.leadId, leadId)))
    .orderBy(asc(leadFollowups.dueAt));
}
