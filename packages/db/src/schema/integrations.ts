import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';
import { tenants } from './identity.js';

/**
 * Inbound integration engine — provider-neutral (Phase 3, ADR 0031/0032).
 *
 * Pipeline: Source(`lead_sources`) -> Connector (transport auth) -> Adapter
 * (provider shape) -> Mapping -> `raw_events` + `canonical_lead_events` ->
 * validate -> deduplicate -> Lead. See docs/architecture/LEAD-INGESTION.md,
 * CONNECTORS-AND-ADAPTERS.md, RAW-EVENTS-AND-REPLAY.md, PABBLY-BRIDGE.md.
 *
 * This is the INBOUND direction (external system -> Aivoryx). It is a
 * deliberately separate table set from the existing transactional `outbox_events`
 * (Aivoryx -> external system, ADR 0013) — not a second outbox mechanism.
 */

const entityTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
};

// V1 ships exactly one connector type. Extensible without a data migration.
export const connectorType = pgEnum('connector_type', ['pabbly_bridge']);
export const sourceStatus = pgEnum('source_status', ['active', 'revoked']);
export const rawEventStatus = pgEnum('raw_event_status', ['RECEIVED', 'PROCESSED', 'FAILED']);

/**
 * The fine-grained pipeline status (docs/architecture/RAW-EVENTS-AND-REPLAY.md
 * "state model", trimmed to what V1 actually distinguishes). `DEAD_LETTER` is a
 * status here rather than a separate table — see ADR 0032 for that
 * simplification and its rationale.
 */
export const canonicalEventStatus = pgEnum('canonical_event_status', [
  'RECEIVED',
  'PROCESSING',
  'VALIDATION_FAILED',
  'MAPPING_FAILED',
  'NEEDS_REVIEW',
  'DONE',
  'FAILED',
  'DEAD_LETTER',
]);

// --- lead_sources (Source + Connector credential) -------------------------

export const leadSources = pgTable(
  'lead_sources',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** short slug, unique per tenant; echoed in the webhook URL for readability only */
    key: text('key').notNull(),
    name: text('name').notNull(),
    connectorType: connectorType('connector_type').notNull().default('pabbly_bridge'),
    status: sourceStatus('status').notNull().default('active'),
    /** hex SHA-256 of the connector's bearer secret — the actual authenticator */
    secretHash: text('secret_hash').notNull(),
    /** provider-field -> "canonical:<field>" | "custom:<key>" override dictionary (ADR 0032) */
    fieldMapping: jsonb('field_mapping').notNull().default({}),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...entityTimestamps,
  },
  (t) => [
    unique('lead_sources_tenant_key_uq').on(t.tenantId, t.key),
    unique('lead_sources_id_tenant_uq').on(t.id, t.tenantId),
    // GLOBAL uniqueness: the secret hash alone must resolve to exactly one
    // tenant — this is what the by-secret RLS policy relies on (ADR 0032).
    unique('lead_sources_secret_hash_uq').on(t.secretHash),
    index('lead_sources_tenant_idx').on(t.tenantId),
  ],
);

// --- raw_events --------------------------------------------------------

export const rawEvents = pgTable(
  'raw_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').notNull(),
    correlationId: text('correlation_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** the untouched inbound body, never mutated after insert */
    rawBody: jsonb('raw_body').notNull(),
    /** sha-256 of the canonicalised raw body — exact-redelivery detection */
    rawHash: text('raw_hash').notNull(),
    transportMetadata: jsonb('transport_metadata').notNull().default({}),
    status: rawEventStatus('status').notNull().default('RECEIVED'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    // DB-enforced idempotency for an exact-duplicate delivery of the same event.
    unique('raw_events_tenant_source_hash_uq').on(t.tenantId, t.sourceId, t.rawHash),
    unique('raw_events_id_tenant_uq').on(t.id, t.tenantId),
    index('raw_events_tenant_source_idx').on(t.tenantId, t.sourceId, t.receivedAt),
    foreignKey({
      name: 'raw_events_source_fk',
      columns: [t.sourceId, t.tenantId],
      foreignColumns: [leadSources.id, leadSources.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- canonical_lead_events -----------------------------------------------

export const canonicalLeadEvents = pgTable(
  'canonical_lead_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    rawEventId: uuid('raw_event_id').notNull(),
    sourceId: uuid('source_id').notNull(),
    /** provider_record_id when present, else sha256(source+normalised identity) */
    idempotencyKey: text('idempotency_key').notNull(),
    canonical: jsonb('canonical').notNull().default({}),
    custom: jsonb('custom').notNull().default({}),
    unmapped: jsonb('unmapped').notNull().default({}),
    status: canonicalEventStatus('status').notNull().default('RECEIVED'),
    /**
     * Correlation-only pointer to the resulting lead. No FK: leads and
     * canonical events are in separate schema modules with independent
     * lifecycles; RLS already scopes both by `tenant_id`.
     */
    leadId: uuid('lead_id'),
    dedupeOutcome: text('dedupe_outcome'),
    processingAttempts: integer('processing_attempts').notNull().default(0),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    ...entityTimestamps,
  },
  (t) => [
    // DB-enforced business idempotency: one canonical event per logical lead event.
    unique('canonical_lead_events_tenant_idempotency_uq').on(t.tenantId, t.idempotencyKey),
    unique('canonical_lead_events_raw_event_uq').on(t.rawEventId),
    unique('canonical_lead_events_id_tenant_uq').on(t.id, t.tenantId),
    index('canonical_lead_events_tenant_status_idx').on(t.tenantId, t.status),
    index('canonical_lead_events_tenant_lead_idx').on(t.tenantId, t.leadId),
    foreignKey({
      name: 'canonical_lead_events_raw_event_fk',
      columns: [t.rawEventId, t.tenantId],
      foreignColumns: [rawEvents.id, rawEvents.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'canonical_lead_events_source_fk',
      columns: [t.sourceId, t.tenantId],
      foreignColumns: [leadSources.id, leadSources.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- integration_event_log (append-only stage trace) ----------------------

export const integrationEventLog = pgTable(
  'integration_event_log',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    correlationId: text('correlation_id').notNull(),
    rawEventId: uuid('raw_event_id').notNull(),
    canonicalLeadEventId: uuid('canonical_lead_event_id'),
    stage: text('stage').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    errorCode: text('error_code'),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('integration_event_log_tenant_raw_idx').on(t.tenantId, t.rawEventId, t.createdAt),
    index('integration_event_log_tenant_correlation_idx').on(t.tenantId, t.correlationId),
    foreignKey({
      name: 'integration_event_log_raw_event_fk',
      columns: [t.rawEventId, t.tenantId],
      foreignColumns: [rawEvents.id, rawEvents.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'integration_event_log_canonical_event_fk',
      columns: [t.canonicalLeadEventId, t.tenantId],
      foreignColumns: [canonicalLeadEvents.id, canonicalLeadEvents.tenantId],
    }).onDelete('cascade'),
  ],
);

export type LeadSourceRow = typeof leadSources.$inferSelect;
export type NewLeadSourceRow = typeof leadSources.$inferInsert;
export type RawEventRow = typeof rawEvents.$inferSelect;
export type NewRawEventRow = typeof rawEvents.$inferInsert;
export type CanonicalLeadEventRow = typeof canonicalLeadEvents.$inferSelect;
export type NewCanonicalLeadEventRow = typeof canonicalLeadEvents.$inferInsert;
export type IntegrationEventLogRow = typeof integrationEventLog.$inferSelect;
export type NewIntegrationEventLogRow = typeof integrationEventLog.$inferInsert;
