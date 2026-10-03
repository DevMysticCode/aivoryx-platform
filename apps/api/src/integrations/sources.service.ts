import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema, withTenantContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import { AdapterRegistry } from './adapters/adapter-registry.js';
import { generateConnectorSecret, hashConnectorSecret } from './connector-token.js';
import { ConnectorCredentialsService } from './credentials/connector-credentials.service.js';
import { AuditService, userActor } from '../audit/audit.service.js';

const { canonicalLeadEvents, integrationEventLog, leadSources, rawEvents } = schema;

export interface TenantScope {
  tenantId: string;
  userId: string;
  /** the acting membership — for audit attribution */
  actorMembershipId: string;
}

export interface SourceView {
  id: string;
  key: string;
  name: string;
  connectorType: string;
  status: string;
  fieldMapping: Record<string, string>;
  /** the globally-unique webhook URL segment for a SIGNATURE-style source (Meta) — null for a
   *  bearer-style source (Pabbly), which uses `key` + a bearer secret instead. Safe to display:
   *  it is not a secret, it IS the public webhook URL. */
  publicLookupKey: string | null;
  /** whether a recoverable credential blob is configured — never what it contains */
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SourceWithSecret {
  source: SourceView;
  secret: string;
}

@Injectable()
export class SourcesService {
  constructor(
    private readonly audit: AuditService,
    private readonly adapters: AdapterRegistry,
    private readonly credentials: ConnectorCredentialsService,
  ) {}

  async list(scope: TenantScope): Promise<SourceView[]> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const rows = await tx
        .select()
        .from(leadSources)
        .where(eq(leadSources.tenantId, scope.tenantId))
        .orderBy(desc(leadSources.createdAt));
      return Promise.all(rows.map((row) => this.toViewWithCredentials(tx, row)));
    });
  }

  async get(scope: TenantScope, sourceId: string): Promise<SourceView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const row = await this.requireSource(tx, scope.tenantId, sourceId);
      return this.toViewWithCredentials(tx, row);
    });
  }

  /**
   * `connectorType` defaults to Pabbly's bearer-style `pabbly_bridge`, exactly as before UC-3. For a
   * SIGNATURE-style provider (checked against the registry, never a hardcoded list — an unregistered
   * `connectorType` is rejected), a globally-unique `publicLookupKey` is minted; the webhook URL for
   * that source is `/integrations/webhooks/<publicLookupKey>`. A bearer secret is ALWAYS minted too
   * (even for a provider that will never present it) so `secret_hash` can stay `NOT NULL` — harmless,
   * since only a bearer-style adapter's webhook path ever looks at it.
   */
  async create(
    scope: TenantScope,
    input: {
      key: string;
      name: string;
      connectorType?: string;
      fieldMapping?: Record<string, string>;
    },
  ): Promise<SourceWithSecret> {
    const connectorType = input.connectorType ?? 'pabbly_bridge';
    if (!this.adapters.has(connectorType)) {
      throw new AppError('VALIDATION_ERROR', {
        message: `"${connectorType}" is not a supported connector type.`,
      });
    }
    const secret = generateConnectorSecret();
    const secretHash = hashConnectorSecret(secret);
    const publicLookupKey = isSignatureStyleProvider(connectorType)
      ? randomBytes(24).toString('base64url')
      : null;
    const source = await withTenantContext(getDb(), scope, async (tx) => {
      const [row] = await tx
        .insert(leadSources)
        .values({
          tenantId: scope.tenantId,
          key: input.key,
          name: input.name,
          connectorType: connectorType as (typeof leadSources.$inferInsert)['connectorType'],
          secretHash,
          publicLookupKey,
          fieldMapping: input.fieldMapping ?? {},
        })
        .returning();
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'integration.source.created',
        entityType: 'lead_source',
        entityId: row!.id,
        actor: userActor(scope),
        metadata: { key: input.key, name: input.name, connectorType },
      });
      return this.toViewWithCredentials(tx, row!);
    });
    return { source, secret };
  }

  /**
   * Write-only: stores (encrypted) a provider-specific credential blob for a source — e.g. Meta's
   * `{ appSecret, pageAccessToken, verifyToken }`. Never returns the plaintext; the response is just
   * the ordinary `SourceView` (with `hasCredentials: true`). Replaces the ENTIRE blob — callers that
   * want to change one field must resend the others too (no partial merge, so a stale cached value
   * can never silently resurrect a revoked one).
   */
  async setCredentials(
    scope: TenantScope,
    sourceId: string,
    data: Record<string, string>,
  ): Promise<SourceView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      const row = await this.requireSource(tx, scope.tenantId, sourceId);
      await this.credentials.set(tx, { tenantId: scope.tenantId, sourceId, data });
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'integration.source.updated',
        entityType: 'lead_source',
        entityId: sourceId,
        actor: userActor(scope),
        metadata: { fields: Object.keys(data).sort() }, // field NAMES only, never values
      });
      return this.toViewWithCredentials(tx, row);
    });
  }

  /** Issues a new secret for an existing source; the old one stops working immediately. */
  async rotateSecret(scope: TenantScope, sourceId: string): Promise<SourceWithSecret> {
    const secret = generateConnectorSecret();
    const secretHash = hashConnectorSecret(secret);
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireSource(tx, scope.tenantId, sourceId);
      const [row] = await tx
        .update(leadSources)
        .set({ secretHash, updatedAt: new Date() })
        .where(eq(leadSources.id, sourceId))
        .returning();
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'integration.source.secret_rotated',
        entityType: 'lead_source',
        entityId: sourceId,
        actor: userActor(scope),
      });
      return { source: await this.toViewWithCredentials(tx, row!), secret };
    });
  }

  async revoke(scope: TenantScope, sourceId: string): Promise<SourceView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireSource(tx, scope.tenantId, sourceId);
      const [updated] = await tx
        .update(leadSources)
        .set({ status: 'revoked', revokedAt: new Date(), updatedAt: new Date() })
        .where(eq(leadSources.id, sourceId))
        .returning();
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'integration.source.revoked',
        entityType: 'lead_source',
        entityId: sourceId,
        actor: userActor(scope),
        changes: { status: { from: 'active', to: 'revoked' } },
      });
      return this.toViewWithCredentials(tx, updated!);
    });
  }

  async reactivate(scope: TenantScope, sourceId: string): Promise<SourceView> {
    return withTenantContext(getDb(), scope, async (tx) => {
      await this.requireSource(tx, scope.tenantId, sourceId);
      const [updated] = await tx
        .update(leadSources)
        .set({ status: 'active', revokedAt: null, updatedAt: new Date() })
        .where(eq(leadSources.id, sourceId))
        .returning();
      await this.audit.record(tx, {
        tenantId: scope.tenantId,
        action: 'integration.source.reactivated',
        entityType: 'lead_source',
        entityId: sourceId,
        actor: userActor(scope),
        changes: { status: { from: 'revoked', to: 'active' } },
      });
      return this.toViewWithCredentials(tx, updated!);
    });
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

  private async toViewWithCredentials(
    tx: Tx,
    row: typeof leadSources.$inferSelect,
  ): Promise<SourceView> {
    const hasCredentials = await this.credentials.has(tx, row.tenantId, row.id);
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      connectorType: row.connectorType,
      status: row.status,
      fieldMapping: (row.fieldMapping as Record<string, string>) ?? {},
      publicLookupKey: row.publicLookupKey,
      hasCredentials,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** Providers that authenticate a webhook via `ConnectorAdapter.verify()` rather than a presented
 *  bearer secret, and therefore need a globally-unique `public_lookup_key` instead of (in addition
 *  to) a secret. Kept as a short, explicit list here — NOT derived from the registry — because it is
 *  a transport-shape fact about a provider (can it send a custom Authorization header at all?), not
 *  an adapter-behavioural one; the registry has no reason to know it. */
const SIGNATURE_STYLE_PROVIDERS = new Set(['meta_lead_ads']);

function isSignatureStyleProvider(connectorType: string): boolean {
  return SIGNATURE_STYLE_PROVIDERS.has(connectorType);
}
