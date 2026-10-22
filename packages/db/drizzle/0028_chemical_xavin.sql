CREATE TABLE "platform_audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"correlation_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "platform_audit_logs_action_format" CHECK ("action" ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$')
);
--> statement-breakpoint
ALTER TABLE "platform_audit_logs" ADD CONSTRAINT "platform_audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_logs_time_idx" ON "platform_audit_logs" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "platform_audit_logs_action_time_idx" ON "platform_audit_logs" USING btree ("action","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "platform_audit_logs_entity_time_idx" ON "platform_audit_logs" USING btree ("entity_type","entity_id","occurred_at" DESC NULLS LAST);
--> statement-breakpoint
-- ============================================================================
-- Platform Audit Log - append-only + platform-admin-only block (Production
-- Operations & Customer Launch Readiness milestone), mirroring migration
-- 0013's audit_logs block exactly, except the access check is "caller has a
-- platform_admins row" (via app.user_id) instead of tenant_id equality, since
-- this table has no tenant to scope by — a platform-level action (e.g.
-- Aivoryx's own white-label branding) has no tenant to attribute to.
--
-- The schema-wide default privileges (migration 0003) auto-GRANT
-- SELECT/INSERT/UPDATE/DELETE on every new table to "aivoryx_app". We take
-- UPDATE and DELETE back: rows are immutable to the application. RLS is
-- ENABLE + FORCE with a platform-admin-only SELECT policy and a
-- platform-admin-only INSERT policy. There is deliberately NO update or
-- delete policy, so even a future accidental grant cannot mutate history.
-- ============================================================================

REVOKE UPDATE, DELETE, TRUNCATE ON "platform_audit_logs" FROM "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT ON "platform_audit_logs" TO "aivoryx_app";--> statement-breakpoint

ALTER TABLE "platform_audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_audit_logs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

DROP POLICY IF EXISTS "platform_audit_logs_admin_select" ON "platform_audit_logs";--> statement-breakpoint
CREATE POLICY "platform_audit_logs_admin_select" ON "platform_audit_logs"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "platform_admins" pa
      WHERE pa."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );--> statement-breakpoint

DROP POLICY IF EXISTS "platform_audit_logs_admin_insert" ON "platform_audit_logs";--> statement-breakpoint
CREATE POLICY "platform_audit_logs_admin_insert" ON "platform_audit_logs"
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "platform_admins" pa
      WHERE pa."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );