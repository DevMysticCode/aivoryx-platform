import { Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext, withUserContext } from '@aivoryx/db';
import {
  AppError,
  MODULE_DEFINITIONS,
  isModuleKey,
  type ModuleKey,
  type TenantStatus,
} from '@aivoryx/shared';
import { EntitlementService } from '../entitlements/entitlement.service.js';

const {
  tenants,
  userTenantMemberships,
  tenantModuleEntitlements,
  tenantSubscriptions,
  leads,
  projects,
  invoices,
  employees,
} = schema;

export interface TenantUsage {
  members: number;
  leads: number | null;
  projects: number | null;
  invoices: number | null;
  employees: number | null;
  enabledModules: number;
}

export interface PlatformTenantSummary {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  memberCount: number;
  enabledModuleCount: number;
  createdAt: string;
}

export interface PlatformTenantDetail extends PlatformTenantSummary {
  modules: {
    key: ModuleKey;
    displayName: string;
    description: string;
    capabilitySummary: string;
    category: string;
    order: number;
    dependencies: ModuleKey[];
    state: 'ENABLED' | 'DISABLED';
    enabledAt: string | null;
    disabledAt: string | null;
    provisionedByUserId: string | null;
  }[];
  /** null when the tenant has no subscription row yet (pre-Phase-14 tenants) */
  subscription: { planKey: string; status: string; startedAt: string } | null;
}

/**
 * Aivoryx platform administration (Phase 13, ADR 0042). Operates ABOVE every
 * tenant: a platform admin manages workspaces and their module entitlements and
 * is not, by virtue of that, a tenant business user.
 *
 * Reads run with only `app.user_id` bound (no tenant). The additive
 * `*_platform_read` RLS policies (migration 0017) let a `platform_admins` row
 * SELECT — never write — workspace and membership rows across tenants.
 * Entitlement writes go through {@link EntitlementService}, which scopes each
 * write to the target tenant's RLS context.
 *
 * This service depends only on `@aivoryx/db`, `@aivoryx/shared` and the platform
 * `EntitlementService` — never a business module.
 */
@Injectable()
export class PlatformService {
  constructor(private readonly entitlements: EntitlementService) {}

  async listTenants(platformUserId: string): Promise<PlatformTenantSummary[]> {
    return withUserContext(getDb(), platformUserId, async (tx) => {
      const tenantRows = await tx
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          status: tenants.status,
          createdAt: tenants.createdAt,
        })
        .from(tenants)
        .orderBy(tenants.name);
      if (tenantRows.length === 0) return [];
      const ids = tenantRows.map((t) => t.id);

      const memberCounts = await tx
        .select({
          tenantId: userTenantMemberships.tenantId,
          n: sql<number>`count(*)::int`,
        })
        .from(userTenantMemberships)
        .where(inArray(userTenantMemberships.tenantId, ids))
        .groupBy(userTenantMemberships.tenantId);
      const moduleCounts = await tx
        .select({
          tenantId: tenantModuleEntitlements.tenantId,
          n: sql<number>`count(*)::int`,
        })
        .from(tenantModuleEntitlements)
        .where(
          sql`${inArray(tenantModuleEntitlements.tenantId, ids)} and ${eq(tenantModuleEntitlements.state, 'ENABLED')}`,
        )
        .groupBy(tenantModuleEntitlements.tenantId);
      const memberBy = new Map(memberCounts.map((m) => [m.tenantId, m.n]));
      const moduleBy = new Map(moduleCounts.map((m) => [m.tenantId, m.n]));

      return tenantRows.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        status: t.status,
        memberCount: memberBy.get(t.id) ?? 0,
        enabledModuleCount: moduleBy.get(t.id) ?? 0,
        createdAt: t.createdAt.toISOString(),
      }));
    });
  }

  async getTenant(platformUserId: string, tenantId: string): Promise<PlatformTenantDetail> {
    const row = await withUserContext(getDb(), platformUserId, async (tx) => {
      const [t] = await tx
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          status: tenants.status,
          createdAt: tenants.createdAt,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      if (!t) return null;
      const [mc] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(userTenantMemberships)
        .where(eq(userTenantMemberships.tenantId, tenantId));
      const [sub] = await tx
        .select({
          planKey: tenantSubscriptions.planKey,
          status: tenantSubscriptions.status,
          startedAt: tenantSubscriptions.startedAt,
        })
        .from(tenantSubscriptions)
        .where(eq(tenantSubscriptions.tenantId, tenantId))
        .limit(1);
      return { ...t, memberCount: mc?.n ?? 0, subscription: sub ?? null };
    });
    if (!row) throw new AppError('PLATFORM_TENANT_NOT_FOUND');

    const entitlements = await this.entitlements.listForTenant({
      tenantId,
      userId: platformUserId,
    });
    const byKey = new Map(entitlements.map((e) => [e.moduleKey, e]));

    const modules = MODULE_DEFINITIONS.map((m) => {
      const e = byKey.get(m.key)!;
      return {
        key: m.key,
        displayName: m.displayName,
        description: m.description,
        capabilitySummary: m.capabilitySummary,
        category: m.category,
        order: m.order,
        dependencies: [...m.dependencies],
        state: e.state,
        enabledAt: e.enabledAt,
        disabledAt: e.disabledAt,
        provisionedByUserId: e.provisionedByUserId,
      };
    });

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      memberCount: row.memberCount,
      enabledModuleCount: modules.filter((m) => m.state === 'ENABLED').length,
      createdAt: row.createdAt.toISOString(),
      modules,
      subscription: row.subscription
        ? {
            planKey: row.subscription.planKey,
            status: row.subscription.status,
            startedAt: row.subscription.startedAt.toISOString(),
          }
        : null,
    };
  }

  /**
   * Basic, efficiently-computed tenant usage (Phase 14 §31-32) — counts only,
   * from data that already exists. A metric is `null` (not 0) when its module
   * isn't enabled for the tenant, so the UI never implies a capability the
   * tenant doesn't have. Storage usage is deliberately omitted: there is no
   * real usage-tracking infrastructure to source it from yet (documented as
   * deferred rather than fabricated).
   */
  async usage(platformUserId: string, tenantId: string): Promise<TenantUsage> {
    // ensure the tenant exists / is visible to this platform admin, and get
    // its enabled modules
    const detail = await this.getTenant(platformUserId, tenantId);
    const enabled = new Set(detail.modules.filter((m) => m.state === 'ENABLED').map((m) => m.key));

    return withTenantContext(getDb(), { tenantId, userId: platformUserId }, async (tx) => {
      const [leadCount] = enabled.has('CRM')
        ? await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(leads)
            .where(eq(leads.tenantId, tenantId))
        : [];
      const [projectCount] =
        enabled.has('SUPPLY') || enabled.has('EPC')
          ? await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(projects)
              .where(eq(projects.tenantId, tenantId))
          : [];
      const [invoiceCount] = enabled.has('FINANCE')
        ? await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(invoices)
            .where(eq(invoices.tenantId, tenantId))
        : [];
      const [employeeCount] = enabled.has('HR')
        ? await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(employees)
            .where(eq(employees.tenantId, tenantId))
        : [];

      return {
        members: detail.memberCount,
        leads: enabled.has('CRM') ? (leadCount?.n ?? 0) : null,
        projects: enabled.has('SUPPLY') || enabled.has('EPC') ? (projectCount?.n ?? 0) : null,
        invoices: enabled.has('FINANCE') ? (invoiceCount?.n ?? 0) : null,
        employees: enabled.has('HR') ? (employeeCount?.n ?? 0) : null,
        enabledModules: detail.enabledModuleCount,
      };
    });
  }

  async setModule(input: {
    platformUserId: string;
    tenantId: string;
    moduleKey: string;
    state: 'ENABLED' | 'DISABLED';
    note?: string | null;
  }): Promise<PlatformTenantDetail> {
    if (!isModuleKey(input.moduleKey)) {
      throw new AppError('ENTITLEMENT_UNKNOWN_MODULE', { details: { module: input.moduleKey } });
    }
    // ensure the tenant exists / is visible to this platform admin
    await this.getTenant(input.platformUserId, input.tenantId);
    await this.entitlements.setEntitlement({
      platformUserId: input.platformUserId,
      tenantId: input.tenantId,
      moduleKey: input.moduleKey,
      state: input.state,
      note: input.note ?? null,
    });
    return this.getTenant(input.platformUserId, input.tenantId);
  }
}
