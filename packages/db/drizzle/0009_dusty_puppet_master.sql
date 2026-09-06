CREATE TYPE "public"."checklist_item_status" AS ENUM('pending', 'done', 'na');--> statement-breakpoint
CREATE TYPE "public"."checklist_kind" AS ENUM('installation', 'qc', 'handover');--> statement-breakpoint
CREATE TYPE "public"."defect_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."defect_status" AS ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'VERIFIED');--> statement-breakpoint
CREATE TYPE "public"."execution_attachment_entity" AS ENUM('installation', 'qc', 'defect', 'net_metering', 'handover');--> statement-breakpoint
CREATE TYPE "public"."handover_status" AS ENUM('PENDING', 'READY', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."installation_status" AS ENUM('UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."net_metering_status" AS ENUM('NOT_STARTED', 'DOCUMENTS_PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."project_milestone_key" AS ENUM('PLANNING', 'MATERIAL_READY', 'INSTALLATION_SCHEDULED', 'INSTALLATION_STARTED', 'INSTALLATION_COMPLETED', 'QC_PENDING', 'QC_PASSED', 'NET_METERING', 'HANDOVER_READY', 'HANDED_OVER', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."project_milestone_status" AS ENUM('pending', 'in_progress', 'done', 'skipped', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."qc_inspection_status" AS ENUM('PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'project_completed';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'execution_started';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'milestone_completed';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'installation_assigned';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'installation_started';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'installation_completed';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'qc_created';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'qc_passed';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'qc_failed';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'defect_created';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'defect_resolved';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'net_metering_updated';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'net_metering_submitted';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'net_metering_approved';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'handover_completed';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'completed';--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "checklist_kind" NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "checklist_templates_tenant_kind_label_uq" UNIQUE("tenant_id","kind","label")
);
--> statement-breakpoint
CREATE TABLE "project_checklist_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"inspection_id" uuid,
	"template_id" uuid,
	"kind" "checklist_kind" NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"status" "checklist_item_status" DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_membership_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_checklist_items_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "project_defects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"inspection_id" uuid,
	"description" text NOT NULL,
	"severity" "defect_severity" DEFAULT 'medium' NOT NULL,
	"status" "defect_status" DEFAULT 'OPEN' NOT NULL,
	"assigned_membership_id" uuid,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_defects_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "project_execution_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"entity_kind" "execution_attachment_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text,
	"content_type" text NOT NULL,
	"file_size" bigint NOT NULL,
	"uploaded_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_execution_attachments_object_key_uq" UNIQUE("object_key")
);
--> statement-breakpoint
CREATE TABLE "project_handover" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "handover_status" DEFAULT 'PENDING' NOT NULL,
	"notes" text,
	"customer_acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledged_by_name" text,
	"handover_at" timestamp with time zone,
	"handed_over_by_membership_id" uuid,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_handover_tenant_project_uq" UNIQUE("tenant_id","project_id"),
	CONSTRAINT "project_handover_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "project_installations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "installation_status" DEFAULT 'UNASSIGNED' NOT NULL,
	"assigned_membership_id" uuid,
	"assigned_at" timestamp with time zone,
	"assigned_by_membership_id" uuid,
	"visit_id" uuid,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"start_lat" numeric,
	"start_lng" numeric,
	"complete_lat" numeric,
	"complete_lng" numeric,
	"notes" text,
	"equipment_installed" text,
	"issues" text,
	"material_override" boolean DEFAULT false NOT NULL,
	"material_override_by_membership_id" uuid,
	"material_override_reason" text,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_installations_tenant_project_uq" UNIQUE("tenant_id","project_id"),
	CONSTRAINT "project_installations_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "project_milestones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"key" "project_milestone_key" NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "project_milestone_status" DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by_membership_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_milestones_tenant_project_key_uq" UNIQUE("tenant_id","project_id","key"),
	CONSTRAINT "project_milestones_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "project_net_metering" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "net_metering_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"not_required" boolean DEFAULT false NOT NULL,
	"reference_number" text,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_net_metering_tenant_project_uq" UNIQUE("tenant_id","project_id"),
	CONSTRAINT "project_net_metering_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "project_qc_inspections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"seq" integer DEFAULT 1 NOT NULL,
	"status" "qc_inspection_status" DEFAULT 'PENDING' NOT NULL,
	"inspector_membership_id" uuid,
	"inspected_at" timestamp with time zone,
	"notes" text,
	"result_note" text,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_qc_inspections_tenant_project_seq_uq" UNIQUE("tenant_id","project_id","seq"),
	CONSTRAINT "project_qc_inspections_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_checklist_items" ADD CONSTRAINT "project_checklist_items_completed_by_fk" FOREIGN KEY ("completed_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_defects" ADD CONSTRAINT "project_defects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_defects" ADD CONSTRAINT "project_defects_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_defects" ADD CONSTRAINT "project_defects_inspection_fk" FOREIGN KEY ("inspection_id","tenant_id") REFERENCES "public"."project_qc_inspections"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_defects" ADD CONSTRAINT "project_defects_assignee_fk" FOREIGN KEY ("assigned_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_defects" ADD CONSTRAINT "project_defects_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_execution_attachments" ADD CONSTRAINT "project_execution_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_execution_attachments" ADD CONSTRAINT "project_execution_attachments_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_execution_attachments" ADD CONSTRAINT "project_execution_attachments_uploaded_by_fk" FOREIGN KEY ("uploaded_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handover" ADD CONSTRAINT "project_handover_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handover" ADD CONSTRAINT "project_handover_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handover" ADD CONSTRAINT "project_handover_handed_over_by_fk" FOREIGN KEY ("handed_over_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_handover" ADD CONSTRAINT "project_handover_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_installations" ADD CONSTRAINT "project_installations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_installations" ADD CONSTRAINT "project_installations_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_installations" ADD CONSTRAINT "project_installations_assignee_fk" FOREIGN KEY ("assigned_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_installations" ADD CONSTRAINT "project_installations_visit_fk" FOREIGN KEY ("visit_id","tenant_id") REFERENCES "public"."visits"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_installations" ADD CONSTRAINT "project_installations_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_completed_by_fk" FOREIGN KEY ("completed_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_net_metering" ADD CONSTRAINT "project_net_metering_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_net_metering" ADD CONSTRAINT "project_net_metering_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_net_metering" ADD CONSTRAINT "project_net_metering_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_qc_inspections" ADD CONSTRAINT "project_qc_inspections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_qc_inspections" ADD CONSTRAINT "project_qc_inspections_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_qc_inspections" ADD CONSTRAINT "project_qc_inspections_inspector_fk" FOREIGN KEY ("inspector_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_qc_inspections" ADD CONSTRAINT "project_qc_inspections_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_templates_tenant_kind_idx" ON "checklist_templates" USING btree ("tenant_id","kind","is_active");--> statement-breakpoint
CREATE INDEX "project_checklist_items_tenant_project_kind_idx" ON "project_checklist_items" USING btree ("tenant_id","project_id","kind");--> statement-breakpoint
CREATE INDEX "project_checklist_items_tenant_inspection_idx" ON "project_checklist_items" USING btree ("tenant_id","inspection_id");--> statement-breakpoint
CREATE INDEX "project_defects_tenant_project_status_idx" ON "project_defects" USING btree ("tenant_id","project_id","status");--> statement-breakpoint
CREATE INDEX "project_defects_tenant_assignee_idx" ON "project_defects" USING btree ("tenant_id","assigned_membership_id","status");--> statement-breakpoint
CREATE INDEX "project_execution_attachments_tenant_project_entity_idx" ON "project_execution_attachments" USING btree ("tenant_id","project_id","entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "project_installations_tenant_assignee_idx" ON "project_installations" USING btree ("tenant_id","assigned_membership_id","status");--> statement-breakpoint
CREATE INDEX "project_milestones_tenant_project_idx" ON "project_milestones" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "project_net_metering_tenant_status_idx" ON "project_net_metering" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "project_qc_inspections_tenant_project_idx" ON "project_qc_inspections" USING btree ("tenant_id","project_id","status");
--> statement-breakpoint

-- Row-Level Security for the Phase 7 EPC-execution tables (ADR 0036, following
-- the ADR 0027 / 0030 pattern): non-privileged app-role grants, ENABLE + FORCE
-- RLS, and a tenant-isolation policy matching the per-transaction app.tenant_id GUC.

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_milestones" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "project_milestones" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_milestones" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "project_milestones_tenant_isolation" ON "project_milestones";--> statement-breakpoint
CREATE POLICY "project_milestones_tenant_isolation" ON "project_milestones"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_installations" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "project_installations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_installations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "project_installations_tenant_isolation" ON "project_installations";--> statement-breakpoint
CREATE POLICY "project_installations_tenant_isolation" ON "project_installations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "checklist_templates" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "checklist_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "checklist_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "checklist_templates_tenant_isolation" ON "checklist_templates";--> statement-breakpoint
CREATE POLICY "checklist_templates_tenant_isolation" ON "checklist_templates"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_checklist_items" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "project_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_checklist_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "project_checklist_items_tenant_isolation" ON "project_checklist_items";--> statement-breakpoint
CREATE POLICY "project_checklist_items_tenant_isolation" ON "project_checklist_items"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_qc_inspections" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "project_qc_inspections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_qc_inspections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "project_qc_inspections_tenant_isolation" ON "project_qc_inspections";--> statement-breakpoint
CREATE POLICY "project_qc_inspections_tenant_isolation" ON "project_qc_inspections"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_defects" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "project_defects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_defects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "project_defects_tenant_isolation" ON "project_defects";--> statement-breakpoint
CREATE POLICY "project_defects_tenant_isolation" ON "project_defects"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_net_metering" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "project_net_metering" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_net_metering" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "project_net_metering_tenant_isolation" ON "project_net_metering";--> statement-breakpoint
CREATE POLICY "project_net_metering_tenant_isolation" ON "project_net_metering"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_handover" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "project_handover" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_handover" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "project_handover_tenant_isolation" ON "project_handover";--> statement-breakpoint
CREATE POLICY "project_handover_tenant_isolation" ON "project_handover"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_execution_attachments" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "project_execution_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_execution_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "project_execution_attachments_tenant_isolation" ON "project_execution_attachments";--> statement-breakpoint
CREATE POLICY "project_execution_attachments_tenant_isolation" ON "project_execution_attachments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
