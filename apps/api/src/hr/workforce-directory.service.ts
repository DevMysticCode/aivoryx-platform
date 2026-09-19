import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { HrScope } from './common.js';
import { employeeScopeCondition } from './data-scope.js';

const { employees } = schema;

/** The minimum another module may know about an employee: who they are, not
 *  their employment, compensation or personal details. */
export interface LinkedEmployeeRef {
  id: string;
  displayName: string;
  employeeNumber: string;
  status: string;
}

/**
 * HR's narrow, read-only capability for OTHER modules (Phase 17): "which employee
 * record, if any, belongs to this login?". HR owns employee identity; other
 * modules (Field today) hold only a `membershipId` and ask HR — they never read
 * HR tables and never duplicate employee data.
 *
 * Callers must only use it after confirming the tenant is entitled to HR and the
 * caller holds `hr.employee.read`; the lookup additionally honours the caller's
 * HR data scope, so an out-of-scope employee is simply "not linked" to them.
 */
@Injectable()
export class WorkforceDirectoryService {
  async linkedByMembership(
    scope: HrScope,
    membershipIds: string[],
  ): Promise<Map<string, LinkedEmployeeRef>> {
    const out = new Map<string, LinkedEmployeeRef>();
    if (membershipIds.length === 0) return out;
    return withTenantContext(getDb(), scope, async (tx) => {
      const scopeCond = await employeeScopeCondition(tx, scope);
      const rows = await tx
        .select({
          id: employees.id,
          membershipId: employees.membershipId,
          displayName: employees.displayName,
          employeeNumber: employees.employeeNumber,
          status: employees.status,
        })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, scope.tenantId),
            inArray(employees.membershipId, membershipIds),
            scopeCond ?? undefined,
          ),
        );
      for (const r of rows) {
        if (r.membershipId) {
          out.set(r.membershipId, {
            id: r.id,
            displayName: r.displayName,
            employeeNumber: r.employeeNumber,
            status: r.status,
          });
        }
      }
      return out;
    });
  }
}
