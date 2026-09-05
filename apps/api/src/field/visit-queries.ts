import { and, asc, eq, sql } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';

const { visits, leads, userTenantMemberships, users } = schema;

export interface VisitAssigneeView {
  membershipId: string;
  name: string | null;
  email: string;
}

export interface VisitView {
  id: string;
  leadId: string;
  leadName: string | null;
  leadPhone: string | null;
  status: string;
  scheduledAt: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  siteLat: number | null;
  siteLng: number | null;
  assignee: VisitAssigneeView | null;
  checkInAt: string | null;
  checkInLat: number | null;
  checkInLng: number | null;
  checkInAccuracyM: number | null;
  checkOutAt: string | null;
  checkOutLat: number | null;
  checkOutLng: number | null;
  checkOutAccuracyM: number | null;
  gpsDistanceMeters: number | null;
  travelKm: number | null;
  travelNotes: string | null;
  surveyCompletedAt: string | null;
  createdByMembershipId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListVisitsFilter {
  status?: string;
  leadId?: string;
  /** restrict to one assignee — used both for admin filtering and to enforce
   *  a field agent's own-visits-only visibility. */
  assignedMembershipId?: string;
  /** only visits scheduled today (server-side, UTC calendar day) — the "Today" view. */
  today?: boolean;
  page: number;
  pageSize: number;
}

export interface ListVisitsResult {
  items: VisitView[];
  total: number;
  page: number;
  pageSize: number;
}

const num = (v: string | null) => (v === null ? null : Number(v));

const visitSelect = {
  id: visits.id,
  leadId: visits.leadId,
  leadName: leads.name,
  leadPhone: leads.phone,
  status: visits.status,
  scheduledAt: visits.scheduledAt,
  addressLine: visits.addressLine,
  city: visits.city,
  state: visits.state,
  postalCode: visits.postalCode,
  country: visits.country,
  siteLat: visits.siteLat,
  siteLng: visits.siteLng,
  assignedMembershipId: visits.assignedMembershipId,
  assigneeName: users.name,
  assigneeEmail: users.email,
  checkInAt: visits.checkInAt,
  checkInLat: visits.checkInLat,
  checkInLng: visits.checkInLng,
  checkInAccuracyM: visits.checkInAccuracyM,
  checkOutAt: visits.checkOutAt,
  checkOutLat: visits.checkOutLat,
  checkOutLng: visits.checkOutLng,
  checkOutAccuracyM: visits.checkOutAccuracyM,
  gpsDistanceMeters: visits.gpsDistanceMeters,
  travelKm: visits.travelKm,
  travelNotes: visits.travelNotes,
  surveyCompletedAt: visits.surveyCompletedAt,
  createdByMembershipId: visits.createdByMembershipId,
  createdAt: visits.createdAt,
  updatedAt: visits.updatedAt,
} as const;

interface VisitSelectRow {
  id: string;
  leadId: string;
  leadName: string | null;
  leadPhone: string | null;
  status: string;
  scheduledAt: Date;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  siteLat: string | null;
  siteLng: string | null;
  assignedMembershipId: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
  checkInAt: Date | null;
  checkInLat: string | null;
  checkInLng: string | null;
  checkInAccuracyM: string | null;
  checkOutAt: Date | null;
  checkOutLat: string | null;
  checkOutLng: string | null;
  checkOutAccuracyM: string | null;
  gpsDistanceMeters: string | null;
  travelKm: string | null;
  travelNotes: string | null;
  surveyCompletedAt: Date | null;
  createdByMembershipId: string;
  createdAt: Date;
  updatedAt: Date;
}

function toVisitView(row: VisitSelectRow): VisitView {
  return {
    id: row.id,
    leadId: row.leadId,
    leadName: row.leadName,
    leadPhone: row.leadPhone,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    addressLine: row.addressLine,
    city: row.city,
    state: row.state,
    postalCode: row.postalCode,
    country: row.country,
    siteLat: num(row.siteLat),
    siteLng: num(row.siteLng),
    assignee:
      row.assignedMembershipId && row.assigneeEmail
        ? {
            membershipId: row.assignedMembershipId,
            name: row.assigneeName,
            email: row.assigneeEmail,
          }
        : null,
    checkInAt: row.checkInAt ? row.checkInAt.toISOString() : null,
    checkInLat: num(row.checkInLat),
    checkInLng: num(row.checkInLng),
    checkInAccuracyM: num(row.checkInAccuracyM),
    checkOutAt: row.checkOutAt ? row.checkOutAt.toISOString() : null,
    checkOutLat: num(row.checkOutLat),
    checkOutLng: num(row.checkOutLng),
    checkOutAccuracyM: num(row.checkOutAccuracyM),
    gpsDistanceMeters: num(row.gpsDistanceMeters),
    travelKm: num(row.travelKm),
    travelNotes: row.travelNotes,
    surveyCompletedAt: row.surveyCompletedAt ? row.surveyCompletedAt.toISOString() : null,
    createdByMembershipId: row.createdByMembershipId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assigneeJoin(tx: Tx) {
  return tx
    .select(visitSelect)
    .from(visits)
    .innerJoin(leads, eq(leads.id, visits.leadId))
    .leftJoin(userTenantMemberships, eq(userTenantMemberships.id, visits.assignedMembershipId))
    .leftJoin(users, eq(users.id, userTenantMemberships.userId));
}

export async function loadVisitView(
  tx: Tx,
  tenantId: string,
  visitId: string,
): Promise<VisitView | undefined> {
  const [row] = await assigneeJoin(tx).where(
    and(eq(visits.tenantId, tenantId), eq(visits.id, visitId)),
  );
  return row ? toVisitView(row) : undefined;
}

export async function listVisits(
  tx: Tx,
  tenantId: string,
  filter: ListVisitsFilter,
): Promise<ListVisitsResult> {
  const conditions = [eq(visits.tenantId, tenantId)];
  if (filter.status) {
    conditions.push(eq(visits.status, filter.status as (typeof visits.status.enumValues)[number]));
  }
  if (filter.leadId) conditions.push(eq(visits.leadId, filter.leadId));
  if (filter.assignedMembershipId) {
    conditions.push(eq(visits.assignedMembershipId, filter.assignedMembershipId));
  }
  if (filter.today) {
    conditions.push(sql`${visits.scheduledAt}::date = now()::date`);
  }
  const where = and(...conditions);

  const [countRow] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(visits)
    .where(where);
  const count = countRow?.count ?? 0;

  const page = Math.max(1, filter.page);
  const pageSize = Math.min(Math.max(1, filter.pageSize), 100);

  const rows = await assigneeJoin(tx)
    .where(where)
    .orderBy(asc(visits.scheduledAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { items: rows.map(toVisitView), total: count, page, pageSize };
}

export async function visitExists(tx: Tx, tenantId: string, visitId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: visits.id })
    .from(visits)
    .where(and(eq(visits.tenantId, tenantId), eq(visits.id, visitId)))
    .limit(1);
  return !!row;
}
