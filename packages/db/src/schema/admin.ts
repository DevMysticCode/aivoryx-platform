import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';
import { tenants, userTenantMemberships, users } from './identity.js';

/**
 * Tenant administration & user lifecycle (Phase 2 Task 3 — ADR 0030).
 *
 * - `tenant_invitations` — provider-neutral, single-use, tenant- and
 *   membership-bound onboarding tokens. Only the SHA-256 hash of the token is
 *   stored. Tenant-owned; RLS added in migration `0004`.
 * - `outbox_events` — the transactional outbox (ADR 0013). An event is written
 *   in the same transaction as the state change; a future dispatcher (Integration
 *   Engine) delivers it. Tenant-owned; RLS added in migration `0004`.
 */

export const invitationStatus = pgEnum('invitation_status', ['pending', 'accepted', 'revoked']);

const createdAt = timestamp('created_at', { withTimezone: true })
  .notNull()
  .default(sql`now()`);

// --- tenant_invitations ------------------------------------------------

export const tenantInvitations = pgTable(
  'tenant_invitations',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** the `invited` membership this invitation activates */
    membershipId: uuid('membership_id').notNull(),
    /** denormalised for display + the pre-tenant accept lookup */
    email: text('email').notNull(),
    /** hex SHA-256 of the one-time token; the token itself is never stored */
    tokenHash: text('token_hash').notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`)
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('tenant_invitations_token_hash_uq').on(t.tokenHash),
    // at most one pending invitation per membership
    uniqueIndex('tenant_invitations_pending_membership_uq')
      .on(t.membershipId)
      .where(sql`status = 'pending'`),
    // composite FK: the invitation and its membership share a tenant
    foreignKey({
      name: 'tenant_invitations_membership_fk',
      columns: [t.membershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('cascade'),
    index('tenant_invitations_tenant_idx').on(t.tenantId),
    index('tenant_invitations_membership_idx').on(t.membershipId),
    index('tenant_invitations_status_idx').on(t.status),
  ],
);

// --- outbox_events (ADR 0013) ----------------------------------------

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** provider-neutral event type, e.g. `user.invitation.created` */
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    correlationId: text('correlation_id'),
    /** the membership that caused the event, when known — lets a downstream
     *  consumer (e.g. the notification engine's ACTOR strategy) resolve the
     *  acting user without trusting the payload. Optional; older callers omit it. */
    actorMembershipId: uuid('actor_membership_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** set by the future dispatcher once the event has been delivered */
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [
    index('outbox_events_tenant_idx').on(t.tenantId),
    index('outbox_events_type_idx').on(t.type),
    // the dispatcher's work queue: undelivered events, oldest first
    index('outbox_events_undispatched_idx')
      .on(t.occurredAt)
      .where(sql`dispatched_at is null`),
  ],
);

export type TenantInvitationRow = typeof tenantInvitations.$inferSelect;
export type NewTenantInvitationRow = typeof tenantInvitations.$inferInsert;
export type OutboxEventRow = typeof outboxEvents.$inferSelect;
export type NewOutboxEventRow = typeof outboxEvents.$inferInsert;
