ALTER TYPE "public"."tenant_asset_kind" ADD VALUE 'logo_compact';--> statement-breakpoint
ALTER TYPE "public"."tenant_asset_kind" ADD VALUE 'logo_login';--> statement-breakpoint
ALTER TYPE "public"."tenant_asset_kind" ADD VALUE 'logo_document';--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "logo_object_key" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "logo_content_type" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "logo_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD COLUMN "theme_preset" text;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD COLUMN "secondary_color" text;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD COLUMN "document_accent_color" text;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD COLUMN "document_logo_mode" text DEFAULT 'company' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD COLUMN "document_show_customer_logo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD CONSTRAINT "tenant_company_profiles_secondary_hex" CHECK ("secondary_color" is null or "secondary_color" ~ '^#[0-9a-fA-F]{6}$');--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD CONSTRAINT "tenant_company_profiles_doc_accent_hex" CHECK ("document_accent_color" is null or "document_accent_color" ~ '^#[0-9a-fA-F]{6}$');--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD CONSTRAINT "tenant_company_profiles_theme_preset_chk" CHECK ("theme_preset" is null or "theme_preset" in ('aivoryx-teal','ocean','indigo','emerald','royal','warm','custom'));--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD CONSTRAINT "tenant_company_profiles_doc_logo_mode_chk" CHECK ("document_logo_mode" in ('company','separate'));