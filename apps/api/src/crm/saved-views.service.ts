import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, newUuidV7, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';

const { crmSavedViews } = schema;

export interface SavedViewScope {
  tenantId: string;
  userId: string;
  actorMembershipId: string;
}

export interface SavedViewView {
  id: string;
  name: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Persistent CRM lead-list saved views (Phase 13C). Tenant-owned
 * (`crm_saved_views` RLS isolates by `tenant_id`); every read and write here
 * also pins `membership_id = <actor>`, so a view is visible and mutable only to
 * the member who created it — views never leak between users or tenants. The
 * `config` blob is UI-owned; the server validates only that it is an object.
 */
@Injectable()
export class SavedViewsService {
  list(scope: SavedViewScope): Promise<SavedViewView[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(crmSavedViews)
        .where(
          and(
            eq(crmSavedViews.tenantId, scope.tenantId),
            eq(crmSavedViews.membershipId, scope.actorMembershipId),
          ),
        )
        .orderBy(asc(crmSavedViews.name));
      return rows.map(toView);
    });
  }

  create(
    scope: SavedViewScope,
    input: { name: string; config: Record<string, unknown> },
  ): Promise<SavedViewView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const name = input.name.trim();
      const [dupe] = await tx
        .select({ id: crmSavedViews.id })
        .from(crmSavedViews)
        .where(
          and(
            eq(crmSavedViews.tenantId, scope.tenantId),
            eq(crmSavedViews.membershipId, scope.actorMembershipId),
            eq(crmSavedViews.name, name),
          ),
        )
        .limit(1);
      if (dupe) throw new AppError('SAVED_VIEW_DUPLICATE_NAME');
      const [row] = await tx
        .insert(crmSavedViews)
        .values({
          id: newUuidV7(),
          tenantId: scope.tenantId,
          membershipId: scope.actorMembershipId,
          name,
          config: input.config,
        })
        .returning();
      return toView(row!);
    });
  }

  update(
    scope: SavedViewScope,
    id: string,
    patch: { name?: string; config?: Record<string, unknown> },
  ): Promise<SavedViewView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const existing = await this.require(tx, scope, id);
      const name = patch.name?.trim() ?? existing.name;
      if (name !== existing.name) {
        const [dupe] = await tx
          .select({ id: crmSavedViews.id })
          .from(crmSavedViews)
          .where(
            and(
              eq(crmSavedViews.tenantId, scope.tenantId),
              eq(crmSavedViews.membershipId, scope.actorMembershipId),
              eq(crmSavedViews.name, name),
            ),
          )
          .limit(1);
        if (dupe) throw new AppError('SAVED_VIEW_DUPLICATE_NAME');
      }
      const [row] = await tx
        .update(crmSavedViews)
        .set({
          name,
          config: patch.config ?? (existing.config as Record<string, unknown>),
          updatedAt: new Date(),
        })
        .where(
          and(eq(crmSavedViews.id, id), eq(crmSavedViews.membershipId, scope.actorMembershipId)),
        )
        .returning();
      return toView(row!);
    });
  }

  async remove(scope: SavedViewScope, id: string): Promise<void> {
    await withTenantContext(getDb(), scope, async (tx) => {
      await this.require(tx, scope, id);
      await tx
        .delete(crmSavedViews)
        .where(
          and(eq(crmSavedViews.id, id), eq(crmSavedViews.membershipId, scope.actorMembershipId)),
        );
    });
  }

  private async require(tx: Tx, scope: SavedViewScope, id: string) {
    const [row] = await tx
      .select()
      .from(crmSavedViews)
      .where(
        and(
          eq(crmSavedViews.id, id),
          eq(crmSavedViews.tenantId, scope.tenantId),
          eq(crmSavedViews.membershipId, scope.actorMembershipId),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('SAVED_VIEW_NOT_FOUND');
    return row;
  }
}

function toView(row: typeof crmSavedViews.$inferSelect): SavedViewView {
  return {
    id: row.id,
    name: row.name,
    config: (row.config ?? {}) as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
