CREATE TYPE "public"."customer_status" AS ENUM('prospect', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."quotation_activity_type" AS ENUM('created', 'updated', 'revised', 'sent', 'accepted', 'cancelled', 'expired', 'booked');--> statement-breakpoint
CREATE TYPE "public"."quotation_revision_status" AS ENUM('draft', 'sent', 'accepted', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."quotation_status" AS ENUM('DRAFT', 'SENT', 'ACCEPTED', 'BOOKED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'quotation_created';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'quotation_sent';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'quotation_accepted';--> statement-breakpoint
ALTER TYPE "public"."lead_activity_type" ADD VALUE 'quotation_booked';--> statement-breakpoint
ALTER TYPE "public"."project_activity_type" ADD VALUE 'booked';--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"normalized_phone" text,
	"email" text,
	"normalized_email" text,
	"address_line" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country" text,
	"site_address_line" text,
	"site_city" text,
	"site_state" text,
	"site_postal_code" text,
	"site_country" text,
	"tax_reference" text,
	"notes" text,
	"status" "customer_status" DEFAULT 'prospect' NOT NULL,
	"lead_id" uuid,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_tenant_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "customers_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "quotation_activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"type" "quotation_activity_type" NOT NULL,
	"actor_membership_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"original_filename" text,
	"content_type" text NOT NULL,
	"file_size" integer NOT NULL,
	"uploaded_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotation_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"revision_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid,
	"description" text NOT NULL,
	"unit_label" text,
	"quantity" numeric(18, 4) DEFAULT '0' NOT NULL,
	"unit_price" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_rate" numeric(9, 6) DEFAULT '0' NOT NULL,
	"line_net" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_tax" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_lines_tenant_revision_line_uq" UNIQUE("tenant_id","revision_id","line_no"),
	CONSTRAINT "quotation_lines_qty_nonneg" CHECK ("quantity" >= 0),
	CONSTRAINT "quotation_lines_money_nonneg" CHECK ("unit_price" >= 0 and "discount" >= 0 and "tax_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotation_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quotation_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"status" "quotation_revision_status" DEFAULT 'draft' NOT NULL,
	"issue_date" timestamp with time zone,
	"validity_date" timestamp with time zone,
	"notes" text,
	"subtotal" numeric(18, 2) DEFAULT '0' NOT NULL,
	"discount_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"accepted_by_membership_id" uuid,
	"acceptance_note" text,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotation_revisions_tenant_quotation_no_uq" UNIQUE("tenant_id","quotation_id","revision_no"),
	CONSTRAINT "quotation_revisions_id_tenant_uq" UNIQUE("id","tenant_id"),
	CONSTRAINT "quotation_revisions_no_positive" CHECK ("revision_no" >= 1),
	CONSTRAINT "quotation_revisions_money_nonneg" CHECK ("subtotal" >= 0 and "discount_total" >= 0 and "tax_total" >= 0 and "total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quotations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"lead_id" uuid NOT NULL,
	"customer_id" uuid,
	"project_id" uuid,
	"status" "quotation_status" DEFAULT 'DRAFT' NOT NULL,
	"current_revision_no" integer DEFAULT 1 NOT NULL,
	"booked_at" timestamp with time zone,
	"booked_by_membership_id" uuid,
	"created_by_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quotations_tenant_number_uq" UNIQUE("tenant_id","number"),
	CONSTRAINT "quotations_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_lead_fk" FOREIGN KEY ("lead_id","tenant_id") REFERENCES "public"."leads"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_activities" ADD CONSTRAINT "quotation_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_activities" ADD CONSTRAINT "quotation_activities_quotation_fk" FOREIGN KEY ("quotation_id","tenant_id") REFERENCES "public"."quotations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_activities" ADD CONSTRAINT "quotation_activities_actor_fk" FOREIGN KEY ("actor_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_attachments" ADD CONSTRAINT "quotation_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_attachments" ADD CONSTRAINT "quotation_attachments_quotation_fk" FOREIGN KEY ("quotation_id","tenant_id") REFERENCES "public"."quotations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_attachments" ADD CONSTRAINT "quotation_attachments_uploaded_by_fk" FOREIGN KEY ("uploaded_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_revision_fk" FOREIGN KEY ("revision_id","tenant_id") REFERENCES "public"."quotation_revisions"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_lines" ADD CONSTRAINT "quotation_lines_product_fk" FOREIGN KEY ("product_id","tenant_id") REFERENCES "public"."products"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_quotation_fk" FOREIGN KEY ("quotation_id","tenant_id") REFERENCES "public"."quotations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_accepted_by_fk" FOREIGN KEY ("accepted_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotation_revisions" ADD CONSTRAINT "quotation_revisions_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_lead_fk" FOREIGN KEY ("lead_id","tenant_id") REFERENCES "public"."leads"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_customer_fk" FOREIGN KEY ("customer_id","tenant_id") REFERENCES "public"."customers"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_project_fk" FOREIGN KEY ("project_id","tenant_id") REFERENCES "public"."projects"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_created_by_fk" FOREIGN KEY ("created_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_booked_by_fk" FOREIGN KEY ("booked_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_tenant_status_idx" ON "customers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "customers_tenant_lead_idx" ON "customers" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "customers_tenant_phone_idx" ON "customers" USING btree ("tenant_id","normalized_phone") WHERE normalized_phone is not null;--> statement-breakpoint
CREATE INDEX "customers_tenant_email_idx" ON "customers" USING btree ("tenant_id","normalized_email") WHERE normalized_email is not null;--> statement-breakpoint
CREATE INDEX "quotation_activities_tenant_quotation_idx" ON "quotation_activities" USING btree ("tenant_id","quotation_id","created_at");--> statement-breakpoint
CREATE INDEX "quotation_attachments_tenant_quotation_idx" ON "quotation_attachments" USING btree ("tenant_id","quotation_id");--> statement-breakpoint
CREATE INDEX "quotation_lines_tenant_revision_idx" ON "quotation_lines" USING btree ("tenant_id","revision_id");--> statement-breakpoint
CREATE INDEX "quotation_revisions_tenant_quotation_idx" ON "quotation_revisions" USING btree ("tenant_id","quotation_id");--> statement-breakpoint
CREATE INDEX "quotations_tenant_status_idx" ON "quotations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "quotations_tenant_lead_idx" ON "quotations" USING btree ("tenant_id","lead_id");--> statement-breakpoint
CREATE INDEX "quotations_tenant_customer_idx" ON "quotations" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "quotations_tenant_created_idx" ON "quotations" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "quotations_tenant_project_uq" ON "quotations" USING btree ("tenant_id","project_id") WHERE project_id is not null;
--> statement-breakpoint

-- Row-Level Security for the Phase 6 commercial tables (ADR 0035, following the
-- ADR 0027 / 0030 pattern). Every table is tenant-owned: non-privileged app
-- role grants, ENABLE + FORCE RLS, and a tenant-isolation policy whose
-- predicate matches the per-transaction `app.tenant_id` GUC.

GRANT SELECT, INSERT, UPDATE, DELETE ON "customers" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "customers_tenant_isolation" ON "customers";--> statement-breakpoint
CREATE POLICY "customers_tenant_isolation" ON "customers"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "quotations" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "quotations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "quotations_tenant_isolation" ON "quotations";--> statement-breakpoint
CREATE POLICY "quotations_tenant_isolation" ON "quotations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "quotation_revisions" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "quotation_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotation_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "quotation_revisions_tenant_isolation" ON "quotation_revisions";--> statement-breakpoint
CREATE POLICY "quotation_revisions_tenant_isolation" ON "quotation_revisions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "quotation_lines" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "quotation_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotation_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "quotation_lines_tenant_isolation" ON "quotation_lines";--> statement-breakpoint
CREATE POLICY "quotation_lines_tenant_isolation" ON "quotation_lines"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "quotation_activities" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "quotation_activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotation_activities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "quotation_activities_tenant_isolation" ON "quotation_activities";--> statement-breakpoint
CREATE POLICY "quotation_activities_tenant_isolation" ON "quotation_activities"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "quotation_attachments" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "quotation_attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotation_attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "quotation_attachments_tenant_isolation" ON "quotation_attachments";--> statement-breakpoint
CREATE POLICY "quotation_attachments_tenant_isolation" ON "quotation_attachments"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
