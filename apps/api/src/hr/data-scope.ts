import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { schema, type DataScope, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import type { HrScope } from './common.js';

const { employees, membershipRoles, roles } = schema;

/**
 * HR data scope (Phase 17). Enforces `membership_roles.data_scope` — already
 * stored and editable via the access UI (ADR 0042) — on HR's employee-facing
 * reads. No second authorization model: permissions still decide WHAT a caller
 * may do; the scope of their profile decides WHOSE records they may see.
 *
 *   OWN         — only their own employee record
 *   TEAM        — their own record + employees who report directly to them
 *   DEPARTMENT  — their own record + everyone in their department
 *   COMPANY     — everyone in the workspace (the default; also applies to a
 *                 member with no profile, e.g. TENANT_ADMIN)
 *
 * A caller with a narrowed scope who has no linked employee record sees nothing
 * (there is no "own team" to anchor to) — never everything.
 */

/** The caller's HR data scope: their profile's scope, or COMPANY when no profile
 *  is assigned. Mirrors `AccessService.effectiveAccess` and CRM analytics. */
export async function resolveHrDataScope(tx: Tx, scope: HrScope): Promise<DataScope> {
  const [row] = await tx
    .select({ dataScope: membershipRoles.dataScope })
    .from(membershipRoles)
    .innerJoin(roles, eq(roles.id, membershipRoles.roleId))
    .where(
      and(
        eq(membershipRoles.tenantId, scope.tenantId),
        eq(membershipRoles.membershipId, scope.actorMembershipId),
        eq(roles.kind, 'profile'),
      ),
    )
    .limit(1);
  return row?.dataScope ?? 'COMPANY';
}

/** A condition over `hr_employees` columns selecting the employees the caller may
 *  see, or `null` when unrestricted (COMPANY). */
export async function employeeScopeCondition(tx: Tx, scope: HrScope): Promise<SQL | null> {
  const dataScope = await resolveHrDataScope(tx, scope);
  if (dataScope === 'COMPANY') return null;

  const [me] = await tx
    .select({ id: employees.id, departmentId: employees.departmentId })
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, scope.tenantId),
        eq(employees.membershipId, scope.actorMembershipId),
      ),
    )
    .limit(1);
  if (!me) return sql`false`;

  if (dataScope === 'OWN') return eq(employees.id, me.id);
  if (dataScope === 'TEAM') return or(eq(employees.id, me.id), eq(employees.managerId, me.id))!;
  return me.departmentId
    ? or(eq(employees.id, me.id), eq(employees.departmentId, me.departmentId))!
    : eq(employees.id, me.id);
}

/** Restrict any table's `employee_id`-style column to the caller's visible
 *  employees. Returns `null` when unrestricted so callers can skip it. */
export async function employeeIdFilter(
  tx: Tx,
  scope: HrScope,
  column: AnyPgColumn,
): Promise<SQL | null> {
  const cond = await employeeScopeCondition(tx, scope);
  if (!cond) return null;
  return inArray(
    column,
    tx
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.tenantId, scope.tenantId), cond)),
  );
}

/** Throws a 404 (never a 403 — no existence leak) when the employee is outside
 *  the caller's scope. */
export async function assertEmployeeVisible(
  tx: Tx,
  scope: HrScope,
  employeeId: string,
): Promise<void> {
  const cond = await employeeScopeCondition(tx, scope);
  if (!cond) return;
  const [row] = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.tenantId, scope.tenantId), eq(employees.id, employeeId), cond))
    .limit(1);
  if (!row) throw new AppError('HR_EMPLOYEE_NOT_FOUND');
}
