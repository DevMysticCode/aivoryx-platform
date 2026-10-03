ALTER TYPE "public"."connector_type" ADD VALUE 'meta_lead_ads';--> statement-breakpoint
CREATE TABLE "connector_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"ciphertext" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_credentials_source_uq" UNIQUE("source_id"),
	CONSTRAINT "connector_credentials_id_tenant_uq" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "lead_sources" ADD COLUMN "public_lookup_key" text;--> statement-breakpoint
ALTER TABLE "connector_credentials" ADD CONSTRAINT "connector_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_credentials" ADD CONSTRAINT "connector_credentials_source_fk" FOREIGN KEY ("source_id","tenant_id") REFERENCES "public"."lead_sources"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_credentials_tenant_idx" ON "connector_credentials" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "lead_sources" ADD CONSTRAINT "lead_sources_public_lookup_key_uq" UNIQUE("public_lookup_key");--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "connector_credentials" TO "aivoryx_app";--> statement-breakpoint

-- Signature-style providers (Meta, UC-3) resolve their source from the URL alone, with no bearer
-- secret at all (Meta's platform cannot send a custom Authorization header) -- same pattern as
-- `lead_sources_by_secret` (ADR 0032), bound via a different server-only GUC. `connector_credentials`
-- carries ONLY the ordinary tenant-isolation policy: it is always read/written AFTER a tenant is
-- already resolved (never used for pre-auth resolution itself), unlike `lead_sources`.
DROP POLICY IF EXISTS "lead_sources_by_public_key" ON "lead_sources";--> statement-breakpoint
CREATE POLICY "lead_sources_by_public_key" ON "lead_sources"
  USING ("public_lookup_key" = nullif(current_setting('app.connector_public_lookup_key', true), ''))
  WITH CHECK ("public_lookup_key" = nullif(current_setting('app.connector_public_lookup_key', true), ''));--> statement-breakpoint

ALTER TABLE "connector_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "connector_credentials_tenant_isolation" ON "connector_credentials";--> statement-breakpoint
CREATE POLICY "connector_credentials_tenant_isolation" ON "connector_credentials"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
