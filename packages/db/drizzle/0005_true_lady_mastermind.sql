CREATE TYPE "public"."canonical_event_status" AS ENUM('RECEIVED', 'PROCESSING', 'VALIDATION_FAILED', 'MAPPING_FAILED', 'NEEDS_REVIEW', 'DONE', 'FAILED', 'DEAD_LETTER');--> statement-breakpoint
CREATE TYPE "public"."connector_type" AS ENUM('pabbly_bridge');--> statement-breakpoint
CREATE TYPE "public"."custom_field_data_type" AS ENUM('text', 'number', 'boolean', 'date', 'select');--> statement-breakpoint
CREATE TYPE "public"."custom_field_entity" AS ENUM('lead');--> statement-breakpoint
CREATE TYPE "public"."custom_field_status" AS ENUM('active', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."followup_status" AS ENUM('pending', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lead_activity_type" AS ENUM('created', 'assigned', 'reassigned', 'status_changed', 'note', 'call_attempt', 'qualified', 'disqualified', 'followup_created', 'followup_completed');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('NEW', 'ASSIGNED', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED');--> statement-breakpoint
CREATE TYPE "public"."raw_event_status" AS ENUM('RECEIVED', 'PROCESSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TABLE "canonical_lead_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"canonical" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"custom" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"unmapped" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "canonical_event_status" DEFAULT 'RECEIVED' NOT NULL,
	"lead_id" uuid,
	"dedupe_outcome" text,
	"processing_attempts" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "canonical_lead_events_tenant_idempotency_uq" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "canonical_lead_events_raw_event_uq" UNIQUE("raw_event_id"),
	CONSTRAINT "canonical_lead_events_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" "custom_field_entity" DEFAULT 'lead' NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"data_type" "custom_field_data_type" NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"options" jsonb,
	"status" "custom_field_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_definitions_tenant_entity_key_uq" UNIQUE("tenant_id","entity","key"),
	CONSTRAINT "custom_field_definitions_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "custom_field_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" "custom_field_entity" DEFAULT 'lead' NOT NULL,
	"entity_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"value_text" text,
	"value_number" numeric,
	"value_boolean" boolean,
	"value_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_field_values_tenant_entity_record_def_uq" UNIQUE("tenant_id","entity","entity_id","definition_id")
);
--> statement-breakpoint
CREATE TABLE "integration_event_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"correlation_id" text NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"canonical_lead_event_id" uuid,
	"stage" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"error_code" text,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"type" "lead_activity_type" NOT NULL,
	"actor_membership_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_followups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"assigned_membership_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"status" "followup_status" DEFAULT 'pending' NOT NULL,
	"note" text,
	"result" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"author_membership_id" uuid,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"connector_type" "connector_type" DEFAULT 'pabbly_bridge' NOT NULL,
	"status" "source_status" DEFAULT 'active' NOT NULL,
	"secret_hash" text NOT NULL,
	"field_mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_sources_tenant_key_uq" UNIQUE("tenant_id","key"),
	CONSTRAINT "lead_sources_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "lead_sources_secret_hash_uq" UNIQUE("secret_hash")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid,
	"name" text,
	"phone" text,
	"normalized_phone" text,
	"email" text,
	"normalized_email" text,
	"address_line" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"status" "lead_status" DEFAULT 'NEW' NOT NULL,
	"assigned_membership_id" uuid,
	"qualification_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"correlation_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_body" jsonb NOT NULL,
	"raw_hash" text NOT NULL,
	"transport_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "raw_event_status" DEFAULT 'RECEIVED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_events_tenant_source_hash_uq" UNIQUE("tenant_id","source_id","raw_hash"),
	CONSTRAINT "raw_events_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "canonical_lead_events" ADD CONSTRAINT "canonical_lead_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_lead_events" ADD CONSTRAINT "canonical_lead_events_raw_event_fk" FOREIGN KEY ("raw_event_id","tenant_id") REFERENCES "public"."raw_events"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "canonical_lead_events" ADD CONSTRAINT "canonical_lead_events_source_fk" FOREIGN KEY ("source_id","tenant_id") REFERENCES "public"."lead_sources"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_fk" FOREIGN KEY ("definition_id","tenant_id") REFERENCES "public"."custom_field_definitions"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_log" ADD CONSTRAINT "integration_event_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_log" ADD CONSTRAINT "integration_event_log_raw_event_fk" FOREIGN KEY ("raw_event_id","tenant_id") REFERENCES "public"."raw_events"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_event_log" ADD CONSTRAINT "integration_event_log_canonical_event_fk" FOREIGN KEY ("canonical_lead_event_id","tenant_id") REFERENCES "public"."canonical_lead_events"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_fk" FOREIGN KEY ("lead_id","tenant_id") REFERENCES "public"."leads"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_actor_fk" FOREIGN KEY ("actor_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_lead_fk" FOREIGN KEY ("lead_id","tenant_id") REFERENCES "public"."leads"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_followups" ADD CONSTRAINT "lead_followups_assignee_fk" FOREIGN KEY ("assigned_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_lead_fk" FOREIGN KEY ("lead_id","tenant_id") REFERENCES "public"."leads"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_author_fk" FOREIGN KEY ("author_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_source_fk" FOREIGN KEY ("source_id","tenant_id") REFERENCES "public"."lead_sources"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assignee_fk" FOREIGN KEY ("assigned_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_source_fk" FOREIGN KEY ("source_id","tenant_id") REFERENCES "public"."lead_sources"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "canonical_lead_events_tenant_status_idx" ON "canonical_lead_events" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "canonical_lead_events_tenant_lead_idx" ON "canonical_lead_events" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "custom_field_definitions_tenant_idx" ON "custom_field_definitions" USING btree ("tenant_id","entity");--> statement-breakpoint
CREATE INDEX "custom_field_values_tenant_entity_idx" ON "custom_field_values" USING btree ("tenant_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "integration_event_log_tenant_raw_idx" ON "integration_event_log" USING btree ("tenant_id","raw_event_id","created_at");--> statement-breakpoint
CREATE INDEX "integration_event_log_tenant_correlation_idx" ON "integration_event_log" USING btree ("tenant_id","correlation_id");--> statement-breakpoint
CREATE INDEX "lead_activities_tenant_lead_idx" ON "lead_activities" USING btree ("tenant_id","lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_followups_tenant_lead_idx" ON "lead_followups" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "lead_followups_tenant_assignee_idx" ON "lead_followups" USING btree ("tenant_id","assigned_membership_id","status");--> statement-breakpoint
CREATE INDEX "lead_followups_tenant_due_idx" ON "lead_followups" USING btree ("tenant_id","due_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "lead_notes_tenant_lead_idx" ON "lead_notes" USING btree ("tenant_id","lead_id","created_at");--> statement-breakpoint
CREATE INDEX "lead_sources_tenant_idx" ON "lead_sources" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "leads_tenant_idx" ON "leads" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "leads_tenant_status_idx" ON "leads" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "leads_tenant_assignee_idx" ON "leads" USING btree ("tenant_id","assigned_membership_id");--> statement-breakpoint
CREATE INDEX "leads_tenant_phone_idx" ON "leads" USING btree ("tenant_id","normalized_phone") WHERE normalized_phone is not null;--> statement-breakpoint
CREATE INDEX "leads_tenant_email_idx" ON "leads" USING btree ("tenant_id","normalized_email") WHERE normalized_email is not null;--> statement-breakpoint
CREATE INDEX "raw_events_tenant_source_idx" ON "raw_events" USING btree ("tenant_id","source_id","received_at");--> statement-breakpoint

-- Row Level Security for the Phase 3 CRM + inbound integration tables
-- (ADR 0031 / 0032). Hand-appended: drizzle-kit does not model RLS, so
-- meta/0005_snapshot.json stays in sync and `db:generate` reports no drift.

GRANT SELECT, INSERT, UPDATE, DELETE ON "leads" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "lead_activities" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "lead_notes" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "lead_followups" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_field_definitions" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_field_values" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "lead_sources" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "raw_events" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "canonical_lead_events" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "integration_event_log" TO "aivoryx_app";--> statement-breakpoint

ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "leads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "leads_tenant_isolation" ON "leads";--> statement-breakpoint
CREATE POLICY "leads_tenant_isolation" ON "leads"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "lead_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead_activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "lead_activities_tenant_isolation" ON "lead_activities";--> statement-breakpoint
CREATE POLICY "lead_activities_tenant_isolation" ON "lead_activities"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "lead_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "lead_notes_tenant_isolation" ON "lead_notes";--> statement-breakpoint
CREATE POLICY "lead_notes_tenant_isolation" ON "lead_notes"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "lead_followups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead_followups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "lead_followups_tenant_isolation" ON "lead_followups";--> statement-breakpoint
CREATE POLICY "lead_followups_tenant_isolation" ON "lead_followups"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "custom_field_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "custom_field_definitions_tenant_isolation" ON "custom_field_definitions";--> statement-breakpoint
CREATE POLICY "custom_field_definitions_tenant_isolation" ON "custom_field_definitions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "custom_field_values_tenant_isolation" ON "custom_field_values";--> statement-breakpoint
CREATE POLICY "custom_field_values_tenant_isolation" ON "custom_field_values"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "raw_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "raw_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "raw_events_tenant_isolation" ON "raw_events";--> statement-breakpoint
CREATE POLICY "raw_events_tenant_isolation" ON "raw_events"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "canonical_lead_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "canonical_lead_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "canonical_lead_events_tenant_isolation" ON "canonical_lead_events";--> statement-breakpoint
CREATE POLICY "canonical_lead_events_tenant_isolation" ON "canonical_lead_events"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "integration_event_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_event_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "integration_event_log_tenant_isolation" ON "integration_event_log";--> statement-breakpoint
CREATE POLICY "integration_event_log_tenant_isolation" ON "integration_event_log"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- lead_sources carries BOTH the normal tenant-isolation policy (for the
-- authenticated admin surface) and a by-secret-hash policy (mirrors
-- `tenant_invitations_by_token`, ADR 0030) for the public, pre-tenant-context
-- Pabbly webhook: it binds `app.connector_secret_hash` to the token it holds,
-- and this policy then exposes exactly the one matching source row.
ALTER TABLE "lead_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "lead_sources_tenant_isolation" ON "lead_sources";--> statement-breakpoint
CREATE POLICY "lead_sources_tenant_isolation" ON "lead_sources"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
DROP POLICY IF EXISTS "lead_sources_by_secret" ON "lead_sources";--> statement-breakpoint
CREATE POLICY "lead_sources_by_secret" ON "lead_sources"
  USING ("secret_hash" = nullif(current_setting('app.connector_secret_hash', true), ''))
  WITH CHECK ("secret_hash" = nullif(current_setting('app.connector_secret_hash', true), ''));