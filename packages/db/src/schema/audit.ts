import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';
import { tenants, userTenantMemberships } from './identity.js';

/**
 * Global Audit Log (Phase 11, ADR 0040).
 *
 * A tenant-owned, append-only record of important business & security actions.
 * It is deliberately NOT a trigger-on-every-write mechanism: business modules
 * call the central `AuditService.record(tx, …)` for meaningful state changes,
 * inside the same transaction as the mutation, so a critical mutation can never
 * commit without its audit row.
 *
 * Immutability is enforced in the migration's hand-written block: the runtime
 * `aivoryx_app` role is granted `SELECT, INSERT` only (UPDATE / DELETE are
 * REVOKEd back from the schema-wide default grant), and RLS is ENABLE + FORCE
 * with a tenant-isolated SELECT policy and a tenant-checked INSERT policy — no
 * UPDATE or DELETE policy exists.
 */

/** Who acted: an authenticated tenant member, or trusted server-side system work. */
export const auditActorType = pgEnum('audit_actor_type', ['USER', 'SYSTEM']);

/** The originating platform area — used for filtering and for the UI module badge. */
export const auditModule = pgEnum('audit_module', [
  'auth',
  'identity',
  'crm',
  'integrations',
  'field',
  'supply',
  'commercial',
  'execution',
  'notifications',
  'finance',
  'settings',
]);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => newUuidV7()),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** the membership that performed the action — null for SYSTEM actors */
    actorMembershipId: uuid('actor_membership_id'),
    actorType: auditActorType('actor_type').notNull(),
    /** for SYSTEM actors: the subsystem, e.g. `notification-worker`, `scheduled-job` */
    actorSource: text('actor_source'),
    /** stable action key from the central catalogue, e.g. `finance.invoice.issued` */
    action: text('action').notNull(),
    /** the kind of entity affected, e.g. `invoice`, `lead`, `membership` */
    entityType: text('entity_type').notNull(),
    /** the affected entity's UUID, when it has one */
    entityId: uuid('entity_id'),
    module: auditModule('module').notNull(),
    correlationId: text('correlation_id'),
    requestId: text('request_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    /** safe, intentional key/value context — never secrets, never whole rows */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    /** safe before/after for an approved set of fields: `{ field: { from, to } }` */
    changes: jsonb('changes').$type<Record<string, { from: unknown; to: unknown }>>(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
  },
  (t) => [
    // A SYSTEM action is attributed by `actor_source`, never a membership.
    // (A USER action always supplies its membership at insert time — enforced
    // in `AuditService`; the id may become NULL later if that member is removed,
    // which the actor FK's ON DELETE SET NULL handles, so this check does not
    // couple USER to a non-null membership.)
    check('audit_logs_actor_shape', sql`"actor_type" <> 'SYSTEM' or "actor_membership_id" is null`),
    check('audit_logs_action_format', sql`"action" ~ '^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$'`),
    // The actor membership must belong to THIS tenant — a cross-tenant actor id
    // is rejected by the composite foreign key.
    foreignKey({
      name: 'audit_logs_actor_fk',
      columns: [t.actorMembershipId, t.tenantId],
      foreignColumns: [userTenantMemberships.id, userTenantMemberships.tenantId],
    }).onDelete('set null'),
    index('audit_logs_tenant_time_idx').on(t.tenantId, t.occurredAt.desc()),
    index('audit_logs_tenant_actor_time_idx').on(
      t.tenantId,
      t.actorMembershipId,
      t.occurredAt.desc(),
    ),
    index('audit_logs_tenant_action_time_idx').on(t.tenantId, t.action, t.occurredAt.desc()),
    index('audit_logs_tenant_entity_time_idx').on(
      t.tenantId,
      t.entityType,
      t.entityId,
      t.occurredAt.desc(),
    ),
    index('audit_logs_tenant_module_time_idx').on(t.tenantId, t.module, t.occurredAt.desc()),
  ],
);

export type AuditLogRow = typeof auditLogs.$inferSelect;
export type NewAuditLogRow = typeof auditLogs.$inferInsert;
