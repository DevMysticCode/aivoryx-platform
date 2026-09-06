import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import type { TenantScope } from '../supply/common.js';
import { pageBounds, type Paged } from '../supply/common.js';
import type { AuditLogDetailDto, AuditLogDto, ListAuditQueryDto } from './audit.dto.js';

const { auditLogs, userTenantMemberships, users } = schema;

/**
 * Read side of the Global Audit Log (Phase 11, ADR 0040). Every query runs
 * inside `withTenantContext`, so PostgreSQL RLS scopes results to the active
 * tenant — a tenant can only ever see its own audit history. Filtering and
 * pagination are done in SQL against the `(tenant_id, …, occurred_at)` indexes;
 * the actor's name/email is resolved with a single LEFT JOIN (no N+1).
 */
@Injectable()
export class AuditQueryService {
  list(scope: TenantScope, query: ListAuditQueryDto): Promise<Paged<AuditLogDto>> {
    const { page, pageSize } = pageBounds(query.page, query.pageSize ?? 25);
    return withTenantContext(getDb(), scope, async (tx) => {
      const where = this.buildWhere(scope.tenantId, query);

      const [countRow] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(where);

      const rows = await tx
        .select({
          id: auditLogs.id,
          occurredAt: auditLogs.occurredAt,
          actorType: auditLogs.actorType,
          actorMembershipId: auditLogs.actorMembershipId,
          actorSource: auditLogs.actorSource,
          action: auditLogs.action,
          module: auditLogs.module,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          correlationId: auditLogs.correlationId,
          actorName: users.name,
          actorEmail: users.email,
        })
        .from(auditLogs)
        .leftJoin(userTenantMemberships, eq(userTenantMemberships.id, auditLogs.actorMembershipId))
        .leftJoin(users, eq(users.id, userTenantMemberships.userId))
        .where(where)
        .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      return {
        items: rows.map((r) => this.toDto(r)),
        total: countRow?.n ?? 0,
        page,
        pageSize,
      };
    });
  }

  get(scope: TenantScope, id: string): Promise<AuditLogDetailDto> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .select({
          id: auditLogs.id,
          occurredAt: auditLogs.occurredAt,
          actorType: auditLogs.actorType,
          actorMembershipId: auditLogs.actorMembershipId,
          actorSource: auditLogs.actorSource,
          action: auditLogs.action,
          module: auditLogs.module,
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          correlationId: auditLogs.correlationId,
          requestId: auditLogs.requestId,
          ipAddress: auditLogs.ipAddress,
          userAgent: auditLogs.userAgent,
          metadata: auditLogs.metadata,
          changes: auditLogs.changes,
          actorName: users.name,
          actorEmail: users.email,
        })
        .from(auditLogs)
        .leftJoin(userTenantMemberships, eq(userTenantMemberships.id, auditLogs.actorMembershipId))
        .leftJoin(users, eq(users.id, userTenantMemberships.userId))
        .where(and(eq(auditLogs.tenantId, scope.tenantId), eq(auditLogs.id, id)))
        .limit(1);

      if (!row) throw new AppError('AUDIT_LOG_NOT_FOUND');

      return {
        ...this.toDto(row),
        requestId: row.requestId,
        ipAddress: row.ipAddress,
        userAgent: row.userAgent,
        metadata: row.metadata ?? {},
        changes: row.changes ?? null,
      };
    });
  }

  private buildWhere(tenantId: string, q: ListAuditQueryDto): SQL {
    const conds: SQL[] = [eq(auditLogs.tenantId, tenantId)];
    if (q.from) conds.push(gte(auditLogs.occurredAt, new Date(q.from)));
    if (q.to) conds.push(lt(auditLogs.occurredAt, new Date(q.to)));
    if (q.actorMembershipId) {
      conds.push(eq(auditLogs.actorMembershipId, q.actorMembershipId));
    }
    if (q.actorType) conds.push(eq(auditLogs.actorType, q.actorType));
    if (q.action) conds.push(eq(auditLogs.action, q.action));
    if (q.module) conds.push(eq(auditLogs.module, q.module as 'auth'));
    if (q.entityType) conds.push(eq(auditLogs.entityType, q.entityType));
    if (q.entityId) conds.push(eq(auditLogs.entityId, q.entityId));
    return and(...conds)!;
  }

  private toDto(row: {
    id: string;
    occurredAt: Date;
    actorType: 'USER' | 'SYSTEM';
    actorMembershipId: string | null;
    actorSource: string | null;
    action: string;
    module: string;
    entityType: string;
    entityId: string | null;
    correlationId: string | null;
    actorName: string | null;
    actorEmail: string | null;
  }): AuditLogDto {
    return {
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      actorType: row.actorType,
      actorMembershipId: row.actorMembershipId,
      actorName: row.actorName ?? null,
      actorEmail: row.actorEmail ?? null,
      actorSource: row.actorSource,
      action: row.action,
      module: row.module,
      entityType: row.entityType,
      entityId: row.entityId,
      correlationId: row.correlationId,
    };
  }
}
