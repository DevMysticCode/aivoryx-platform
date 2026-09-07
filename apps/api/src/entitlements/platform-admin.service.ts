import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { getDb, schema, withUserContext } from '@aivoryx/db';

const { platformAdmins } = schema;

/**
 * Resolves whether a user is an Aivoryx **platform administrator** (Phase 13,
 * ADR 0042). A platform admin operates above every tenant — managing workspaces
 * and their module entitlements — and is NOT automatically a tenant business
 * user.
 *
 * The `platform_admins` table is global and security-sensitive: RLS grants the
 * `aivoryx_app` role a SELECT-only, self-read policy, so this check always runs
 * with only `app.user_id` bound (no tenant context) and can only ever see the
 * caller's own row.
 */
@Injectable()
export class PlatformAdminService {
  private readonly cache = new Map<string, { value: boolean; at: number }>();
  private readonly ttlMs = 30_000;

  async isPlatformAdmin(userId: string): Promise<boolean> {
    const hit = this.cache.get(userId);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;

    const rows = await withUserContext(getDb(), userId, (tx) =>
      tx
        .select({ id: platformAdmins.id })
        .from(platformAdmins)
        .where(eq(platformAdmins.userId, userId))
        .limit(1),
    );
    const value = rows.length > 0;
    this.cache.set(userId, { value, at: Date.now() });
    return value;
  }

  /** Drop a cached result (e.g. after a grant/revoke). */
  invalidate(userId: string): void {
    this.cache.delete(userId);
  }
}
