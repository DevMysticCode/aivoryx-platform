CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'whatsapp', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_delivery_status" AS ENUM('pending', 'processing', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."notification_recipient_strategy" AS ENUM('USER', 'ACTOR', 'ASSIGNED_USER', 'ROLE', 'CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('info', 'success', 'warning', 'action_required');--> statement-breakpoint
CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"recipient_ref" text NOT NULL,
	"provider" text,
	"status" "notification_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"idempotency_key" text NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failure_code" text,
	"failure_message" text,
	"provider_message_id" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_tenant_idem_uq" UNIQUE("tenant_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"in_app_enabled" boolean DEFAULT true NOT NULL,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_tenant_membership_uq" UNIQUE("tenant_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "notification_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"event_type" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"channels" "notification_channel"[],
	"updated_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_rules_tenant_key_uq" UNIQUE("tenant_id","key")
);
--> statement-breakpoint
CREATE TABLE "notification_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"email_subject" text,
	"email_body" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_templates_tenant_key_channel_uq" UNIQUE("tenant_id","key","channel"),
	CONSTRAINT "notification_templates_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"recipient_membership_id" uuid,
	"recipient_email" text,
	"type" "notification_type" DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"deep_link" text,
	"source_event_id" uuid,
	"source_event_type" text,
	"rule_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_tenant_dedupe_uq" UNIQUE("tenant_id","dedupe_key"),
	CONSTRAINT "notifications_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "outbox_events" ADD COLUMN "actor_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_fk" FOREIGN KEY ("notification_id","tenant_id") REFERENCES "public"."notifications"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_membership_fk" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_rules" ADD CONSTRAINT "notification_rules_updated_by_fk" FOREIGN KEY ("updated_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_templates" ADD CONSTRAINT "notification_templates_updated_by_fk" FOREIGN KEY ("updated_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_fk" FOREIGN KEY ("recipient_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_tenant_status_idx" ON "notification_deliveries" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "notification_deliveries_tenant_notification_idx" ON "notification_deliveries" USING btree ("tenant_id","notification_id");--> statement-breakpoint
CREATE INDEX "notification_rules_tenant_event_idx" ON "notification_rules" USING btree ("tenant_id","event_type");--> statement-breakpoint
CREATE INDEX "notification_templates_tenant_key_idx" ON "notification_templates" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "notifications_tenant_recipient_idx" ON "notifications" USING btree ("tenant_id","recipient_membership_id","read_at");--> statement-breakpoint
CREATE INDEX "notifications_tenant_created_idx" ON "notifications" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_tenant_source_event_idx" ON "notifications" USING btree ("tenant_id","source_event_id");
--> statement-breakpoint

-- Row-Level Security for the Phase 8 notification tables (ADR 0037, following
-- the ADR 0027 / 0030 pattern): non-privileged app-role grants, ENABLE + FORCE
-- RLS, and a tenant-isolation policy matching the per-transaction app.tenant_id
-- GUC. USING + WITH CHECK both fail closed when no tenant context is set.

GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_templates" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "notification_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "notification_templates_tenant_isolation" ON "notification_templates";--> statement-breakpoint
CREATE POLICY "notification_templates_tenant_isolation" ON "notification_templates"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_rules" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "notification_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "notification_rules_tenant_isolation" ON "notification_rules";--> statement-breakpoint
CREATE POLICY "notification_rules_tenant_isolation" ON "notification_rules"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_preferences" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "notification_preferences_tenant_isolation" ON "notification_preferences";--> statement-breakpoint
CREATE POLICY "notification_preferences_tenant_isolation" ON "notification_preferences"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "notifications_tenant_isolation" ON "notifications";--> statement-breakpoint
CREATE POLICY "notifications_tenant_isolation" ON "notifications"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_deliveries" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "notification_deliveries_tenant_isolation" ON "notification_deliveries";--> statement-breakpoint
CREATE POLICY "notification_deliveries_tenant_isolation" ON "notification_deliveries"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- Outbox dispatcher context (ADR 0037 "System worker security"). The async
-- notification dispatcher must read undelivered `outbox_events` across tenants
-- and stamp `dispatched_at`; it never mutates business data. It runs with the
-- non-privileged `aivoryx_app` role and sets `app.outbox_dispatcher = 'on'`
-- (a server-only GUC — no client can reach set_config). These two extra
-- policies grant ONLY cross-tenant SELECT + the dispatched_at UPDATE on this
-- one table; all per-tenant work still runs under `app.tenant_id`.
DROP POLICY IF EXISTS "outbox_events_dispatcher_read" ON "outbox_events";--> statement-breakpoint
CREATE POLICY "outbox_events_dispatcher_read" ON "outbox_events"
  FOR SELECT
  USING (current_setting('app.outbox_dispatcher', true) = 'on');--> statement-breakpoint
DROP POLICY IF EXISTS "outbox_events_dispatcher_mark" ON "outbox_events";--> statement-breakpoint
CREATE POLICY "outbox_events_dispatcher_mark" ON "outbox_events"
  FOR UPDATE
  USING (current_setting('app.outbox_dispatcher', true) = 'on')
  WITH CHECK (current_setting('app.outbox_dispatcher', true) = 'on');
