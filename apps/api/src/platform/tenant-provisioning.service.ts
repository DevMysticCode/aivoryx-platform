import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  getDb,
  newUuidV7,
  schema,
  withTenantContext,
  provisionTenantAdmin,
  type Tx,
} from '@aivoryx/db';
import {
  AppError,
  PLAN_DEFINITIONS,
  PLATFORM_ROLE_KEYS,
  canTransitionTenantStatus,
  getPlan,
  getSolution,
  isModuleKey,
  isPlanKey,
  isSolutionKey,
  isTenantStatus,
  validateModuleSet,
  type ModuleKey,
  type PlanKey,
  type SolutionKey,
  type TenantStatus,
} from '@aivoryx/shared';
import { AuditService } from '../audit/audit.service.js';
import { InvitationService } from '../admin/invitation.service.js';
import { PlatformService, type PlatformTenantDetail } from './platform.service.js';

const { tenants, tenantSubscriptions } = schema;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** Generic URL-safe slug from a display name — lowercase, hyphenated, ASCII only. */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'company';
}

export interface CreateTenantInput {
  platformUserId: string;
  name: string;
  primaryContactName?: string;
  timezone?: string;
  currency?: string;
  solutionKey: string;
  /** override the solution's recommended modules; must still be dependency-consistent */
  moduleKeys?: string[];
  /** defaults to the first plan mapped to `solutionKey` */
  planKey?: string;
  adminEmail: string;
  adminName?: string;
}

export interface CreateTenantResult {
  tenant: PlatformTenantDetail;
  invitation: { membershipId: string; invitationId: string; token: string; expiresAt: string };
}

/**
 * Platform-admin tenant provisioning (Phase 14 §15-19) — the only place a
 * tenant is created outside a seed script. Deliberately depends on nothing
 * but `@aivoryx/db`, `@aivoryx/shared`'s code-defined solution/plan
 * catalogues, `AuditService` and `InvitationService` (identity, not a
 * business module) — never CRM/HR/Field/Finance/EPC/Supply internals (§39).
 *
 * A solution is only ever a RECOMMENDATION of which modules to enable; the
 * platform admin may adjust the set (still dependency-checked), and the
 * authoritative technical truth after this call is, as always,
 * `tenant_module_entitlements` — never the solution/plan key itself.
 *
 * Not a single ACID transaction end-to-end (`provisionTenantAdmin` and
 * `InvitationService.create` each own their own transaction) — see
 * `docs/architecture/PRODUCT-UX.md` Phase 14 for the documented limitation
 * and the idempotency mechanism (deterministic slug + its unique constraint)
 * that makes a retried identical request fail closed rather than duplicate.
 */
@Injectable()
export class TenantProvisioningService {
  constructor(
    private readonly audit: AuditService,
    private readonly invitations: InvitationService,
    private readonly platform: PlatformService,
  ) {}

  async createTenant(input: CreateTenantInput): Promise<CreateTenantResult> {
    if (!isSolutionKey(input.solutionKey)) {
      throw new AppError('PLATFORM_UNKNOWN_SOLUTION', { details: { solution: input.solutionKey } });
    }
    const solution = getSolution(input.solutionKey as SolutionKey);

    const moduleKeys = (input.moduleKeys ?? solution.moduleKeys) as ModuleKey[];
    if (!moduleKeys.every(isModuleKey)) {
      throw new AppError('PLATFORM_TENANT_INVALID_MODULES', { details: { moduleKeys } });
    }
    const moduleCheck = validateModuleSet(moduleKeys);
    if (!moduleCheck.ok) {
      throw new AppError('PLATFORM_TENANT_INVALID_MODULES', {
        details: { unmet: moduleCheck.unmet },
      });
    }

    let planKey: PlanKey;
    if (input.planKey !== undefined) {
      if (!isPlanKey(input.planKey)) {
        throw new AppError('PLATFORM_UNKNOWN_PLAN', { details: { plan: input.planKey } });
      }
      planKey = input.planKey;
    } else {
      const defaultPlan = PLAN_DEFINITIONS.find((p) => p.solutionKey === solution.key);
      if (!defaultPlan) {
        throw new AppError('PLATFORM_UNKNOWN_PLAN', { details: { solution: solution.key } });
      }
      planKey = defaultPlan.key as PlanKey;
    }
    getPlan(planKey); // throws if somehow inconsistent

    const name = input.name.trim();
    if (!name) throw new AppError('VALIDATION_ERROR', { details: { field: 'name' } });

    // Idempotency (§46): the slug is derived deterministically from the name,
    // with no retry-with-suffix fallback. A retried identical request MUST
    // collide on the exact same slug and fail closed with
    // PLATFORM_TENANT_SLUG_TAKEN — silently trying a suffixed slug instead
    // would turn a network-retry into a duplicate tenant, which is exactly
    // what this must not do. A genuinely different company that happens to
    // share a display name is expected to pick a distinguishing name (the
    // slug is derived, not chosen), or the platform admin can be asked to
    // pass a more specific name — no suffix guessing on the server's behalf.
    const usedSlug = slugify(name);
    // `tenants` carries its own RLS (`tenants_visibility`, migration 0003):
    // `WITH CHECK (id = app.tenant_id)`. There is no INSERT-specific policy,
    // so a plain app-role insert is only permitted when the row's own id is
    // already bound as the tenant context — the id is generated here (not
    // server-default) precisely so that context can be set before the insert.
    const tenantId = newUuidV7();
    try {
      await withTenantContext(
        getDb(),
        { tenantId, userId: input.platformUserId },
        async (tx: Tx) => {
          await tx
            .insert(tenants)
            .values({ id: tenantId, slug: usedSlug, name, status: 'provisioning' });
        },
      );
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      throw new AppError('PLATFORM_TENANT_SLUG_TAKEN', { details: { slug: usedSlug } });
    }

    // Modules + the generic TENANT_ADMIN role (full permission catalogue,
    // entitlement-gated at request time — same mechanism every tenant uses).
    await provisionTenantAdmin(getDb(), {
      tenantId,
      actingUserId: input.platformUserId,
      moduleKeys,
    });

    await withTenantContext(getDb(), { tenantId, userId: input.platformUserId }, async (tx: Tx) => {
      await tx.insert(tenantSubscriptions).values({ tenantId, planKey, status: 'active' });
      await this.audit.record(tx, {
        tenantId,
        action: 'platform.tenant.created',
        entityType: 'tenant',
        entityId: tenantId,
        actor: { type: 'SYSTEM', source: 'platform-admin' },
        metadata: {
          platformUserId: input.platformUserId,
          solutionKey: solution.key,
          planKey,
          moduleKeys,
          slug: usedSlug,
        },
      });
    });

    const invitation = await this.invitations.create({
      tenantId,
      actingUserId: input.platformUserId,
      actor: { type: 'SYSTEM', source: 'platform-admin' },
      email: input.adminEmail,
      name: input.adminName,
      roleKeys: [PLATFORM_ROLE_KEYS.tenantAdmin],
    });

    await this.setLifecycle({ platformUserId: input.platformUserId, tenantId, to: 'active' });

    const tenant = await this.platform.getTenant(input.platformUserId, tenantId);
    return {
      tenant,
      invitation: {
        membershipId: invitation.membershipId,
        invitationId: invitation.invitationId,
        token: invitation.token,
        expiresAt: invitation.expiresAt,
      },
    };
  }

  /** Move a tenant to a new lifecycle status (Phase 14 §14, §34, §35). */
  async setLifecycle(input: {
    platformUserId: string;
    tenantId: string;
    to: TenantStatus;
    note?: string | null;
  }): Promise<void> {
    await withTenantContext(
      getDb(),
      { tenantId: input.tenantId, userId: input.platformUserId },
      async (tx: Tx) => {
        const [row] = await tx
          .select({ status: tenants.status })
          .from(tenants)
          .where(eq(tenants.id, input.tenantId))
          .limit(1);
        if (!row) throw new AppError('PLATFORM_TENANT_NOT_FOUND');
        if (!isTenantStatus(row.status)) throw new AppError('PLATFORM_TENANT_LIFECYCLE_INVALID');

        if (row.status === input.to) return; // no-op — already there, idempotent

        if (!canTransitionTenantStatus(row.status, input.to)) {
          throw new AppError('PLATFORM_TENANT_LIFECYCLE_INVALID', {
            details: { from: row.status, to: input.to },
          });
        }

        await tx.update(tenants).set({ status: input.to }).where(eq(tenants.id, input.tenantId));

        const action =
          input.to === 'active'
            ? 'platform.tenant.activated'
            : input.to === 'suspended'
              ? 'platform.tenant.suspended'
              : 'platform.tenant.archived';
        await this.audit.record(tx, {
          tenantId: input.tenantId,
          action,
          entityType: 'tenant',
          entityId: input.tenantId,
          actor: { type: 'SYSTEM', source: 'platform-admin' },
          metadata: {
            platformUserId: input.platformUserId,
            from: row.status,
            to: input.to,
            note: input.note ?? null,
          },
        });
      },
    );
  }
}
