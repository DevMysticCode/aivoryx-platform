import { Injectable } from '@nestjs/common';
import { desc, sql } from 'drizzle-orm';
import { getDb, schema, withUserContext, type Tx } from '@aivoryx/db';
import { getCorrelationId } from '../observability/correlation.js';
import { sanitizeMetadata } from './audit.redaction.js';

const { platformAuditLogs } = schema;

/**
 * Stable action keys for platform-scoped (no-tenant) audit events — a
 * narrower, statically-checked sibling of `audit.actions.ts`'s catalogue,
 * kept separate because these actions have no tenant to attribute to and
 * must never be insertable into the tenant-scoped `audit_logs` table.
 */
export type PlatformAuditAction = 'platform.branding.updated' | 'platform.branding.asset_updated';

export interface PlatformAuditRecordInput {
  actorUserId: string;
  action: PlatformAuditAction;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  correlationId?: string | null;
}

export interface PlatformAuditLogEntry {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  correlationId: string | null;
  occurredAt: string;
  metadata: Record<string, unknown>;
}

export interface ListPlatformAuditLogsResult {
  items: PlatformAuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Audit log for platform-level (Aivoryx-own, no-tenant) administrative
 * actions — e.g. white-label branding. Separate table from the tenant-owned
 * `audit_logs` (see `packages/db/src/schema/audit.ts` for why), but the same
 * append-only convention (DB-level REVOKE UPDATE/DELETE, RLS forced,
 * platform-admin-only SELECT/INSERT policies — migration `0028`) and the
 * same redaction discipline (`sanitizeMetadata`).
 */
@Injectable()
export class PlatformAuditService {
  /**
   * Insert ONE row inside the CALLER's transaction — same invariant as
   * `AuditService.record(tx, …)` for the tenant-owned log (AUDIT.md: "a
   * successful critical mutation cannot silently occur without its audit
   * row"). `tx` must already have `app.user_id` bound to a real platform
   * admin (`withUserContext`/`withTenantContext`, not `withAppTransaction`)
   * — the RLS INSERT policy on `platform_audit_logs` independently rejects
   * the write (42501) otherwise, so a caller cannot forge `actorUserId`
   * without it matching the transaction's own bound identity.
   */
  async record(tx: Tx, input: PlatformAuditRecordInput): Promise<void> {
    await tx.insert(platformAuditLogs).values({
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      correlationId: input.correlationId ?? getCorrelationId() ?? null,
      metadata: sanitizeMetadata(input.metadata),
    });
  }

  async list(
    platformUserId: string,
    filter: { page?: number; pageSize?: number } = {},
  ): Promise<ListPlatformAuditLogsResult> {
    return withUserContext(getDb(), platformUserId, async (tx) => {
      const page = Math.max(1, filter.page ?? 1);
      const pageSize = Math.min(Math.max(1, filter.pageSize ?? 20), 100);

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(platformAuditLogs);
      const total = countRow?.count ?? 0;

      const rows =
        total === 0
          ? []
          : await tx
              .select()
              .from(platformAuditLogs)
              .orderBy(desc(platformAuditLogs.occurredAt), desc(platformAuditLogs.id))
              .limit(pageSize)
              .offset((page - 1) * pageSize);

      return {
        items: rows.map((r) => ({
          id: r.id,
          actorUserId: r.actorUserId,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          correlationId: r.correlationId,
          occurredAt: r.occurredAt.toISOString(),
          metadata: r.metadata,
        })),
        total,
        page,
        pageSize,
      };
    });
  }
}
