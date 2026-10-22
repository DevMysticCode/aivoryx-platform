import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext, withUserContext } from '@aivoryx/db';
import {
  AppError,
  MODULE_DEFINITIONS,
  isModuleKey,
  type ModuleKey,
  type TenantStatus,
} from '@aivoryx/shared';
import { EntitlementService } from '../entitlements/entitlement.service.js';
import { CompanyProfileService } from '../settings/company-profile.service.js';

const {
  tenants,
  userTenantMemberships,
  tenantModuleEntitlements,
  tenantSubscriptions,
  tenantInvitations,
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

export interface ListPlatformTenantsFilter {
  q?: string;
  status?: TenantStatus;
  sort?: 'name' | 'members' | 'modules' | 'created';
  page?: number;
  pageSize?: number;
}

export interface PlatformTenantListResult {
  items: PlatformTenantSummary[];
  total: number;
  page: number;
  pageSize: number;
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
export interface PlatformTenantReadinessStep {
  key:
    | 'tenant_created'
    | 'company_profile'
    | 'modules_configured'
    | 'admin_assigned'
    | 'access_verified';
  title: string;
  done: boolean;
}

export interface PlatformTenantReadiness {
  steps: PlatformTenantReadinessStep[];
  complete: boolean;
}

@Injectable()
export class PlatformService {
  constructor(
    private readonly entitlements: EntitlementService,
    private readonly companyProfiles: CompanyProfileService,
  ) {}

  /**
   * Server-side paginated/searchable/filterable tenant list (Platform Tenant Management
   * Scalability milestone). Member/module counts come from two one-row-per-tenant CTEs
   * left-joined into the main query, not a correlated subquery per row and not the old
   * separate batched `inArray` pass — sorting by `members`/`modules` needs the counts
   * available to `ORDER BY` before `LIMIT`/`OFFSET`, which only a join (not a JS sort) can
   * do once the result is paginated. Still exactly two extra queries total (as CTEs), same
   * as the old batched approach, regardless of page size.
   */
  async listTenants(
    platformUserId: string,
    filter: ListPlatformTenantsFilter = {},
  ): Promise<PlatformTenantListResult> {
    return withUserContext(getDb(), platformUserId, async (tx) => {
      const conditions: SQL[] = [];
      if (filter.status) conditions.push(eq(tenants.status, filter.status));
      if (filter.q && filter.q.trim().length > 0) {
        const like = `%${filter.q.trim()}%`;
        conditions.push(or(ilike(tenants.name, like), ilike(tenants.slug, like))!);
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(tenants)
        .where(where);
      const total = countRow?.count ?? 0;

      const page = Math.max(1, filter.page ?? 1);
      const pageSize = Math.min(Math.max(1, filter.pageSize ?? 20), 100);

      const memberCounts = tx.$with('platform_tenant_member_counts').as(
        tx
          .select({ tenantId: userTenantMemberships.tenantId, n: sql`count(*)::int`.as('n') })
          .from(userTenantMemberships)
          .groupBy(userTenantMemberships.tenantId),
      );
      const moduleCounts = tx.$with('platform_tenant_module_counts').as(
        tx
          .select({ tenantId: tenantModuleEntitlements.tenantId, n: sql`count(*)::int`.as('n') })
          .from(tenantModuleEntitlements)
          .where(eq(tenantModuleEntitlements.state, 'ENABLED'))
          .groupBy(tenantModuleEntitlements.tenantId),
      );
      const memberCount = sql<number>`coalesce(${memberCounts}.${memberCounts.n}, 0)`;
      const enabledModuleCount = sql<number>`coalesce(${moduleCounts}.${moduleCounts.n}, 0)`;

      // Deterministic tie-break (`id`) on every sort so rows never shift between pages.
      const orderBy =
        filter.sort === 'members'
          ? [desc(memberCount), asc(tenants.name), asc(tenants.id)]
          : filter.sort === 'modules'
            ? [desc(enabledModuleCount), asc(tenants.name), asc(tenants.id)]
            : filter.sort === 'created'
              ? [desc(tenants.createdAt), asc(tenants.id)]
              : [asc(tenants.name), asc(tenants.id)];

      const rows =
        total === 0
          ? []
          : await tx
              .with(memberCounts, moduleCounts)
              .select({
                id: tenants.id,
                slug: tenants.slug,
                name: tenants.name,
                status: tenants.status,
                createdAt: tenants.createdAt,
                memberCount,
                enabledModuleCount,
              })
              .from(tenants)
              .leftJoin(memberCounts, eq(memberCounts.tenantId, tenants.id))
              .leftJoin(moduleCounts, eq(moduleCounts.tenantId, tenants.id))
              .where(where)
              .orderBy(...orderBy)
              .limit(pageSize)
              .offset((page - 1) * pageSize);

      return {
        items: rows.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
        total,
        page,
        pageSize,
      };
    });
  }

  /** Total + active tenant counts only, for {@link overview} — no row fetch. */
  async countTenantsByStatus(platformUserId: string): Promise<{ total: number; active: number }> {
    return withUserContext(getDb(), platformUserId, async (tx) => {
      const [row] = await tx
        .select({
          total: sql<number>`count(*)::int`,
          active: sql<number>`count(*) filter (where ${tenants.status} = 'active')::int`,
        })
        .from(tenants);
      return { total: row?.total ?? 0, active: row?.active ?? 0 };
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

  /**
   * Platform-admin-facing onboarding/release-readiness checklist for one workspace (Client
   * Onboarding & Release Readiness milestone). Entirely DERIVED from data that already exists —
   * no new table, no workflow engine, same convention `OnboardingService.get()` already uses for
   * the tenant-side checklist. This is the platform admin's own view of the same underlying
   * facts: has the invited admin accepted, is the company profile filled in, etc. — information
   * the tenant list/detail views don't currently surface at all.
   */
  async readiness(platformUserId: string, tenantId: string): Promise<PlatformTenantReadiness> {
    // ensure the tenant exists / is visible to this platform admin, and get its module state
    const detail = await this.getTenant(platformUserId, tenantId);

    return withTenantContext(getDb(), { tenantId, userId: platformUserId }, async (tx) => {
      // Same definition of "company profile completed" as the tenant's own onboarding
      // checklist (`OnboardingService`) — display name, an address, and an email or phone.
      const profile = await this.companyProfiles.loadProfile(tx, tenantId);
      const profileDone = !!(
        profile?.displayName?.trim() &&
        profile.addressLine?.trim() &&
        (profile.email?.trim() || profile.phone?.trim())
      );

      // The only way a membership is created today is via invitation (see InvitationService) —
      // the very first one, created in the same request as tenant creation, is the admin invite.
      const [invitationRow] = await tx
        .select({ status: tenantInvitations.status })
        .from(tenantInvitations)
        .where(eq(tenantInvitations.tenantId, tenantId))
        .orderBy(tenantInvitations.createdAt)
        .limit(1);

      const [activeMemberRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(userTenantMemberships)
        .where(
          and(
            eq(userTenantMemberships.tenantId, tenantId),
            eq(userTenantMemberships.status, 'active'),
          ),
        );

      const steps: PlatformTenantReadinessStep[] = [
        { key: 'tenant_created', title: 'Tenant created', done: true },
        { key: 'company_profile', title: 'Company profile completed', done: profileDone },
        {
          key: 'modules_configured',
          title: 'Modules configured',
          done: detail.enabledModuleCount > 0,
        },
        {
          key: 'admin_assigned',
          title: 'Initial tenant administrator assigned',
          done: !!invitationRow,
        },
        {
          key: 'access_verified',
          title: 'Initial access verified',
          done: (activeMemberRow?.n ?? 0) > 0,
        },
      ];

      return { steps, complete: steps.every((s) => s.done) };
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
