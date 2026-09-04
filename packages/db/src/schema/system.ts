import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newUuidV7 } from '../id.js';

/**
 * Infrastructure-only table. It exists so Phase 1 can prove that migrations
 * apply and that a UUIDv7 primary key round-trips through PostgreSQL.
 *
 * This is NOT a business table. The real platform schema (tenants, users,
 * roles, ...) is created in Phase 2. Do not add columns here for domain use.
 */
export const systemProbe = pgTable('system_probe', {
  id: uuid('id')
    .primaryKey()
    .$defaultFn(() => newUuidV7()),
  note: text('note').notNull().default('phase-1 infra probe'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type SystemProbeRow = typeof systemProbe.$inferSelect;
