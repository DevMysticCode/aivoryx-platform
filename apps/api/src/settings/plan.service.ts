import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { getPlan, getSolution, isPlanKey, MODULE_DEFINITIONS } from '@aivoryx/shared';
import type { TenantScope } from '../supply/common.js';
import type { TenantPlanDto } from './settings.dto.js';

const { tenantSubscriptions, tenantModuleEntitlements, leads, projects, invoices, employees } =
  schema;

/**
 * Tenant-facing plan/solution/usage summary (Phase 16 §9). Deliberately the
 * mirror of `PlatformService.getTenant`/`usage` (apps/api/src/platform/
 * platform.service.ts) but scoped to the CALLER'S OWN tenant via ordinary
 * `withTenantContext` (RLS-enforced) rather than the platform-admin's
 * cross-tenant `withUserContext` — a tenant admin must never reach the
 * platform-admin code path. Real counts only, no invented usage/limits.
 */
@Injectable()
export class PlanService {
  async get(scope: TenantScope): Promise<TenantPlanDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [sub] = await tx
        .select({
          planKey: tenantSubscriptions.planKey,
          status: tenantSubscriptions.status,
          startedAt: tenantSubscriptions.startedAt,
          renewsAt: tenantSubscriptions.renewsAt,
        })
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, scope.tenantId))
        .limit(1);

      const plan = sub && isPlanKey(sub.planKey) ? getPlan(sub.planKey) : null;
      const solution = plan ? getSolution(plan.solutionKey) : null;

      const entitlementRows = await tx
        .select({ moduleKey: tenantModuleEntitlements.moduleKey })
        .from(tenantModuleEntitlements)
        .where(
          and(
            eq(tenantModuleEntitlements.tenantId, scope.tenantId),
            eq(tenantModuleEntitlements.state, 'ENABLED'),
          ),
        );
      const enabled = new Set(entitlementRows.map((r) => r.moduleKey));
      const enabledModules = MODULE_DEFINITIONS.filter((m) => enabled.has(m.key)).map((m) => ({
        key: m.key,
        displayName: m.displayName,
      }));

      const [leadCount] = enabled.has('CRM')
        ? await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(leads)
            .where(eq(leads.tenantId, scope.tenantId))
        : [];
      const [projectCount] =
        enabled.has('SUPPLY') || enabled.has('EPC')
          ? await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(projects)
              .where(eq(projects.tenantId, scope.tenantId))
          : [];
      const [invoiceCount] = enabled.has('FINANCE')
        ? await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(invoices)
            .where(eq(invoices.tenantId, scope.tenantId))
        : [];
      const [employeeCount] = enabled.has('HR')
        ? await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(employees)
            .where(eq(employees.tenantId, scope.tenantId))
        : [];

      return {
        solutionName: solution?.displayName ?? null,
        planName: plan?.displayName ?? null,
        subscriptionStatus: sub?.status ?? null,
        subscriptionStartedAt: sub?.startedAt?.toISOString() ?? null,
        subscriptionRenewsAt: sub?.renewsAt?.toISOString() ?? null,
        enabledModules,
        usage: {
          leads: enabled.has('CRM') ? (leadCount?.n ?? 0) : null,
          projects: enabled.has('SUPPLY') || enabled.has('EPC') ? (projectCount?.n ?? 0) : null,
          invoices: enabled.has('FINANCE') ? (invoiceCount?.n ?? 0) : null,
          employees: enabled.has('HR') ? (employeeCount?.n ?? 0) : null,
        },
      };
    });
  }
}
