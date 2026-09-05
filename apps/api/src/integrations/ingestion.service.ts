import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { getDb, schema, withProgressiveContext, type Tx } from '@aivoryx/db';
import { AppError } from '@aivoryx/shared';
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
import { hashConnectorSecret } from './connector-token.js';
import { mapProviderFields } from './mapping.js';
import { parsePabblyPayload } from './pabbly-adapter.js';
import { hashRawBody } from './raw-hash.js';

const { canonicalLeadEvents, leadSources, leads, rawEvents } = schema;

export const LEAD_CREATED_EVENT = 'lead.created';
export const LEAD_UPDATED_EVENT = 'lead.updated';

export interface InboundRequest {
  sourceKeyFromUrl: string;
  secret: string | null;
  rawBody: unknown;
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

  constructor(private readonly outbox: OutboxService) {}

  async ingest(input: InboundRequest): Promise<IngestResult> {
    if (!input.secret) throw new AppError('CONNECTOR_INVALID');
    const secretHash = hashConnectorSecret(input.secret);

    const resolved = await withProgressiveContext(getDb(), async (tx, setContext) => {
      await setContext({ connectorSecretHash: secretHash });
      const [source] = await tx
        .select()
        .from(leadSources)
        .where(eq(leadSources.secretHash, secretHash))
        .limit(1);
      if (!source) throw new AppError('CONNECTOR_INVALID');
      if (source.key !== input.sourceKeyFromUrl) throw new AppError('CONNECTOR_INVALID');
      if (source.status === 'revoked') throw new AppError('CONNECTOR_REVOKED');

      // Server-derived, never client-supplied — the payload's tenant_id (if any) is ignored.
      await setContext({ tenantId: source.tenantId });

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
        })
        .onConflictDoNothing({
          target: [rawEvents.tenantId, rawEvents.sourceId, rawEvents.rawHash],
        })
        .returning({ id: rawEvents.id });

      if (inserted) {
        return { tenantId: source.tenantId, source, rawEventId: inserted.id, isNewRaw: true };
      }
      const [existing] = await tx
        .select({ id: rawEvents.id })
        .from(rawEvents)
        .where(
          and(
            eq(rawEvents.tenantId, source.tenantId),
            eq(rawEvents.sourceId, source.id),
            eq(rawEvents.rawHash, rawHash),
          ),
        )
        .limit(1);
      return { tenantId: source.tenantId, source, rawEventId: existing!.id, isNewRaw: false };
    });

    if (!resolved.isNewRaw) {
      return withProgressiveContext(getDb(), async (tx, setContext) => {
        await setContext({ tenantId: resolved.tenantId });
        const [existingCanonical] = await tx
          .select()
          .from(canonicalLeadEvents)
          .where(eq(canonicalLeadEvents.rawEventId, resolved.rawEventId))
          .limit(1);
        return {
          status: 'DUPLICATE_RAW',
          rawEventId: resolved.rawEventId,
          canonicalEventId: existingCanonical?.id,
          leadId: existingCanonical?.leadId ?? undefined,
          dedupeOutcome: existingCanonical?.dedupeOutcome ?? undefined,
        };
      });
    }

    return this.processRawEvent(resolved.tenantId, resolved.source, resolved.rawEventId);
  }

  private async processRawEvent(
    tenantId: string,
    source: typeof leadSources.$inferSelect,
    rawEventId: string,
    options: { isReplay?: boolean } = {},
  ): Promise<IngestResult> {
    return withProgressiveContext(getDb(), async (tx, setContext) => {
      await setContext({ tenantId });

      const [raw] = await tx.select().from(rawEvents).where(eq(rawEvents.id, rawEventId)).limit(1);
      const draft = parsePabblyPayload(raw!.rawBody);
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
  async replay(tenantId: string, canonicalEventId: string): Promise<IngestResult> {
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

      return { source: sourceRow, rawEventId: current.rawEventId };
    });

    return this.processRawEvent(tenantId, source, rawEventId, { isReplay: true });
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
