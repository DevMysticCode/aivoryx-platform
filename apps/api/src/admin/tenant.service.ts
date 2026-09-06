import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { AuditService, userActor } from '../audit/audit.service.js';

const { tenants, userTenantMemberships } = schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
  /** the acting membership — for audit attribution (optional on read paths) */
  actorMembershipId?: string;
}

export interface TenantView {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  createdAt: string;
  memberCounts: { active: number; invited: number; suspended: number; total: number };
}

/**
 * Read/update the caller's active tenant. Everything runs inside
 * `withTenantContext`, so PostgreSQL RLS is the isolation boundary — the
 * explicit `id`/`tenant_id` filters are belt-and-braces (TENANCY.md).
 */
@Injectable()
export class TenantService {
  constructor(private readonly audit: AuditService) {}

  async get(scope: TenantScope): Promise<TenantView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [tenant] = await tx
        .select({
          id: tenants.id,
          slug: tenants.slug,
          name: tenants.name,
          status: tenants.status,
          createdAt: tenants.createdAt,
        })
        .from(tenants)
        .where(eq(tenants.id, scope.tenantId))
        .limit(1);
      if (!tenant) throw new AppError('AUTH_NO_ACTIVE_TENANT');

      const counts = await tx
        .select({ status: userTenantMemberships.status, n: sql<number>`count(*)::int` })
        .from(userTenantMemberships)
        .where(eq(userTenantMemberships.tenantId, scope.tenantId))
        .groupBy(userTenantMemberships.status);

      const byStatus = { active: 0, invited: 0, suspended: 0 };
      for (const row of counts) {
        if (row.status in byStatus) byStatus[row.status as keyof typeof byStatus] = row.n;
      }

      return {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status,
        createdAt: tenant.createdAt.toISOString(),
        memberCounts: {
          ...byStatus,
          total: byStatus.active + byStatus.invited + byStatus.suspended,
        },
      };
    });
  }

  /** Update the small set of editable tenant fields. `slug` and `status` are not editable here. */
  async update(scope: TenantScope, patch: { name?: string }): Promise<TenantView> {
    if (patch.name !== undefined) {
      await withTenantContext(getDb(), scope, async (tx) => {
        const [before] = await tx
          .select({ name: tenants.name })
          .from(tenants)
          .where(eq(tenants.id, scope.tenantId))
          .limit(1);
        const result = await tx
          .update(tenants)
          .set({ name: patch.name!, updatedAt: sql`now()` })
          .where(eq(tenants.id, scope.tenantId))
          .returning({ id: tenants.id });
        if (result.length === 0) throw new AppError('AUTH_NO_ACTIVE_TENANT');

        if (scope.actorMembershipId && before && before.name !== patch.name) {
          await this.audit.record(tx, {
            tenantId: scope.tenantId,
            action: 'tenant.updated',
            entityType: 'tenant',
            entityId: scope.tenantId,
            actor: userActor({ actorMembershipId: scope.actorMembershipId }),
            changes: { name: { from: before.name, to: patch.name } },
          });
        }
      });
    }
    return this.get(scope);
  }
}
