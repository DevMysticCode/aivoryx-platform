import { and, eq, sql } from 'drizzle-orm';
import { schema, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import type { SecurityContext } from '../security/security-context.js';

const { hrCounters, employees } = schema;

/**
 * HR & Workforce shared primitives (Phase 12, ADR 0041).
 *
 * HR is a bounded domain: it depends only on `@aivoryx/shared`, `@aivoryx/db`,
 * the platform security primitives, object storage, notifications, audit and
 * the outbox — never on CRM / Field / Supply / EPC / Finance implementation
 * internals. This file holds only HR-local helpers.
 */

/** Tenant + actor identity, always derived from the authenticated context. */
export interface HrScope {
  tenantId: string;
  userId: string;
  actorMembershipId: string;
}

export function hrScope(ctx: SecurityContext): HrScope {
  if (!ctx.tenantId || !ctx.membership) throw new AppError('AUTH_NO_ACTIVE_TENANT');
  return { tenantId: ctx.tenantId, userId: ctx.user.id, actorMembershipId: ctx.membership.id };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageBounds(page?: number, pageSize?: number): { page: number; pageSize: number } {
  return {
    page: Math.max(1, page ?? 1),
    pageSize: Math.min(Math.max(1, pageSize ?? 25), 100),
  };
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
export function isCheckViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23514';
}
export function isFkViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23503';
}

// ---- tenant-scoped HR numbering (mirrors finance/numbering) --------

export type HrCounterKind = 'employee' | 'leave_request' | 'expense_claim';

const DEFAULTS: Record<HrCounterKind, { prefix: string; padding: number }> = {
  employee: { prefix: 'EMP-', padding: 6 },
  leave_request: { prefix: 'LR-', padding: 6 },
  expense_claim: { prefix: 'EXP-', padding: 6 },
};

/** Reserve and return the next human number for `(tenant, kind)`. Must run
 *  inside a tenant-context transaction; the increment is a single atomic
 *  statement, so concurrent creates in the same tenant never collide. */
export async function nextHrNumber(tx: Tx, tenantId: string, kind: HrCounterKind): Promise<string> {
  const d = DEFAULTS[kind];
  await tx
    .insert(hrCounters)
    .values({ tenantId, kind, prefix: d.prefix, padding: d.padding, value: 0 })
    .onConflictDoNothing({ target: [hrCounters.tenantId, hrCounters.kind] });

  const [row] = await tx
    .update(hrCounters)
    .set({ value: sql`${hrCounters.value} + 1`, updatedAt: new Date() })
    .where(and(eq(hrCounters.tenantId, tenantId), eq(hrCounters.kind, kind)))
    .returning({ prefix: hrCounters.prefix, padding: hrCounters.padding, value: hrCounters.value });
  if (!row) throw new Error(`hr counter missing for ${kind}`);
  return `${row.prefix}${String(row.value).padStart(row.padding, '0')}`;
}

// ---- self-service identity resolution -----------------------------

/**
 * Resolve the employee linked to the caller's authenticated membership. NEVER
 * trusts a client-provided employeeId for self-service. Throws a safe error
 * when the account is not linked to an employee.
 */
export async function resolveMyEmployeeId(
  tx: Tx,
  tenantId: string,
  membershipId: string,
): Promise<string> {
  const [row] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.membershipId, membershipId)))
    .limit(1);
  if (!row) throw new AppError('HR_EMPLOYEE_NOT_LINKED');
  return row.id;
}

/** Optional variant — returns null instead of throwing. */
export async function findMyEmployeeId(
  tx: Tx,
  tenantId: string,
  membershipId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.tenantId, tenantId), eq(employees.membershipId, membershipId)))
    .limit(1);
  return row?.id ?? null;
}

// ---- GPS straight-line distance (reuses Phase 4 principles) --------

/** Haversine distance in metres between two lat/lng points. Straight-line only
 *  — NOT road/travel distance, and never proof of exact physical presence. */
export function gpsDistanceMeters(
  a: { lat: number; lng: number } | null,
  b: { lat: number; lng: number } | null,
): number | null {
  if (!a || !b) return null;
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}
