import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { leads } from './crm.js';

/**
 * Field Operations (Phase 4, ADR 0033). A business domain built ON the
 * existing platform — no second user/tenant/permission/lead/custom-field/
 * outbox/storage mechanism. A "field agent" is a capability flag on an
 * existing `user_tenant_memberships` row, not a new identity; a "visit" is
 * tenant-owned and always references an existing `leads` row.
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

export const fieldAgentStatus = pgEnum('field_agent_status', ['active', 'inactive']);

/**
 * Deliberately small (no general workflow engine). `RESCHEDULED` is NOT a
 * status — rescheduling changes `scheduled_at` on a still-`SCHEDULED`/
 * `ASSIGNED` visit and is recorded as a `rescheduled` activity; see ADR 0033.
 */
export const visitStatus = pgEnum('visit_status', [
  'SCHEDULED',
  'ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
]);

export const visitActivityType = pgEnum('visit_activity_type', [
  'created',
  'assigned',
  'reassigned',
  'rescheduled',
  'checked_in',
  'survey_started',
  'survey_completed',
  'photo_uploaded',
  'photo_removed',
  'note',
  'checked_out',
  'completed',
  'cancelled',
]);

// --- field_agents ----------------------------------------------------------

/**
 * The minimum reusable "is this membership a field agent" capability flag.
 * No employee master, no payroll/attendance — that is a future HR phase.
 */
export const fieldAgents = pgTable(
  'field_agents',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id').notNull(),
    status: fieldAgentStatus('status').notNull().default('active'),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    ...entityTimestamps,
  },
  (t) => [
    unique('field_agents_tenant_membership_uq').on(t.tenantId, t.membershipId),
    unique('field_agents_id_tenant_uq').on(t.id, t.tenantId),
    index('field_agents_tenant_status_idx').on(t.tenantId, t.status),
    foreignKey({
      name: 'field_agents_membership_fk',
      columns: [t.membershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('cascade'),
  ],
);

// --- visits ----------------------------------------------------------------

export const visits = pgTable(
  'visits',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    leadId: uuid('lead_id').notNull(),
    assignedMembershipId: uuid('assigned_membership_id'),
    status: visitStatus('status').notNull().default('SCHEDULED'),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),

    /** site address — snapshotted from the lead at scheduling time, editable */
    addressLine: text('address_line'),
    city: text('city'),
    state: text('state'),
    postalCode: text('postal_code'),
    country: text('country'),
    /** optional known site coordinates — no geocoding is performed; may be null */
    siteLat: numeric('site_lat'),
    siteLng: numeric('site_lng'),

    checkInLat: numeric('check_in_lat'),
    checkInLng: numeric('check_in_lng'),
    checkInAccuracyM: numeric('check_in_accuracy_m'),
    checkInAt: timestamp('check_in_at', { withTimezone: true }),

    checkOutLat: numeric('check_out_lat'),
    checkOutLng: numeric('check_out_lng'),
    checkOutAccuracyM: numeric('check_out_accuracy_m'),
    checkOutAt: timestamp('check_out_at', { withTimezone: true }),

    /** straight-line metres between `site_lat/lng` and the check-in point, when both exist */
    gpsDistanceMeters: numeric('gps_distance_meters'),
    /** operator-entered odometer/travel distance — never assumed equal to GPS distance */
    travelKm: numeric('travel_km'),
    travelNotes: text('travel_notes'),

    surveyCompletedAt: timestamp('survey_completed_at', { withTimezone: true }),

    createdByMembershipId: uuid('created_by_membership_id').notNull(),
    ...entityTimestamps,
  },
  (t) => [
    unique('visits_id_tenant_uq').on(t.id, t.tenantId),
    index('visits_tenant_lead_idx').on(t.tenantId, t.leadId),
    index('visits_tenant_assignee_status_idx').on(t.tenantId, t.assignedMembershipId, t.status),
    index('visits_tenant_scheduled_idx').on(t.tenantId, t.scheduledAt),
    foreignKey({
      name: 'visits_lead_fk',
      columns: [t.leadId, t.tenantId],
      foreignColumns: [leads.id, leads.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'visits_assignee_fk',
      columns: [t.assignedMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    foreignKey({
      name: 'visits_created_by_fk',
      columns: [t.createdByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('restrict'),
  ],
);

// --- visit_activities (timeline) -------------------------------------------

export const visitActivities = pgTable(
  'visit_activities',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    visitId: uuid('visit_id').notNull(),
    type: visitActivityType('type').notNull(),
    actorMembershipId: uuid('actor_membership_id'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    index('visit_activities_tenant_visit_idx').on(t.tenantId, t.visitId, t.createdAt),
    foreignKey({
      name: 'visit_activities_visit_fk',
      columns: [t.visitId, t.tenantId],
      foreignColumns: [visits.id, visits.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'visit_activities_actor_fk',
      columns: [t.actorMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- visit_notes -------------------------------------------------------

export const visitNotes = pgTable(
  'visit_notes',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    visitId: uuid('visit_id').notNull(),
    authorMembershipId: uuid('author_membership_id'),
    body: text('body').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...entityTimestamps,
  },
  (t) => [
    index('visit_notes_tenant_visit_idx').on(t.tenantId, t.visitId, t.createdAt),
    foreignKey({
      name: 'visit_notes_visit_fk',
      columns: [t.visitId, t.tenantId],
      foreignColumns: [visits.id, visits.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'visit_notes_author_fk',
      columns: [t.authorMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- visit_attachments ---------------------------------------------------

/**
 * Metadata only — the object storage service (`apps/api/src/storage`) holds
 * the actual bytes. `objectKey` is a tenant-prefixed path, never a public URL.
 */
export const visitAttachments = pgTable(
  'visit_attachments',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    visitId: uuid('visit_id').notNull(),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename'),
    contentType: text('content_type').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    uploadedByMembershipId: uuid('uploaded_by_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('visit_attachments_object_key_uq').on(t.objectKey),
    index('visit_attachments_tenant_visit_idx').on(t.tenantId, t.visitId),
    foreignKey({
      name: 'visit_attachments_visit_fk',
      columns: [t.visitId, t.tenantId],
      foreignColumns: [visits.id, visits.tenantId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'visit_attachments_uploaded_by_fk',
      columns: [t.uploadedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

export type FieldAgentRow = typeof fieldAgents.$inferSelect;
export type NewFieldAgentRow = typeof fieldAgents.$inferInsert;
export type VisitRow = typeof visits.$inferSelect;
export type NewVisitRow = typeof visits.$inferInsert;
export type VisitActivityRow = typeof visitActivities.$inferSelect;
export type NewVisitActivityRow = typeof visitActivities.$inferInsert;
export type VisitNoteRow = typeof visitNotes.$inferSelect;
export type NewVisitNoteRow = typeof visitNotes.$inferInsert;
export type VisitAttachmentRow = typeof visitAttachments.$inferSelect;
export type NewVisitAttachmentRow = typeof visitAttachments.$inferInsert;
