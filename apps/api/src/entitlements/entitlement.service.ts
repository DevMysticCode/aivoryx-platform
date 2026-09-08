import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import {
  AppError,
  getModule,
  isModuleKey,
  MODULE_DEFINITIONS,
  validateDisable,
  validateEnable,
  type ModuleKey,
} from '@aivoryx/shared';
import { AuditService } from '../audit/audit.service.js';

const { tenantModuleEntitlements } = schema;

export interface TenantScopeLike {
  tenantId: string;
  userId: string;
  actorMembershipId?: string;
}

export interface ModuleEntitlementView {
  moduleKey: ModuleKey;
  state: 'ENABLED' | 'DISABLED';
  enabledAt: string | null;
  disabledAt: string | null;
  provisionedByUserId: string | null;
  note: string | null;
}

/**
 * The platform-owned entitlement boundary (Phase 13, ADR 0042).
 *
 * A tenant may use a module only if it has an `ENABLED` row in
 * `tenant_module_entitlements`. This service is the single place that answers
 * "does this tenant have this module?" — never an ad-hoc check in a controller.
 * The module catalogue itself is code (`@aivoryx/shared`), so this service has
 * zero dependency on any business module.
 *
 * The write path (`setEntitlement`) is only reachable from the platform-admin
 * API. It deliberately enters the TARGET tenant's RLS context to write that
 * tenant's row — never an owner connection, never a client-supplied tenant id.
 */
@Injectable()
export class EntitlementService {
  constructor(private readonly audit: AuditService) {}

  /** The set of module keys currently `ENABLED` for a tenant. */
  async getEnabledModules(scope: TenantScopeLike): Promise<Set<ModuleKey>> {
    const rows = await withTenantContext(getDb(), scope, (tx) =>
      this.readEnabled(tx, scope.tenantId),
    );
    return new Set(rows);
  }

  async hasModule(scope: TenantScopeLike, moduleKey: ModuleKey): Promise<boolean> {
    return (await this.getEnabledModules(scope)).has(moduleKey);
  }

  /** Throw `ENTITLEMENT_MODULE_NOT_ENABLED` unless the tenant has the module. */
  async requireModule(scope: TenantScopeLike, moduleKey: ModuleKey): Promise<void> {
    if (!(await this.hasModule(scope, moduleKey))) {
      throw new AppError('ENTITLEMENT_MODULE_NOT_ENABLED', { details: { module: moduleKey } });
    }
  }

  /**
   * Every module in the catalogue with its entitlement state for a tenant
   * (DISABLED where there is no row). For the platform provisioning UI.
   */
  async listForTenant(scope: TenantScopeLike): Promise<ModuleEntitlementView[]> {
    const rows = await withTenantContext(getDb(), scope, (tx) =>
      tx
        .select()
        .from(tenantModuleEntitlements)
        .where(eq(tenantModuleEntitlements.tenantId, scope.tenantId)),
    );
    const byKey = new Map(rows.map((r) => [r.moduleKey, r]));
    return MODULE_DEFINITIONS.map((m) => {
      const row = byKey.get(m.key);
      return {
        moduleKey: m.key,
        state: (row?.state ?? 'DISABLED') as 'ENABLED' | 'DISABLED',
        enabledAt: row?.enabledAt?.toISOString() ?? null,
        disabledAt: row?.disabledAt?.toISOString() ?? null,
        provisionedByUserId: row?.provisionedByUserId ?? null,
        note: row?.note ?? null,
      };
    });
  }

  /**
   * Enable or disable a module for a tenant, enforcing dependency rules
   * (ADR 0042 §4): enabling requires every dependency enabled; disabling is
   * rejected if an enabled module still depends on it. Rejection over cascade.
   *
   * `platformUserId` is the authenticated platform-admin user (already gated by
   * the platform-admin guard). Audited under the target tenant.
   */
  async setEntitlement(input: {
    platformUserId: string;
    tenantId: string;
    moduleKey: ModuleKey;
    state: 'ENABLED' | 'DISABLED';
    note?: string | null;
  }): Promise<ModuleEntitlementView[]> {
    getModule(input.moduleKey); // throws on unknown key

    await withTenantContext(
      getDb(),
      { tenantId: input.tenantId, userId: input.platformUserId },
      async (tx) => {
        const current = await this.readEnabled(tx, input.tenantId);
        const currentlyEnabled = current.includes(input.moduleKey);

        if (input.state === 'ENABLED' && !currentlyEnabled) {
          const check = validateEnable(input.moduleKey, current);
          if (!check.ok) {
            throw new AppError('ENTITLEMENT_DEPENDENCY_UNMET', {
              details: { module: input.moduleKey, missing: check.missingDependencies },
            });
          }
        }
        if (input.state === 'DISABLED' && currentlyEnabled) {
          const check = validateDisable(input.moduleKey, current);
          if (!check.ok) {
            throw new AppError('ENTITLEMENT_DEPENDANT_ENABLED', {
              details: { module: input.moduleKey, dependants: check.blockingDependants },
            });
          }
        }

        const now = new Date();
        await tx
          .insert(tenantModuleEntitlements)
          .values({
            tenantId: input.tenantId,
            moduleKey: input.moduleKey,
            state: input.state,
            enabledAt: input.state === 'ENABLED' ? now : null,
            disabledAt: input.state === 'DISABLED' ? now : null,
            provisionedByUserId: input.platformUserId,
            note: input.note ?? null,
          })
          .onConflictDoUpdate({
            target: [tenantModuleEntitlements.tenantId, tenantModuleEntitlements.moduleKey],
            set: {
              state: input.state,
              enabledAt: input.state === 'ENABLED' ? now : tenantModuleEntitlements.enabledAt,
              disabledAt: input.state === 'DISABLED' ? now : tenantModuleEntitlements.disabledAt,
              provisionedByUserId: input.platformUserId,
              note: input.note ?? null,
              updatedAt: now,
            },
          });

        await this.audit.record(tx, {
          tenantId: input.tenantId,
          action:
            input.state === 'ENABLED' ? 'platform.module.enabled' : 'platform.module.disabled',
          entityType: 'tenant_module_entitlement',
          entityId: input.tenantId,
          actor: { type: 'SYSTEM', source: 'platform-admin' },
          metadata: { module: input.moduleKey, platformUserId: input.platformUserId },
        });
      },
    );

    return this.listForTenant({ tenantId: input.tenantId, userId: input.platformUserId });
  }

  /**
   * The `ENABLED` module keys for one tenant. The `tenant_id` predicate is
   * explicit and NOT left to RLS: the additive `*_platform_read` SELECT policy
   * (migration 0017) is deliberately not tenant-scoped, so a platform admin (or
   * a user who is also a platform admin) reading through RLS alone would see
   * every tenant's rows. Tenant scoping is enforced here in the query, per
   * CLAUDE.md §5 — RLS is the backstop, not the only guard.
   */
  private async readEnabled(tx: Tx, tenantId: string): Promise<ModuleKey[]> {
    const rows = await tx
      .select({ moduleKey: tenantModuleEntitlements.moduleKey })
      .from(tenantModuleEntitlements)
      .where(
        and(
          eq(tenantModuleEntitlements.tenantId, tenantId),
          eq(tenantModuleEntitlements.state, 'ENABLED'),
        ),
      );
    return rows.map((r) => r.moduleKey).filter(isModuleKey);
  }
}
