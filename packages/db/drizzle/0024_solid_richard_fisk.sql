ALTER TABLE "tenant_company_profiles" ADD COLUMN "login_welcome" text;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD COLUMN "login_description" text;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD COLUMN "login_show_powered_by" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD CONSTRAINT "tenant_company_profiles_login_welcome_len" CHECK ("login_welcome" is null or char_length("login_welcome") <= 80);--> statement-breakpoint
ALTER TABLE "tenant_company_profiles" ADD CONSTRAINT "tenant_company_profiles_login_desc_len" CHECK ("login_description" is null or char_length("login_description") <= 240);--> statement-breakpoint
-- Public, pre-auth login branding: resolve an ACTIVE tenant by its public slug
-- with no tenant context. Permissive, SELECT-only, additive (like
-- `tenant_invitations_by_token`); exposes exactly one active tenant row and
-- grants no write access. The profile/assets are then read under the normal
-- tenant policies after the server widens context with the resolved tenant id.
DROP POLICY IF EXISTS "tenants_by_public_slug" ON "tenants";--> statement-breakpoint
CREATE POLICY "tenants_by_public_slug" ON "tenants" AS PERMISSIVE FOR SELECT
  USING ("slug" = nullif(current_setting('app.workspace_slug', true), '') AND "status" = 'active');
