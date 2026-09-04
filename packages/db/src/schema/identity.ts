import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';

/**
 * Identity & tenancy core (Phase 2, Task 1).
 *
 * Conceptual model:
 *   user ──< user_tenant_memberships >── tenant
 *   session ──> user, and optionally ──> one active user_tenant_membership
 *
 * A user is a single global identity. Its relationship to a tenant is ALWAYS an
 * explicit `user_tenant_memberships` row — there is deliberately no `tenant_id`
 * on `users` (ADR 0026). A session operates against at most one tenant at a
 * time via `sessions.active_membership_id`; a composite foreign key guarantees
 * that membership belongs to the session's own user. Authorization
 * (roles/permissions) hangs off the membership, not the user — see `./rbac.ts`.
 *
 * This module defines schema only. No RLS, no auth, no RBAC enforcement, no
 * seed data — those are later Phase 2 tasks (ADR 0009, 0011, 0026).
 */

// --- lifecycle enums -------------------------------------------------------
// Minimal platform-lifecycle states that authentication must consult. Not
// business status. New values are added by migration when a flow needs them.

export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);
// `invited` (Phase 2 Task 3): a membership created by an admin invitation that
// the user has not accepted yet. It is not a usable membership until accepted.
export const membershipStatus = pgEnum('membership_status', ['active', 'suspended', 'invited']);

// --- shared column groups ------------------------------------------------

/** created_at + updated_at for mutable entities. `updated_at` is maintained by
 *  the app/ORM layer (`$onUpdate`) as well as carrying a DB default. */
const entityTimestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`)
    .$onUpdate(() => new Date()),
};

// --- tenants -------------------------------------------------------------

/**
 * A tenant (customer workspace). The root of every tenant-owned record.
 * `tenants` itself is not tenant-owned and gets no `tenant_id` / RLS.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    /** URL/-config-safe stable handle, e.g. `acme`. Generic, not a business name. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: tenantStatus('status').notNull().default('active'),
    ...entityTimestamps,
  },
  (t) => [uniqueIndex('tenants_slug_uq').on(t.slug)],
);

// --- users ------------------------------------------------------------------

/**
 * A global person/identity. One row per human, regardless of how many tenants
 * they belong to.
 *
 * `password_hash` holds a full **Argon2id PHC string**
 * (`$argon2id$v=19$m=...,t=...,p=...$<salt>$<hash>`) — algorithm, parameters and
 * per-hash salt are all embedded, so there is no separate salt/params column and
 * never any plaintext. It is nullable: a user can exist before a password is set
 * (e.g. invited). Authentication itself is NOT implemented here (ADR 0010).
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    email: text('email').notNull(),
    /** display name; nullable — set on invitation acceptance or by the user later */
    name: text('name'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    passwordHash: text('password_hash'),
    passwordUpdatedAt: timestamp('password_updated_at', { withTimezone: true }),
    status: userStatus('status').notNull().default('active'),
    ...entityTimestamps,
  },
  (t) => [
    // Case-insensitive uniqueness without the citext extension.
    uniqueIndex('users_email_lower_uq').on(sql`lower(${t.email})`),
  ],
);

// --- user_tenant_memberships --------------------------------------------

/**
 * The explicit link between a user and a tenant. Tenant-owned (carries
 * `tenant_id`; RLS is added in the later RLS task). Roles are attached to the
 * membership in `./rbac.ts` (`membership_roles`).
 *
 * Two extra composite unique constraints exist only as foreign-key targets:
 * `unique(id, tenant_id)` lets `membership_roles` / `role_permissions`
 * guarantee a membership and its roles share a tenant; `unique(user_id, id)`
 * lets `sessions.active_membership_id` guarantee the active membership belongs
 * to the session's own user.
 */
export const userTenantMemberships = pgTable(
  'user_tenant_memberships',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    status: membershipStatus('status').notNull().default('active'),
    ...entityTimestamps,
  },
  (t) => [
    unique('user_tenant_memberships_user_tenant_uq').on(t.userId, t.tenantId),
    unique('user_tenant_memberships_id_tenant_uq').on(t.id, t.tenantId),
    unique('user_tenant_memberships_user_id_id_uq').on(t.userId, t.id),
    index('user_tenant_memberships_tenant_idx').on(t.tenantId),
    index('user_tenant_memberships_user_idx').on(t.userId),
  ],
);

// --- sessions -------------------------------------------------------------

/**
 * A server-side authentication session. PostgreSQL is the authoritative session
 * store (ADR 0010). The cookie carries an opaque random token; only its
 * SHA-256 **hash** is stored here, so a database leak does not yield usable
 * sessions (same principle as passwords).
 *
 * A session belongs to one user and operates against at most one tenant at a
 * time, referenced by `active_membership_id` (nullable — a session can exist
 * before a tenant is selected, e.g. pre-login or single-tenant users mid-setup).
 * The composite foreign key `(user_id, active_membership_id) ->
 * user_tenant_memberships(user_id, id)` makes it structurally impossible for a
 * session to point at another user's membership (ADR 0026). With PostgreSQL's
 * default `MATCH SIMPLE`, a NULL `active_membership_id` skips the check.
 * `ON DELETE CASCADE`: removing a user from a tenant ends sessions that were
 * active in it. This column — never an `X-Tenant-Id` header — is the
 * authoritative active-tenant selector.
 *
 * `expires_at` (absolute) + `revoked_at` support expiry/revocation;
 * `last_seen_at` supports idle timeout.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** hex SHA-256 of the opaque cookie token; never the token itself */
    tokenHash: text('token_hash').notNull(),
    /** the one tenant membership this session currently acts in; NULL = none selected */
    activeMembershipId: uuid('active_membership_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
    index('sessions_active_membership_idx').on(t.activeMembershipId),
    foreignKey({
      name: 'sessions_active_membership_fk',
      columns: [t.userId, t.activeMembershipId],
      foreignColumns: [userTenantMemberships.userId, userTenantMemberships.id],
    }).onDelete('cascade'),
  ],
);

export type TenantRow = typeof tenants.$inferSelect;
export type NewTenantRow = typeof tenants.$inferInsert;
export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserTenantMembershipRow = typeof userTenantMemberships.$inferSelect;
export type NewUserTenantMembershipRow = typeof userTenantMemberships.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSessionRow = typeof sessions.$inferInsert;
