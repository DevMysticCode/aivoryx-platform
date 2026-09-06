import { sql } from 'drizzle-orm';
import {
  boolean,
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
import { tenants, userTenantMemberships } from './identity.js';

/**
 * Notifications & Communications Engine (Phase 8, ADR 0037).
 *
 * A provider-neutral, cross-cutting platform capability:
 *
 *   business/outbox event -> notification rule -> recipient resolution ->
 *   template render -> channel adapter -> delivery record
 *
 * Built ON the existing platform. It reuses the transactional `outbox_events`
 * table (no second event bus), Redis + BullMQ (no second queue), the object
 * storage / structured logging / error envelope / OpenAPI infrastructure, and
 * the RBAC catalogue. It is NOT a workflow/automation engine — there is no
 * arbitrary IF/THEN. System default rules + templates live in code
 * (`@aivoryx/shared`); a tenant row here is an *override* of a default, keyed
 * by a stable key, so a tenant can enable/disable/re-word notifications
 * without an application change.
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

// --- enums ---------------------------------------------------------------

/** Delivery channels. `in_app` + `email` are functional this phase;
 *  `whatsapp` + `sms` are interface-only adapters (no vendor coupling). */
export const notificationChannel = pgEnum('notification_channel', [
  'in_app',
  'email',
  'whatsapp',
  'sms',
]);

/** Generic, industry-neutral notification semantics — never solar/EPC-specific. */
export const notificationType = pgEnum('notification_type', [
  'info',
  'success',
  'warning',
  'action_required',
]);

export const notificationDeliveryStatus = pgEnum('notification_delivery_status', [
  'pending',
  'processing',
  'sent',
  'failed',
  'cancelled',
]);

/** How a rule chooses recipients. Explicit + type-safe — no scripting. */
export const notificationRecipientStrategy = pgEnum('notification_recipient_strategy', [
  'USER',
  'ACTOR',
  'ASSIGNED_USER',
  'ROLE',
  'CUSTOMER',
]);

// --- notification_templates (tenant overrides; defaults live in code) ---

/**
 * A tenant's override of a system default template, addressed by
 * `(key, channel)`. Bodies are plain text with safe `{{ path }}` interpolation
 * only — no executable template code, no raw HTML authoring (the email channel
 * renders the text to escaped, sanitised HTML). Absence of a row => the code
 * default is used.
 */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** stable template key, matches a code default (e.g. `quotation_sent`) */
    key: text('key').notNull(),
    channel: notificationChannel('channel').notNull(),
    /** notification title / in-app heading */
    title: text('title').notNull(),
    /** in-app body (also the fallback body for other channels) */
    body: text('body').notNull(),
    /** email channel only */
    emailSubject: text('email_subject'),
    emailBody: text('email_body'),
    isActive: boolean('is_active').notNull().default(true),
    updatedByMembershipId: uuid('updated_by_membership_id'),
    ...entityTimestamps,
  },
  (t) => [
    unique('notification_templates_tenant_key_channel_uq').on(t.tenantId, t.key, t.channel),
    unique('notification_templates_id_tenant_uq').on(t.id, t.tenantId),
    index('notification_templates_tenant_key_idx').on(t.tenantId, t.key),
    foreignKey({
      name: 'notification_templates_updated_by_fk',
      columns: [t.updatedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- notification_rules (tenant overrides; defaults live in code) -------

/**
 * A tenant's override of a system default rule, addressed by `key`. The
 * default defines the event type, template, channels, recipient strategy and
 * whether it is suppressible; a tenant row can currently toggle `is_active`
 * and narrow `channels`. No arbitrary conditions.
 */
export const notificationRules = pgTable(
  'notification_rules',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** stable rule key, matches a code default (e.g. `quotation_sent.customer.email`) */
    key: text('key').notNull(),
    eventType: text('event_type').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    /** null => use the default rule's channels; otherwise a subset of them */
    channels: notificationChannel('channels').array(),
    updatedByMembershipId: uuid('updated_by_membership_id'),
    ...entityTimestamps,
  },
  (t) => [
    unique('notification_rules_tenant_key_uq').on(t.tenantId, t.key),
    index('notification_rules_tenant_event_idx').on(t.tenantId, t.eventType),
    foreignKey({
      name: 'notification_rules_updated_by_fk',
      columns: [t.updatedByMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- notification_preferences -----------------------------------------

/** Per-membership channel opt-outs. Absence of a row => all channels enabled.
 *  A rule marked non-suppressible ignores these (system-critical). */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id').notNull(),
    inAppEnabled: boolean('in_app_enabled').notNull().default(true),
    emailEnabled: boolean('email_enabled').notNull().default(true),
    ...entityTimestamps,
  },
  (t) => [
    unique('notification_preferences_tenant_membership_uq').on(t.tenantId, t.membershipId),
    foreignKey({
      name: 'notification_preferences_membership_fk',
      columns: [t.membershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('cascade'),
  ],
);

// --- notifications (the persistent, in-app-visible notification) --------

/**
 * One row per (source event x rule x recipient). `dedupe_key` makes that
 * identity unique so an outbox replay / worker retry / duplicate queue
 * delivery never creates a second notification. A row with
 * `recipient_membership_id` set shows in that user's bell; a customer-email
 * notification has only `recipient_email` and exists purely for delivery
 * tracking.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key').notNull(),
    recipientMembershipId: uuid('recipient_membership_id'),
    recipientEmail: text('recipient_email'),
    type: notificationType('type').notNull().default('info'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** in-app click-through target, an app-relative path */
    deepLink: text('deep_link'),
    sourceEventId: uuid('source_event_id'),
    sourceEventType: text('source_event_type'),
    ruleKey: text('rule_key'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => [
    unique('notifications_tenant_dedupe_uq').on(t.tenantId, t.dedupeKey),
    unique('notifications_id_tenant_uq').on(t.id, t.tenantId),
    index('notifications_tenant_recipient_idx').on(t.tenantId, t.recipientMembershipId, t.readAt),
    index('notifications_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('notifications_tenant_source_event_idx').on(t.tenantId, t.sourceEventId),
    foreignKey({
      name: 'notifications_recipient_fk',
      columns: [t.recipientMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
  ],
);

// --- notification_deliveries (per-channel delivery state) --------------

/**
 * The business-facing source of truth for a channel delivery attempt.
 * `idempotency_key` = hash(sourceEventId + ruleKey + recipientRef + channel),
 * uniquely constrained per tenant, so the worker/queue can retry freely.
 * Provider secrets are never stored here — only a provider name + its opaque
 * message id.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    notificationId: uuid('notification_id').notNull(),
    channel: notificationChannel('channel').notNull(),
    /** membership id or email address, depending on channel */
    recipientRef: text('recipient_ref').notNull(),
    provider: text('provider'),
    status: notificationDeliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    idempotencyKey: text('idempotency_key').notNull(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    providerMessageId: text('provider_message_id'),
    /** small, safe context echoed from the engine (never the raw event payload) */
    meta: jsonb('meta'),
    ...entityTimestamps,
  },
  (t) => [
    unique('notification_deliveries_tenant_idem_uq').on(t.tenantId, t.idempotencyKey),
    index('notification_deliveries_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('notification_deliveries_tenant_notification_idx').on(t.tenantId, t.notificationId),
    foreignKey({
      name: 'notification_deliveries_notification_fk',
      columns: [t.notificationId, t.tenantId],
      foreignColumns: [notifications.id, notifications.tenantId],
    }).onDelete('cascade'),
  ],
);

// --- row types --------------------------------------------------------

export type NotificationTemplateRow = typeof notificationTemplates.$inferSelect;
export type NewNotificationTemplateRow = typeof notificationTemplates.$inferInsert;
export type NotificationRuleRow = typeof notificationRules.$inferSelect;
export type NewNotificationRuleRow = typeof notificationRules.$inferInsert;
export type NotificationPreferenceRow = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferenceRow = typeof notificationPreferences.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
export type NotificationDeliveryRow = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDeliveryRow = typeof notificationDeliveries.$inferInsert;
