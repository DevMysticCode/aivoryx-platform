import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';
import { tenants, userTenantMemberships } from './identity.js';
import { leadSources } from './integrations.js';

/**
 * CRM core — reusable, industry-neutral Lead domain (Phase 3, ADR 0031).
 *
 * A `lead` is tenant-owned and carries only fields genuinely common across
 * verticals (identity, contact, source, status, assignment, qualification).
 * Anything client/industry-specific (electricity bill, roof type, ...) is a
 * `custom_field_definitions` / `custom_field_values` row, never a column here.
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

// --- lifecycle enums -----------------------------------------------------

/**
 * Deliberately small (CLAUDE.md §17 / phase brief §2 — no general workflow
 * engine). Valid transitions are enforced in application code
 * (`crm/lead-lifecycle.ts`), not by the enum itself.
 */
export const leadStatus = pgEnum('lead_status', [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'QUALIFIED',
  'DISQUALIFIED',
  'CONVERTED',
]);

export const leadActivityType = pgEnum('lead_activity_type', [
  'created',
  'assigned',
  'reassigned',
  'status_changed',
  'note',
  'call_attempt',
  'qualified',
  'disqualified',
  'followup_created',
  'followup_completed',
  // Field operations milestones surfaced onto the lead timeline (Phase 4, ADR
  // 0033) — the detailed visit-level timeline lives in `visit_activities`.
  'visit_scheduled',
  'visit_checked_in',
  'visit_survey_completed',
  'visit_checked_out',
  'visit_completed',
  'visit_cancelled',
  // Commercial milestones surfaced onto the lead timeline (Phase 6, ADR 0035)
  // — the detailed quotation timeline lives in `quotation_activities`.
  'quotation_created',
  'quotation_sent',
  'quotation_accepted',
  'quotation_booked',
  // EPC execution milestone surfaced onto the lead timeline (Phase 7, ADR 0036).
  'project_completed',
]);

export const followupStatus = pgEnum('followup_status', ['pending', 'completed', 'cancelled']);

/** Where a lead came from (Phase 4, ADR 0033) — provenance only, not a second lead model. */
export const leadOrigin = pgEnum('lead_origin', ['manual', 'inbound', 'field_agent']);

export const customFieldEntity = pgEnum('custom_field_entity', ['lead', 'visit']);
export const customFieldDataType = pgEnum('custom_field_data_type', [
  'text',
  'number',
  'boolean',
  'date',
  'select',
]);
export const customFieldStatus = pgEnum('custom_field_status', ['active', 'deprecated']);

// --- leads -----------------------------------------------------------------

export const leads = pgTable(
  'leads',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** the inbound source this lead arrived through; null for manually created leads */
    sourceId: uuid('source_id'),
    name: text('name'),
    /** as provided by the source/user */
    phone: text('phone'),
    /** deterministic dedupe key — see `crm/lead-normalization.ts` */
    normalizedPhone: text('normalized_phone'),
    email: text('email'),
    normalizedEmail: text('normalized_email'),
    addressLine: text('address_line'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),
    status: leadStatus('status').notNull().default('NEW'),
    assignedMembershipId: uuid('assigned_membership_id'),
    /** reason recorded alongside a QUALIFIED or DISQUALIFIED transition */
    qualificationNote: text('qualification_note'),
    /** provenance — 'inbound' is set explicitly by the ingestion pipeline (ADR 0032) */
    origin: leadOrigin('origin').notNull().default('manual'),
    ...entityTimestamps,
  },
  (t) => [
    unique('leads_id_tenant_uq').on(t.id, t.tenantId),
    index('leads_tenant_idx').on(t.tenantId),
    index('leads_tenant_status_idx').on(t.tenantId, t.status),
    index('leads_tenant_assignee_idx').on(t.tenantId, t.assignedMembershipId),
    index('leads_tenant_phone_idx')
      .on(t.tenantId, t.normalizedPhone)
      .where(sql`normalized_phone is not null`),
    index('leads_tenant_email_idx')
      .on(t.tenantId, t.normalizedEmail)
      .where(sql`normalized_email is not null`),
    foreignKey({
      name: 'leads_source_fk',
      columns: [t.sourceId, t.tenantId],
      foreignColumns: [leadSources.id, leadSources.tenantId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'leads_assignee_fk',
      columns: [t.assignedMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- lead_activities (timeline) -------------------------------------------

export const leadActivities = pgTable(
  'lead_activities',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').notNull(),
    type: leadActivityType('type').notNull(),
    /** null = a system/ingestion actor (e.g. lead created by the Pabbly connector) */
    actorMembershipId: uuid('actor_membership_id'),
    /** small structured detail — e.g. { from: 'NEW', to: 'ASSIGNED' }, { note }, { outcome } */
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('lead_activities_tenant_lead_idx').on(t.tenantId, t.leadId, t.createdAt),
    foreignKey({
      name: 'lead_activities_lead_fk',
      columns: [t.leadId, t.tenantId],
      foreignColumns: [leads.id, leads.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lead_activities_actor_fk',
      columns: [t.actorMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- lead_notes --------------------------------------------------------

export const leadNotes = pgTable(
  'lead_notes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').notNull(),
    /** null once the authoring membership is removed — the note itself is kept */
    authorMembershipId: uuid('author_membership_id'),
    body: text('body').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...entityTimestamps,
  },
  (t) => [
    index('lead_notes_tenant_lead_idx').on(t.tenantId, t.leadId, t.createdAt),
    foreignKey({
      name: 'lead_notes_lead_fk',
      columns: [t.leadId, t.tenantId],
      foreignColumns: [leads.id, leads.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lead_notes_author_fk',
      columns: [t.authorMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- lead_followups ------------------------------------------------------

export const leadFollowups = pgTable(
  'lead_followups',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').notNull(),
    assignedMembershipId: uuid('assigned_membership_id'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    status: followupStatus('status').notNull().default('pending'),
    note: text('note'),
    result: text('result'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('lead_followups_tenant_lead_idx').on(t.tenantId, t.leadId),
    index('lead_followups_tenant_assignee_idx').on(t.tenantId, t.assignedMembershipId, t.status),
    index('lead_followups_tenant_due_idx')
      .on(t.tenantId, t.dueAt)
      .where(sql`status = 'pending'`),
    foreignKey({
      name: 'lead_followups_lead_fk',
      columns: [t.leadId, t.tenantId],
      foreignColumns: [leads.id, leads.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lead_followups_assignee_fk',
      columns: [t.assignedMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- custom fields (generic — decision: no elaborate form-builder) -------

export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    entity: customFieldEntity('entity').notNull().default('lead'),
    key: text('key').notNull(),
    label: text('label').notNull(),
    dataType: customFieldDataType('data_type').notNull(),
    isRequired: boolean('is_required').notNull().default(false),
    /** `select` option list: string[] */
    options: jsonb('options'),
    status: customFieldStatus('status').notNull().default('active'),
    ...entityTimestamps,
  },
  (t) => [
    unique('custom_field_definitions_tenant_entity_key_uq').on(t.tenantId, t.entity, t.key),
    unique('custom_field_definitions_id_tenant_uq').on(t.id, t.tenantId),
    index('custom_field_definitions_tenant_idx').on(t.tenantId, t.entity),
  ],
);

/**
 * Narrow typed-column EAV (docs/architecture/CUSTOM-FIELDS.md). `entityId` is a
 * polymorphic reference (the `entity` column says what kind); it deliberately
 * carries no FK of its own — RLS scopes it by `tenant_id` directly, and V1 has
 * exactly one entity (`lead`), so a hard FK would need revisiting the moment a
 * second entity is added anyway.
 */
export const customFieldValues = pgTable(
  'custom_field_values',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    entity: customFieldEntity('entity').notNull().default('lead'),
    entityId: uuid('entity_id').notNull(),
    definitionId: uuid('definition_id').notNull(),
    valueText: text('value_text'),
    valueNumber: numeric('value_number'),
    valueBoolean: boolean('value_boolean'),
    valueDate: date('value_date'),
    ...entityTimestamps,
  },
  (t) => [
    unique('custom_field_values_tenant_entity_record_def_uq').on(
      t.tenantId,
      t.entity,
      t.entityId,
      t.definitionId,
    ),
    index('custom_field_values_tenant_entity_idx').on(t.tenantId, t.entity, t.entityId),
    foreignKey({
      name: 'custom_field_values_definition_fk',
      columns: [t.definitionId, t.tenantId],
      foreignColumns: [customFieldDefinitions.id, customFieldDefinitions.tenantId],
    }).onDelete('cascade'),
  ],
);

// --- crm_saved_views (Phase 13C) --------------------------------------
//
// A named lead-list filter configuration, owned by one membership within one
// tenant. Tenant-owned (RLS isolates by `tenant_id`); per-user isolation is a
// `membership_id = <actor>` predicate in the service (the established pattern —
// RLS has no membership binding). `config` is an opaque JSON blob the CRM UI
// owns; the server validates only its shape (an object), never its keys.

export const crmSavedViews = pgTable(
  'crm_saved_views',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** the membership that owns this view */
    membershipId: uuid('membership_id').notNull(),
    name: text('name').notNull(),
    /** UI-owned filter/sort/view blob, e.g. { status, assignedMembershipId, source, followup, q, board } */
    config: jsonb('config').notNull().default({}),
    sortOrder: numeric('sort_order').notNull().default('0'),
    ...entityTimestamps,
  },
  (t) => [
    unique('crm_saved_views_owner_name_uq').on(t.tenantId, t.membershipId, t.name),
    index('crm_saved_views_tenant_member_idx').on(t.tenantId, t.membershipId),
    foreignKey({
      name: 'crm_saved_views_member_fk',
      columns: [t.membershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('cascade'),
  ],
);

export type CrmSavedViewRow = typeof crmSavedViews.$inferSelect;
export type NewCrmSavedViewRow = typeof crmSavedViews.$inferInsert;

export type LeadRow = typeof leads.$inferSelect;
export type NewLeadRow = typeof leads.$inferInsert;
export type LeadActivityRow = typeof leadActivities.$inferSelect;
export type NewLeadActivityRow = typeof leadActivities.$inferInsert;
export type LeadNoteRow = typeof leadNotes.$inferSelect;
export type NewLeadNoteRow = typeof leadNotes.$inferInsert;
export type LeadFollowupRow = typeof leadFollowups.$inferSelect;
export type NewLeadFollowupRow = typeof leadFollowups.$inferInsert;
export type CustomFieldDefinitionRow = typeof customFieldDefinitions.$inferSelect;
export type NewCustomFieldDefinitionRow = typeof customFieldDefinitions.$inferInsert;
export type CustomFieldValueRow = typeof customFieldValues.$inferSelect;
export type NewCustomFieldValueRow = typeof customFieldValues.$inferInsert;
