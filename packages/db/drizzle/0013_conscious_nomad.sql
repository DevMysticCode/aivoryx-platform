CREATE TYPE "public"."audit_actor_type" AS ENUM('USER', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."audit_module" AS ENUM('auth', 'identity', 'crm', 'integrations', 'field', 'supply', 'commercial', 'execution', 'notifications', 'finance', 'settings');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_membership_id" uuid,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_source" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"module" "audit_module" NOT NULL,
	"correlation_id" text,
	"request_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changes" jsonb,
	"ip_address" text,
	"user_agent" text,
	CONSTRAINT "audit_logs_actor_shape" CHECK ("actor_type" <> 'SYSTEM' or "actor_membership_id" is null),
	CONSTRAINT "audit_logs_action_format" CHECK ("action" ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$')
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Composite FK keeps a cross-tenant actor impossible at the DB level. On the
-- deletion of an acting membership, null ONLY the actor id (PG 15+ column
-- list) so the NOT NULL tenant_id is preserved and the audit row survives as
-- "a former member did this".
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_fk" FOREIGN KEY ("actor_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE SET NULL ("actor_membership_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_time_idx" ON "audit_logs" USING btree ("tenant_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_actor_time_idx" ON "audit_logs" USING btree ("tenant_id","actor_membership_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_action_time_idx" ON "audit_logs" USING btree ("tenant_id","action","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_entity_time_idx" ON "audit_logs" USING btree ("tenant_id","entity_type","entity_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_module_time_idx" ON "audit_logs" USING btree ("tenant_id","module","occurred_at" DESC NULLS LAST);
--> statement-breakpoint
-- ============================================================================
-- Global Audit Log - append-only security block (Phase 11, ADR 0040).
--
-- The schema-wide default privileges (migration 0003) auto-GRANT
-- SELECT/INSERT/UPDATE/DELETE on every new table to "aivoryx_app". For the
-- audit log we take UPDATE and DELETE back: audit rows are immutable to the
-- application. RLS is ENABLE + FORCE with a tenant-isolated SELECT policy and a
-- tenant-checked INSERT policy. There is deliberately NO update or delete
-- policy, so even a future accidental grant cannot mutate a tenant's history.
-- ============================================================================

REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "audit_logs" TO "aivoryx_app";--> statement-breakpoint

ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS "audit_logs_tenant_select" ON "audit_logs";--> statement-breakpoint
CREATE POLICY "audit_logs_tenant_select" ON "audit_logs"
  FOR SELECT
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

DROP POLICY IF EXISTS "audit_logs_tenant_insert" ON "audit_logs";--> statement-breakpoint
CREATE POLICY "audit_logs_tenant_insert" ON "audit_logs"
  FOR INSERT
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
