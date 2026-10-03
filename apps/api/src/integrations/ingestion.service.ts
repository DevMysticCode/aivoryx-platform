import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withProgressiveContext, type RlsContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
import type { ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';
import { OutboxService } from '../admin/outbox.service.js';
import { recordActivity } from '../crm/activities.js';
import {
  loadActiveCustomFieldDefs,
  persistCoercedCustomFieldValues,
  validateCustomFieldValues,
  type CustomFieldInputValue,
} from '../crm/custom-fields.service.js';
import { findDuplicateLead } from '../crm/lead-queries.js';
import { normalizeEmail, normalizePhone } from '../crm/lead-normalization.js';
import { AdapterRegistry } from './adapters/adapter-registry.js';
import {
  HydrationError,
  isRetryableHydrationErrorCode,
  type CanonicalDraft,
} from './adapters/connector-adapter.js';
import { ConnectorCredentialsService } from './credentials/connector-credentials.service.js';
import { hashConnectorSecret } from './connector-token.js';
import { mapProviderFields } from './mapping.js';
import { hashRawBody } from './raw-hash.js';
import { WEBHOOK_RATE_LIMITER, type RateLimiter } from './rate-limiter.js';
import { AuditService } from '../audit/audit.service.js';

const { canonicalLeadEvents, leadSources, leads, rawEvents } = schema;

/** canonical-event error code for an UNEXPECTED (non-business) processing failure */
export const PROCESSING_ERROR_CODE = 'PROCESSING_ERROR';
const PROCESSING_ERROR_MESSAGE =
  'An unexpected error interrupted processing of this event. It can be replayed.';

type DuplicateLookup =
  | { kind: 'retry'; canonicalId: string }
  | { kind: 'result'; result: IngestResult };

/** ids resolved while ingesting, for the per-delivery log line only */
interface IngestTrace {
  tenantId?: string;
  sourceId?: string;
}

export const LEAD_CREATED_EVENT = 'lead.created';
export const LEAD_UPDATED_EVENT = 'lead.updated';

export interface InboundRequest {
  sourceKeyFromUrl: string;
  /** present only when the caller sent an Authorization bearer header (Pabbly-style transport auth) */
  secret: string | null;
  rawBody: unknown;
  /** exact bytes received over HTTP — used ONLY by `ConnectorAdapter.verify()` (UC-3) */
  rawBytes?: Buffer;
  headers: Record<string, string>;
  correlationId: string;
}

export type IngestStatus =
  | 'DONE'
  | 'VALIDATION_FAILED'
  | 'MAPPING_FAILED'
  | 'DUPLICATE_RAW'
  | 'DUPLICATE_EVENT';

export interface IngestResult {
  status: IngestStatus;
  rawEventId: string;
  canonicalEventId?: string;
  leadId?: string;
  dedupeOutcome?: string;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * The inbound pipeline (ADR 0032): receive -> persist raw event -> adapt ->
 * map -> validate -> deduplicate -> create/update lead -> record activity ->
 * emit outbox event. Two transactions, not one — the raw event must survive
 * even if everything after it fails (docs/architecture/RAW-EVENTS-AND-REPLAY.md
 * "written before any parsing, in its own transaction").
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly adapters: AdapterRegistry,
    private readonly credentials: ConnectorCredentialsService,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
    @Inject(WEBHOOK_RATE_LIMITER) private readonly rateLimiter: RateLimiter,
  ) {}

  /**
   * Public entry point. Adds timing and ONE structured, secret-free log line per delivery (ids,
   * status, error code, duration — never the payload, headers or credential).
   */
  async ingest(input: InboundRequest): Promise<IngestResult> {
    const startedAt = Date.now();
    const trace: IngestTrace = {};
    try {
      const result = await this.run(input, trace);
      this.logger.log(
        {
          module: 'integrations',
          operation: 'webhook.ingest',
          correlationId: input.correlationId,
          tenantId: trace.tenantId,
          sourceId: trace.sourceId,
          rawEventId: result.rawEventId,
          canonicalEventId: result.canonicalEventId,
          status: result.status,
          errorCode: result.errorCode,
          durationMs: Date.now() - startedAt,
        },
        'webhook processed',
      );
      return result;
    } catch (err) {
      this.logger.warn(
        {
          module: 'integrations',
          operation: 'webhook.ingest',
          correlationId: input.correlationId,
          tenantId: trace.tenantId,
          sourceId: trace.sourceId,
          status: 'REJECTED',
          errorCode: AppError.isAppError(err) ? err.code : 'INTERNAL_ERROR',
          durationMs: Date.now() - startedAt,
        },
        'webhook rejected',
      );
      throw err;
    }
  }

  private async run(input: InboundRequest, trace: IngestTrace): Promise<IngestResult> {
    const resolved = await withProgressiveContext(getDb(), async (tx, setContext) => {
      const source = input.secret
        ? await this.resolveBySecret(tx, setContext, input)
        : await this.resolveByPublicLookupKey(tx, setContext, input);
      if (source.status === 'revoked') throw new AppError('CONNECTOR_REVOKED');
      trace.tenantId = source.tenantId;
      trace.sourceId = source.id;

      // Per-source rate limit (UC-1), after the connector is resolved and BEFORE anything is
      // persisted: a limited request creates no raw event, canonical event, lead or outbox row.
      const decision = this.rateLimiter.consume(`source:${source.id}`);
      if (!decision.allowed) {
        throw new AppError('RATE_LIMITED', {
          message: 'This source is sending events too quickly. Retry after the indicated delay.',
          details: { retryAfterSeconds: decision.retryAfterSeconds, limit: decision.limit },
        });
      }

      // Server-derived, never client-supplied — the payload's tenant_id (if any) is ignored.
      await setContext({ tenantId: source.tenantId });

      // Generic adapter verification (UC-3): a no-op returning {verified:true} for a provider
      // with nothing to verify (Pabbly — its bearer secret already authenticated it above), a
      // real signature check for a provider that needs one (Meta). Happens BEFORE the raw event
      // is persisted, exactly like the bearer-secret check always has.
      const adapter = this.adapters.resolve(source.connectorType);
      const credential = await this.credentials.getResolvedCredential(tx, source.id);
      const verification = adapter.verify(
        { rawBody: input.rawBody, rawBytes: input.rawBytes, headers: input.headers },
        credential,
      );
      if (!verification.verified) throw new AppError('CONNECTOR_INVALID');

      const rawHash = hashRawBody(input.rawBody);
      const [inserted] = await tx
        .insert(rawEvents)
        .values({
          tenantId: source.tenantId,
          sourceId: source.id,
          correlationId: input.correlationId,
          rawBody: input.rawBody as Record<string, unknown>,
          rawHash,
          transportMetadata: input.headers,
          expiresAt: new Date(Date.now() + this.env.RAW_EVENT_RETENTION_DAYS * 86_400_000),
        })
        .onConflictDoNothing({
          target: [rawEvents.tenantId, rawEvents.sourceId, rawEvents.rawHash],
        })
        .returning({ id: rawEvents.id });

      if (inserted) {
        return {
          tenantId: source.tenantId,
          source,
          rawEventId: inserted.id,
          rawStatus: 'RECEIVED' as const,
          isNewRaw: true as const,
        };
      }
      const [existing] = await tx
        .select({ id: rawEvents.id, status: rawEvents.status })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.tenantId, source.tenantId),
            eq(rawEvents.sourceId, source.id),
            eq(rawEvents.rawHash, rawHash),
          ),
        )
        .limit(1);
      return {
        tenantId: source.tenantId,
        source,
        rawEventId: existing!.id,
        rawStatus: existing!.status,
        isNewRaw: false as const,
      };
    });

    if (!resolved.isNewRaw) {
      const duplicate = await withProgressiveContext<DuplicateLookup>(
        getDb(),
        async (tx, setContext) => {
          await setContext({ tenantId: resolved.tenantId });
          const [existingCanonical] = await tx
            .select()
            .from(canonicalLeadEvents)
            .where(eq(canonicalLeadEvents.rawEventId, resolved.rawEventId))
            .limit(1);
          // A provider RETRY of a delivery whose processing failed unexpectedly (transient DB error,
          // deploy mid-flight, ...) must finish the job instead of being answered "duplicate" forever.
          // Business failures (validation/mapping) are not retried: the same body would fail again.
          if (
            resolved.rawStatus === 'FAILED' &&
            existingCanonical?.status === 'FAILED' &&
            existingCanonical.lastErrorCode !== null &&
            (existingCanonical.lastErrorCode === PROCESSING_ERROR_CODE ||
              isRetryableHydrationErrorCode(existingCanonical.lastErrorCode))
          ) {
            return { kind: 'retry', canonicalId: existingCanonical.id };
          }
          return {
            kind: 'result',
            result: {
              status: 'DUPLICATE_RAW',
              rawEventId: resolved.rawEventId,
              canonicalEventId: existingCanonical?.id,
              leadId: existingCanonical?.leadId ?? undefined,
              dedupeOutcome: existingCanonical?.dedupeOutcome ?? undefined,
            },
          };
        },
      );
      if (duplicate.kind === 'retry') {
        return this.replay(resolved.tenantId, duplicate.canonicalId, null);
      }
      return duplicate.result;
    }

    return this.processRawEvent(resolved.tenantId, resolved.source, resolved.rawEventId);
  }

  /** Bearer-style resolution (Pabbly): the connector secret's hash is the authenticator, globally
   *  unique, resolved before any tenant context exists — unchanged from UC-0/UC-1/UC-2. */
  private async resolveBySecret(
    tx: Tx,
    setContext: (ctx: RlsContext) => Promise<void>,
    input: InboundRequest,
  ): Promise<typeof leadSources.$inferSelect> {
    const secretHash = hashConnectorSecret(input.secret!);
    await setContext({ connectorSecretHash: secretHash });
    const [source] = await tx
      .select()
      .from(leadSources)
      .where(eq(leadSources.secretHash, secretHash))
      .limit(1);
    if (!source) throw new AppError('CONNECTOR_INVALID');
    if (source.key !== input.sourceKeyFromUrl) throw new AppError('CONNECTOR_INVALID');
    return source;
  }

  /**
   * Signature-style resolution (Meta, UC-3): no bearer secret exists at all — Meta's platform
   * cannot send a custom Authorization header. The URL's `:sourceKey` IS the source's globally
   * unique `public_lookup_key`; the REAL authenticator is `ConnectorAdapter.verify()` (the
   * payload signature), checked by the caller right after this resolves, before the raw event is
   * persisted. A source that never configured a public lookup key (every Pabbly source) simply
   * never matches here, which is exactly today's 'missing credential' outcome.
   */
  private async resolveByPublicLookupKey(
    tx: Tx,
    setContext: (ctx: RlsContext) => Promise<void>,
    input: InboundRequest,
  ): Promise<typeof leadSources.$inferSelect> {
    await setContext({ connectorPublicLookupKey: input.sourceKeyFromUrl });
    const [source] = await tx
      .select()
      .from(leadSources)
      .where(eq(leadSources.publicLookupKey, input.sourceKeyFromUrl))
      .limit(1);
    if (!source) throw new AppError('CONNECTOR_INVALID');
    return source;
  }

  /**
   * Parse (and, if the adapter's draft is a bare `ProviderReference`, hydrate) OUTSIDE any open
   * transaction (UC-3, ADR 0049). Both `withProgressiveContext` calls below commit immediately —
   * they are short reads of our own tables — so a slow or failing external provider call
   * (`adapter.hydrate`) NEVER holds a pooled DB connection open. `processRawEvent` calls this BEFORE
   * opening transaction 2.
   */
  private async resolveDraft(
    tenantId: string,
    source: typeof leadSources.$inferSelect,
    rawEventId: string,
  ): Promise<CanonicalDraft> {
    const adapter = this.adapters.resolve(source.connectorType);
    const raw = await withProgressiveContext(getDb(), async (tx, setContext) => {
      await setContext({ tenantId });
      const [row] = await tx.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)).limit(1);
      return row!;
    });
    const initial = adapter.parse({
      rawBody: raw.rawBody,
      headers: raw.transportMetadata as Record<string, string>,
    });
    if (!initial.providerReference) return initial;
    if (!adapter.hydrate) {
      throw new AppError('ADAPTER_NOT_FOUND', {
        details: {
          provider: source.connectorType,
          reason: 'parse() returned a providerReference but this adapter has no hydrate()',
        },
      });
    }
    const credential = await withProgressiveContext(getDb(), async (tx, setContext) => {
      await setContext({ tenantId });
      return this.credentials.getResolvedCredential(tx, source.id);
    });
    // The provider API call happens here — both transactions above have already committed.
    return adapter.hydrate(initial.providerReference, {
      credential,
      correlationId: raw.correlationId,
    });
  }

  /**
   * Resolve the draft (parse + hydrate, OUTSIDE any transaction — see `resolveDraft`), then run
   * transaction 2. Any UNEXPECTED exception from either step rolls back cleanly (no half-written
   * lead), then a separate short transaction records the failure durably so the event is never left
   * looking successful or invisible: raw event -> FAILED, canonical event -> FAILED. The caller
   * gets a generic 500 carrying the correlation id; the underlying error (which can embed SQL
   * parameters, i.e. lead data) is never propagated or logged.
   */
  private async processRawEvent(
    tenantId: string,
    source: typeof leadSources.$inferSelect,
    rawEventId: string,
    options: { isReplay?: boolean } = {},
  ): Promise<IngestResult> {
    try {
      const draft = await this.resolveDraft(tenantId, source, rawEventId);
      return await this.processRawEventTx(tenantId, source, rawEventId, draft, options);
    } catch (err) {
      await this.recordProcessingFailure(tenantId, source, rawEventId, err);
      throw new AppError('INTERNAL_ERROR');
    }
  }

  /** `source` is the row already loaded by the caller — never re-queried merely to rediscover
   *  `connectorType` for adapter resolution (Decision 3, UC-2). A `HydrationError` (UC-3) is
   *  recorded under its OWN error code (e.g. `PROVIDER_RATE_LIMITED`), distinguishable from a
   *  generic internal fault (`PROCESSING_ERROR`) — both are FAILED/replayable the same way. */
  private async recordProcessingFailure(
    tenantId: string,
    source: typeof leadSources.$inferSelect,
    rawEventId: string,
    err: unknown,
  ): Promise<void> {
    const sourceId = source.id;
    const isHydrationFailure = err instanceof HydrationError;
    const errorCode = isHydrationFailure ? err.code : PROCESSING_ERROR_CODE;
    const errorMessage = isHydrationFailure ? err.message : PROCESSING_ERROR_MESSAGE;
    // Safe diagnostics only: error class and Postgres SQLSTATE, never the message, params or payload.
    // only a REAL Postgres SQLSTATE, never HydrationError.code (which .code also happens to hold)
    const pgCode = isHydrationFailure ? undefined : (err as { code?: unknown } | null)?.code;
    this.logger.error(
      {
        module: 'integrations',
        operation: 'webhook.process',
        tenantId,
        sourceId,
        rawEventId,
        status: 'FAILED',
        errorCode,
        errorClass: err instanceof Error ? err.name : typeof err,
        pgCode: typeof pgCode === 'string' ? pgCode : undefined,
      },
      isHydrationFailure ? 'webhook hydration failed' : 'webhook processing failed unexpectedly',
    );
    try {
      await withProgressiveContext(getDb(), async (tx, setContext) => {
        await setContext({ tenantId });
        const [raw] = await tx
          .select()
          .from(rawEvents)
          .where(eq(rawEvents.id, rawEventId))
          .limit(1);
        if (!raw) return;
        const [existing] = await tx
          .select()
          .from(canonicalLeadEvents)
          .where(eq(canonicalLeadEvents.rawEventId, rawEventId))
          .limit(1);
        if (existing?.status === 'DONE') return;

        let canonicalId: string | undefined = existing?.id;
        if (existing) {
          // replay path: the canonical row was left PROCESSING by the attempt-count bump
          await tx
            .update(canonicalLeadEvents)
            .set({
              status: 'FAILED',
              lastErrorCode: errorCode,
              lastErrorMessage: errorMessage,
              updatedAt: new Date(),
            })
            .where(eq(canonicalLeadEvents.id, existing.id));
        } else {
          // first attempt: transaction 2 never opened (resolveDraft failed) or rolled back before a
          // canonical row could persist. parse() is pure/sync — recomputing it here on data already
          // in hand costs nothing, unlike a fresh SELECT.
          const draft = this.adapters.resolve(source.connectorType).parse({
            rawBody: raw.rawBody,
            headers: raw.transportMetadata as Record<string, string>,
          });
          const providerRecordId = draft.providerRecordId;
          const [inserted] = await tx
            .insert(canonicalLeadEvents)
            .values({
              tenantId,
              rawEventId,
              sourceId,
              idempotencyKey: providerRecordId ? `record:${providerRecordId}` : `raw:${rawEventId}`,
              status: 'FAILED',
              lastErrorCode: errorCode,
              lastErrorMessage: errorMessage,
            })
            .onConflictDoNothing()
            .returning({ id: canonicalLeadEvents.id });
          canonicalId = inserted?.id;
        }

        await tx.update(rawEvents).set({ status: 'FAILED' }).where(eq(rawEvents.id, rawEventId));
        await this.logStage(
          tx,
          tenantId,
          raw.correlationId,
          rawEventId,
          canonicalId,
          'process',
          'PROCESSING',
          'FAILED',
          errorCode,
          errorMessage,
        );
      });
    } catch (recordErr) {
      // double fault: the event stays RECEIVED and a redelivery is handled as a new attempt
      this.logger.error(
        {
          module: 'integrations',
          operation: 'webhook.process.record_failure',
          tenantId,
          rawEventId,
          errorClass: recordErr instanceof Error ? recordErr.name : typeof recordErr,
        },
        'could not record processing failure',
      );
    }
  }

  /** Transaction 2: canonical event + validation + dedupe + CRM lead + outbox. `draft` is already
   *  fully resolved (parsed and, if needed, hydrated) by `resolveDraft` BEFORE this transaction
   *  opens — no adapter call, and in particular no network call, happens inside it. */
  private async processRawEventTx(
    tenantId: string,
    source: typeof leadSources.$inferSelect,
    rawEventId: string,
    draft: CanonicalDraft,
    options: { isReplay?: boolean } = {},
  ): Promise<IngestResult> {
    return withProgressiveContext(getDb(), async (tx, setContext) => {
      await setContext({ tenantId });

      const [raw] = await tx.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)).limit(1);
      const mapped = mapProviderFields(
        draft.providerFields,
        (source.fieldMapping as Record<string, string>) ?? {},
      );

      const normalizedPhone = normalizePhone(mapped.canonical.phone);
      const normalizedEmail = normalizeEmail(mapped.canonical.email);
      // Business idempotency key: the provider's own record id when supplied,
      // otherwise this raw event's own id. Exact-redelivery of the same body is
      // already caught earlier by `raw_events`' hash uniqueness (phase 0) — this
      // key exists to collapse a provider RESENDING the same record id, not to
      // catch "two different submissions from the same person", which is the
      // separate LEAD-level dedupe step below.
      const idempotencyKey = draft.providerRecordId
        ? `record:${draft.providerRecordId}`
        : `raw:${rawEventId}`;

      const values = {
        tenantId,
        rawEventId,
        sourceId: source.id,
        idempotencyKey,
        canonical: mapped.canonical,
        custom: mapped.custom,
        unmapped: mapped.unmapped,
        status: 'PROCESSING' as const,
      };
      const [insertedCanonical] = options.isReplay
        ? await tx
            .insert(canonicalLeadEvents)
            .values(values)
            .onConflictDoUpdate({
              target: [canonicalLeadEvents.tenantId, canonicalLeadEvents.idempotencyKey],
              set: {
                canonical: mapped.canonical,
                custom: mapped.custom,
                unmapped: mapped.unmapped,
                status: 'PROCESSING',
                updatedAt: new Date(),
              },
            })
            .returning()
        : await tx
            .insert(canonicalLeadEvents)
            .values(values)
            .onConflictDoNothing({
              target: [canonicalLeadEvents.tenantId, canonicalLeadEvents.idempotencyKey],
            })
            .returning();

      await this.logStage(
        tx,
        tenantId,
        raw!.correlationId,
        rawEventId,
        undefined,
        'adapt_map',
        'RECEIVED',
        insertedCanonical ? 'PROCESSING' : 'DUPLICATE_EVENT',
      );

      if (!insertedCanonical) {
        // duplicate logical event: this delivery was handled (recorded and matched to the original)
        await tx.update(rawEvents).set({ status: 'PROCESSED' }).where(eq(rawEvents.id, rawEventId));
        const [existing] = await tx
          .select()
          .from(canonicalLeadEvents)
          .where(
            and(
              eq(canonicalLeadEvents.tenantId, tenantId),
              eq(canonicalLeadEvents.idempotencyKey, idempotencyKey),
            ),
          )
          .limit(1);
        return {
          status: 'DUPLICATE_EVENT',
          rawEventId,
          canonicalEventId: existing?.id,
          leadId: existing?.leadId ?? undefined,
          dedupeOutcome: existing?.dedupeOutcome ?? undefined,
        };
      }

      const canonicalEventId = insertedCanonical.id;

      // ---- validate: a lead needs at least one identity field ----------
      if (!normalizedPhone && !normalizedEmail) {
        return this.fail(
          tx,
          tenantId,
          raw!.correlationId,
          rawEventId,
          canonicalEventId,
          'VALIDATION_FAILED',
          'LEAD_MISSING_IDENTITY',
          'The lead has no usable phone number or email address.',
        );
      }

      // ---- validate custom-field mapping BEFORE touching any lead -----
      const customEntries = Object.entries(mapped.custom).filter(([, v]) => v !== undefined);
      let coercedCustom: Awaited<ReturnType<typeof validateCustomFieldValues>> | undefined;
      if (customEntries.length > 0) {
        const defs = await loadActiveCustomFieldDefs(tx, tenantId);
        const values = Object.fromEntries(customEntries) as Record<string, CustomFieldInputValue>;
        const result = validateCustomFieldValues(defs, values);
        if (!result.ok) {
          return this.fail(
            tx,
            tenantId,
            raw!.correlationId,
            rawEventId,
            canonicalEventId,
            'MAPPING_FAILED',
            'CUSTOM_FIELD_MAPPING_INVALID',
            `Field "${result.key}" (${result.reason}) has no valid custom-field mapping for this source.`,
          );
        }
        coercedCustom = result;
      }

      // ---- deduplicate (ADR 0031: exact phone, then exact email) ------
      const existingLeadId = await findDuplicateLead(tx, tenantId, {
        normalizedPhone,
        normalizedEmail,
      });
      let leadId: string;
      let dedupeOutcome: 'new' | 'duplicate_update';

      if (existingLeadId) {
        dedupeOutcome = 'duplicate_update';
        leadId = existingLeadId;
        await enrichExistingLead(
          tx,
          tenantId,
          leadId,
          mapped.canonical,
          normalizedPhone,
          normalizedEmail,
        );
        await recordActivity(tx, {
          tenantId,
          leadId,
          type: 'note',
          actorMembershipId: null,
          payload: {
            system: true,
            message: `Duplicate lead re-ingested from source "${source.name}" — existing lead enriched, no new lead created.`,
            rawEventId,
          },
        });
      } else {
        dedupeOutcome = 'new';
        const [row] = await tx
          .insert(leads)
          .values({
            tenantId,
            sourceId: source.id,
            name: mapped.canonical.name ?? null,
            phone: mapped.canonical.phone ?? null,
            normalizedPhone,
            email: mapped.canonical.email ?? null,
            normalizedEmail,
            addressLine: mapped.canonical.addressLine ?? null,
            city: mapped.canonical.city ?? null,
            state: mapped.canonical.state ?? null,
            postalCode: mapped.canonical.postalCode ?? null,
            country: mapped.canonical.country ?? null,
            origin: 'inbound',
          })
          .returning({ id: leads.id });
        leadId = row!.id;
        await recordActivity(tx, {
          tenantId,
          leadId,
          type: 'created',
          actorMembershipId: null,
          payload: { source: source.name, rawEventId },
        });
      }

      if (coercedCustom?.ok) {
        await persistCoercedCustomFieldValues(tx, tenantId, leadId, coercedCustom.rows);
      }

      await tx
        .update(canonicalLeadEvents)
        .set({ status: 'DONE', leadId, dedupeOutcome, updatedAt: new Date() })
        .where(eq(canonicalLeadEvents.id, canonicalEventId));
      await this.logStage(
        tx,
        tenantId,
        raw!.correlationId,
        rawEventId,
        canonicalEventId,
        'lead_upsert',
        'PROCESSING',
        'DONE',
      );

      await tx.update(rawEvents).set({ status: 'PROCESSED' }).where(eq(rawEvents.id, rawEventId));

      await this.outbox.emit(tx, {
        tenantId,
        type: dedupeOutcome === 'new' ? LEAD_CREATED_EVENT : LEAD_UPDATED_EVENT,
        payload: { leadId, sourceId: source.id, rawEventId, canonicalEventId, dedupeOutcome },
      });

      return { status: 'DONE', rawEventId, canonicalEventId, leadId, dedupeOutcome };
    });
  }

  /** Re-run the pipeline for an already-stored raw event (admin replay). */
  /**
   * Re-run the pipeline for a stored event. Replayable from any terminal
   * state, including `DONE` (docs/architecture/RAW-EVENTS-AND-REPLAY.md
   * "available to admin/support for DEAD_LETTER and (with permission) DONE
   * events") — always idempotent because it upserts the SAME canonical event
   * row (by id) rather than inserting a new one, and lead dedupe is unchanged.
   *
   * Deliberately two transactions: the attempt-count bump must COMMIT before
   * `processRawEvent` opens its own transaction, or the two would deadlock on
   * the same `canonical_lead_events` row (this transaction's own UPDATE lock
   * vs. the nested transaction's upsert on the same unique key).
   */
  async replay(
    tenantId: string,
    canonicalEventId: string,
    actorMembershipId: string | null = null,
  ): Promise<IngestResult> {
    const { source, rawEventId } = await withProgressiveContext(getDb(), async (tx, setContext) => {
      await setContext({ tenantId });
      const [current] = await tx
        .select()
        .from(canonicalLeadEvents)
        .where(
          and(
            eq(canonicalLeadEvents.id, canonicalEventId),
            eq(canonicalLeadEvents.tenantId, tenantId),
          ),
        )
        .limit(1);
      if (!current) throw new AppError('EVENT_NOT_FOUND');
      if (current.status === 'RECEIVED' || current.status === 'PROCESSING') {
        throw new AppError('EVENT_NOT_REPLAYABLE');
      }
      const [sourceRow] = await tx
        .select()
        .from(leadSources)
        .where(and(eq(leadSources.id, current.sourceId), eq(leadSources.tenantId, tenantId)))
        .limit(1);
      if (!sourceRow) throw new AppError('SOURCE_NOT_FOUND');

      await tx
        .update(canonicalLeadEvents)
        .set({
          processingAttempts: current.processingAttempts + 1,
          status: 'PROCESSING',
          updatedAt: new Date(),
        })
        .where(eq(canonicalLeadEvents.id, canonicalEventId));

      if (actorMembershipId) {
        await this.audit.record(tx, {
          tenantId,
          action: 'integration.event.replayed',
          entityType: 'canonical_lead_event',
          entityId: canonicalEventId,
          actor: { type: 'USER', membershipId: actorMembershipId },
          metadata: { sourceId: sourceRow.id, priorStatus: current.status },
        });
      }
      return { source: sourceRow, rawEventId: current.rawEventId };
    });

    return this.processRawEvent(tenantId, source, rawEventId, { isReplay: true });
  }

  /**
   * Meta's one-time subscription handshake (UC-3, ADR 0050) — deliberately separate from the POST
   * ingestion pipeline above: a plain `GET`, no raw event, no adapter, no rate limit, nothing
   * persisted. Resolves the source the SAME way a signature-style POST does (by its globally unique
   * `public_lookup_key`, no bearer secret involved), then compares the caller's `hub.verify_token`
   * against the connector's configured one with a constant-time comparison. Never reveals whether
   * the source key itself exists — a wrong key and a wrong token both just fail.
   */
  async verifyWebhookHandshake(sourceKey: string, verifyToken: string): Promise<boolean> {
    return withProgressiveContext(getDb(), async (tx, setContext) => {
      await setContext({ connectorPublicLookupKey: sourceKey });
      const [source] = await tx
        .select()
        .from(leadSources)
        .where(eq(leadSources.publicLookupKey, sourceKey))
        .limit(1);
      if (!source || source.status === 'revoked') return false;
      await setContext({ tenantId: source.tenantId });
      const credential = await this.credentials.get(tx, source.id);
      const configured = credential.verifyToken;
      if (!configured) return false;
      const a = Buffer.from(configured, 'utf8');
      const b = Buffer.from(verifyToken, 'utf8');
      if (a.length !== b.length) return false;
      return timingSafeEqual(a, b);
    });
  }

  private async fail(
    tx: Tx,
    tenantId: string,
    correlationId: string,
    rawEventId: string,
    canonicalEventId: string,
    status: 'VALIDATION_FAILED' | 'MAPPING_FAILED',
    errorCode: string,
    errorMessage: string,
  ): Promise<IngestResult> {
    // a validation/mapping failure is a terminal FAILED outcome for the raw event too (replayable)
    await tx.update(rawEvents).set({ status: 'FAILED' }).where(eq(rawEvents.id, rawEventId));
    await tx
      .update(canonicalLeadEvents)
      .set({
        status,
        lastErrorCode: errorCode,
        lastErrorMessage: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(canonicalLeadEvents.id, canonicalEventId));
    await this.logStage(
      tx,
      tenantId,
      correlationId,
      rawEventId,
      canonicalEventId,
      'validate',
      'PROCESSING',
      status,
      errorCode,
      errorMessage,
    );
    return { status, rawEventId, canonicalEventId, errorCode, errorMessage };
  }

  private async logStage(
    tx: Tx,
    tenantId: string,
    correlationId: string,
    rawEventId: string,
    canonicalLeadEventId: string | undefined,
    stage: string,
    fromStatus: string | undefined,
    toStatus: string,
    errorCode?: string,
    message?: string,
  ): Promise<void> {
    const { integrationEventLog } = schema;
    await tx.insert(integrationEventLog).values({
      tenantId,
      correlationId,
      rawEventId,
      canonicalLeadEventId: canonicalLeadEventId ?? null,
      stage,
      fromStatus: fromStatus ?? null,
      toStatus,
      errorCode: errorCode ?? null,
      message: message ?? null,
    });
  }
}

/** Conservative enrichment: fills blanks only, never overwrites, never touches status. */
async function enrichExistingLead(
  tx: Tx,
  tenantId: string,
  leadId: string,
  canonical: Partial<
    Record<
      'name' | 'phone' | 'email' | 'addressLine' | 'city' | 'state' | 'postalCode' | 'country',
      string
    >
  >,
  normalizedPhone: string | null,
  normalizedEmail: string | null,
): Promise<void> {
  const [current] = await tx
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.tenantId, tenantId)))
    .limit(1);
  if (!current) return;

  const patch: Record<string, unknown> = {};
  if (!current.name && canonical.name) patch.name = canonical.name;
  if (!current.phone && canonical.phone) {
    patch.phone = canonical.phone;
    patch.normalizedPhone = normalizedPhone;
  }
  if (!current.email && canonical.email) {
    patch.email = canonical.email;
    patch.normalizedEmail = normalizedEmail;
  }
  if (!current.addressLine && canonical.addressLine) patch.addressLine = canonical.addressLine;
  if (!current.city && canonical.city) patch.city = canonical.city;
  if (!current.state && canonical.state) patch.state = canonical.state;
  if (!current.postalCode && canonical.postalCode) patch.postalCode = canonical.postalCode;
  if (!current.country && canonical.country) patch.country = canonical.country;

  if (Object.keys(patch).length > 0) {
    patch.updatedAt = new Date();
    await tx.update(leads).set(patch).where(eq(leads.id, leadId));
  }
}
