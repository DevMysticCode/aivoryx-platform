CREATE TYPE "public"."field_agent_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."lead_origin" AS ENUM('manual', 'inbound', 'field_agent');--> statement-breakpoint
CREATE TYPE "public"."visit_activity_type" AS ENUM('created', 'assigned', 'reassigned', 'rescheduled', 'checked_in', 'survey_started', 'survey_completed', 'photo_uploaded', 'photo_removed', 'note', 'checked_out', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('SCHEDULED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
ALTER TYPE "public"."custom_field_entity" ADD VALUE 'visit';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'visit_scheduled';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'visit_checked_in';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'visit_survey_completed';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'visit_checked_out';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'visit_completed';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'visit_cancelled';--> statement-breakpoint
CREATE TABLE "field_agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"status" "field_agent_status" DEFAULT 'active' NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_agents_tenant_membership_uq" UNIQUE("tenant_id","membership_id"),
	CONSTRAINT "field_agents_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "visit_activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"type" "visit_activity_type" NOT NULL,
	"actor_membership_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text,
	"content_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"uploaded_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_attachments_object_key_uq" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "visit_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"author_membership_id" uuid,
	"body" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"assigned_membership_id" uuid,
	"status" "visit_status" DEFAULT 'SCHEDULED' NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"address_line" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"site_lat" numeric,
	"site_lng" numeric,
	"check_in_lat" numeric,
	"check_in_lng" numeric,
	"check_in_accuracy_m" numeric,
	"check_in_at" timestamp with time zone,
	"check_out_lat" numeric,
	"check_out_lng" numeric,
	"check_out_accuracy_m" numeric,
	"check_out_at" timestamp with time zone,
	"gps_distance_meters" numeric,
	"travel_km" numeric,
	"travel_notes" text,
	"survey_completed_at" timestamp with time zone,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "origin" "lead_origin" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "field_agents" ADD CONSTRAINT "field_agents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_agents" ADD CONSTRAINT "field_agents_membership_fk" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_activities" ADD CONSTRAINT "visit_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_activities" ADD CONSTRAINT "visit_activities_visit_fk" FOREIGN KEY ("visit_id","tenant_id") REFERENCES "public"."visits"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_activities" ADD CONSTRAINT "visit_activities_actor_fk" FOREIGN KEY ("actor_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_attachments" ADD CONSTRAINT "visit_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_attachments" ADD CONSTRAINT "visit_attachments_visit_fk" FOREIGN KEY ("visit_id","tenant_id") REFERENCES "public"."visits"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_attachments" ADD CONSTRAINT "visit_attachments_uploaded_by_fk" FOREIGN KEY ("uploaded_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_visit_fk" FOREIGN KEY ("visit_id","tenant_id") REFERENCES "public"."visits"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_notes" ADD CONSTRAINT "visit_notes_author_fk" FOREIGN KEY ("author_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_lead_fk" FOREIGN KEY ("lead_id","tenant_id") REFERENCES "public"."leads"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_assignee_fk" FOREIGN KEY ("assigned_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "field_agents_tenant_status_idx" ON "field_agents" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "visit_activities_tenant_visit_idx" ON "visit_activities" USING btree ("tenant_id","visit_id","created_at");--> statement-breakpoint
CREATE INDEX "visit_attachments_tenant_visit_idx" ON "visit_attachments" USING btree ("tenant_id","visit_id");--> statement-breakpoint
CREATE INDEX "visit_notes_tenant_visit_idx" ON "visit_notes" USING btree ("tenant_id","visit_id","created_at");--> statement-breakpoint
CREATE INDEX "visits_tenant_lead_idx" ON "visits" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "visits_tenant_assignee_status_idx" ON "visits" USING btree ("tenant_id","assigned_membership_id","status");--> statement-breakpoint
CREATE INDEX "visits_tenant_scheduled_idx" ON "visits" USING btree ("tenant_id","scheduled_at");--> statement-breakpoint

-- Row Level Security for the Phase 4 field-operations tables (ADR 0033).
-- Hand-appended: drizzle-kit does not model RLS, so meta/0006_snapshot.json
-- stays in sync and `db:generate` reports no drift.

GRANT SELECT, INSERT, UPDATE, DELETE ON "field_agents" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "visits" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "visit_activities" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "visit_notes" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "visit_attachments" TO "aivoryx_app";--> statement-breakpoint

ALTER TABLE "field_agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "field_agents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "field_agents_tenant_isolation" ON "field_agents";--> statement-breakpoint
CREATE POLICY "field_agents_tenant_isolation" ON "field_agents"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "visits_tenant_isolation" ON "visits";--> statement-breakpoint
CREATE POLICY "visits_tenant_isolation" ON "visits"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "visit_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visit_activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "visit_activities_tenant_isolation" ON "visit_activities";--> statement-breakpoint
CREATE POLICY "visit_activities_tenant_isolation" ON "visit_activities"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "visit_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visit_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "visit_notes_tenant_isolation" ON "visit_notes";--> statement-breakpoint
CREATE POLICY "visit_notes_tenant_isolation" ON "visit_notes"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "visit_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visit_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "visit_attachments_tenant_isolation" ON "visit_attachments";--> statement-breakpoint
CREATE POLICY "visit_attachments_tenant_isolation" ON "visit_attachments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);