CREATE TYPE "public"."tenant_asset_kind" AS ENUM('logo', 'logo_light', 'logo_dark', 'favicon');--> statement-breakpoint
CREATE TABLE "tenant_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "tenant_asset_kind" NOT NULL,
	"object_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"original_filename" text,
	"uploaded_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_assets_tenant_kind_uq" UNIQUE("tenant_id","kind"),
	CONSTRAINT "tenant_assets_object_key_uq" UNIQUE("object_key"),
	CONSTRAINT "tenant_assets_size_pos" CHECK ("size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "tenant_company_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_name" text,
	"display_name" text,
	"email" text,
	"phone" text,
	"website" text,
	"address_line" text,
	"city" text,
	"region" text,
	"country" text,
	"postal_code" text,
	"tax_registration_label" text,
	"tax_registration_number" text,
	"document_footer" text,
	"timezone" text,
	"default_currency" text,
	"primary_color" text,
	"accent_color" text,
	"updated_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_company_profiles_tenant_uq" UNIQUE("tenant_id"),
	CONSTRAINT "tenant_company_profiles_primary_hex" CHECK ("primary_color" is null or "primary_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "tenant_company_profiles_accent_hex" CHECK ("accent_color" is null or "accent_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "tenant_company_profiles_currency_iso" CHECK ("default_currency" is null or "default_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE TABLE "tenant_onboarding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dismissed_at" timestamp with time zone,
	"dismissed_by_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_onboarding_tenant_uq" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "tenant_assets" ADD CONSTRAINT "tenant_assets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_assets" ADD CONSTRAINT "tenant_assets_uploaded_by_fk" FOREIGN KEY ("uploaded_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD CONSTRAINT "tenant_company_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD CONSTRAINT "tenant_company_profiles_updated_by_fk" FOREIGN KEY ("updated_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_onboarding" ADD CONSTRAINT "tenant_onboarding_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_onboarding" ADD CONSTRAINT "tenant_onboarding_dismissed_by_fk" FOREIGN KEY ("dismissed_by_membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_assets_tenant_idx" ON "tenant_assets" USING btree ("tenant_id");
--> statement-breakpoint
-- Row-Level Security for the Phase 10 tenant-branding tables (ADR 0039,
-- following the ADR 0027 / 0030 pattern): non-privileged app-role grants,
-- ENABLE + FORCE RLS, tenant-isolation policy on the per-transaction
-- app.tenant_id GUC. USING + WITH CHECK both fail closed with no tenant context.

GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_company_profiles" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_company_profiles_tenant_isolation" ON "tenant_company_profiles";--> statement-breakpoint
CREATE POLICY "tenant_company_profiles_tenant_isolation" ON "tenant_company_profiles"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_assets" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "tenant_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_assets_tenant_isolation" ON "tenant_assets";--> statement-breakpoint
CREATE POLICY "tenant_assets_tenant_isolation" ON "tenant_assets"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_onboarding" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "tenant_onboarding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_onboarding" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_onboarding_tenant_isolation" ON "tenant_onboarding";--> statement-breakpoint
CREATE POLICY "tenant_onboarding_tenant_isolation" ON "tenant_onboarding"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
