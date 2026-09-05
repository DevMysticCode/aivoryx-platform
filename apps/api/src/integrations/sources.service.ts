import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { generateConnectorSecret, hashConnectorSecret } from './connector-token.js';

const { canonicalLeadEvents, integrationEventLog, leadSources, rawEvents } = schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
}

export interface SourceView {
  id: string;
  key: string;
  name: string;
  connectorType: string;
  status: string;
  fieldMapping: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface SourceWithSecret {
  source: SourceView;
  secret: string;
}

@Injectable()
export class SourcesService {
  list(scope: TenantScope): Promise<SourceView[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(leadSources)
        .where(eq(leadSources.tenantId, scope.tenantId))
        .orderBy(desc(leadSources.createdAt));
      return rows.map(toView);
    });
  }

  async get(scope: TenantScope, sourceId: string): Promise<SourceView> {
    const row = await withTenantContext(getDb(), scope, (tx) =>
      this.requireSource(tx, scope.tenantId, sourceId),
    );
    return toView(row);
  }

  async create(
    scope: TenantScope,
    input: { key: string; name: string; fieldMapping?: Record<string, string> },
  ): Promise<SourceWithSecret> {
    const secret = generateConnectorSecret();
    const secretHash = hashConnectorSecret(secret);
    const source = await withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .insert(leadSources)
        .values({
          tenantId: scope.tenantId,
          key: input.key,
          name: input.name,
          secretHash,
          fieldMapping: input.fieldMapping ?? {},
        })
        .returning();
      return row!;
    });
    return { source: toView(source), secret };
  }

  /** Issues a new secret for an existing source; the old one stops working immediately. */
  async rotateSecret(scope: TenantScope, sourceId: string): Promise<SourceWithSecret> {
    const secret = generateConnectorSecret();
    const secretHash = hashConnectorSecret(secret);
    const source = await withTenantContext(getDb(), scope, async (tx) => {
      await this.requireSource(tx, scope.tenantId, sourceId);
      const [row] = await tx
        .update(leadSources)
        .set({ secretHash, updatedAt: new Date() })
        .where(eq(leadSources.id, sourceId))
        .returning();
      return row!;
    });
    return { source: toView(source), secret };
  }

  async revoke(scope: TenantScope, sourceId: string): Promise<SourceView> {
    const row = await withTenantContext(getDb(), scope, async (tx) => {
      await this.requireSource(tx, scope.tenantId, sourceId);
      const [updated] = await tx
        .update(leadSources)
        .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(leadSources.id, sourceId))
        .returning();
      return updated!;
    });
    return toView(row);
  }

  async reactivate(scope: TenantScope, sourceId: string): Promise<SourceView> {
    const row = await withTenantContext(getDb(), scope, async (tx) => {
      await this.requireSource(tx, scope.tenantId, sourceId);
      const [updated] = await tx
        .update(leadSources)
        .set({ status: 'active', revokedAt: null, updatedAt: new Date() })
        .where(eq(leadSources.id, sourceId))
        .returning();
      return updated!;
    });
    return toView(row);
  }

  async listRecentEvents(scope: TenantScope, limit = 50) {
    return withTenantContext(getDb(), scope, async (tx) => {
      return tx
        .select({
          id: canonicalLeadEvents.id,
          rawEventId: canonicalLeadEvents.rawEventId,
          sourceId: canonicalLeadEvents.sourceId,
          status: canonicalLeadEvents.status,
          leadId: canonicalLeadEvents.leadId,
          dedupeOutcome: canonicalLeadEvents.dedupeOutcome,
          processingAttempts: canonicalLeadEvents.processingAttempts,
          lastErrorCode: canonicalLeadEvents.lastErrorCode,
          lastErrorMessage: canonicalLeadEvents.lastErrorMessage,
          createdAt: canonicalLeadEvents.createdAt,
        })
        .from(canonicalLeadEvents)
        .where(eq(canonicalLeadEvents.tenantId, scope.tenantId))
        .orderBy(desc(canonicalLeadEvents.createdAt))
        .limit(limit);
    });
  }

  async getEventDetail(scope: TenantScope, canonicalEventId: string) {
    return withTenantContext(getDb(), scope, async (tx) => {
      const [event] = await tx
        .select()
        .from(canonicalLeadEvents)
        .where(
          and(
            eq(canonicalLeadEvents.id, canonicalEventId),
            eq(canonicalLeadEvents.tenantId, scope.tenantId),
          ),
        )
        .limit(1);
      if (!event) throw new AppError('EVENT_NOT_FOUND');

      const [raw] = await tx
        .select()
        .from(rawEvents)
        .where(and(eq(rawEvents.id, event.rawEventId), eq(rawEvents.tenantId, scope.tenantId)))
        .limit(1);

      const log = await tx
        .select()
        .from(integrationEventLog)
        .where(
          and(
            eq(integrationEventLog.rawEventId, event.rawEventId),
            eq(integrationEventLog.tenantId, scope.tenantId),
          ),
        )
        .orderBy(integrationEventLog.createdAt);

      return { event, raw, log };
    });
  }

  private async requireSource(tx: Tx, tenantId: string, sourceId: string) {
    const [row] = await tx
      .select()
      .from(leadSources)
      .where(and(eq(leadSources.id, sourceId), eq(leadSources.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new AppError('SOURCE_NOT_FOUND');
    return row;
  }
}

function toView(row: typeof leadSources.$inferSelect): SourceView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    connectorType: row.connectorType,
    status: row.status,
    fieldMapping: (row.fieldMapping as Record<string, string>) ?? {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
