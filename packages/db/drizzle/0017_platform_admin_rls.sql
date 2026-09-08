-- 0017_platform_admin_rls — additive SELECT policies so an Aivoryx platform
-- admin can read (never write) workspace + membership + entitlement rows across
-- tenants, without an owner connection (Phase 13, ADR 0042).
--
-- Hand-authored: drizzle-kit models no policies, so meta/0017_snapshot.json is
-- identical to 0016 and `db:generate` reports no drift. Idempotent.
--
-- A platform admin's request carries `app.user_id` but no `app.tenant_id`
-- (platform routes are tenant-less). These policies match ONLY when the caller
-- has a `platform_admins` row, and grant SELECT only — every write path stays
-- bound by the pre-existing tenant-isolation policies.

DROP POLICY IF EXISTS "tenants_platform_read" ON "tenants";--> statement-breakpoint
CREATE POLICY "tenants_platform_read" ON "tenants"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "platform_admins" pa
      WHERE pa."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );--> statement-breakpoint

DROP POLICY IF EXISTS "utm_platform_read" ON "user_tenant_memberships";--> statement-breakpoint
CREATE POLICY "utm_platform_read" ON "user_tenant_memberships"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "platform_admins" pa
      WHERE pa."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );--> statement-breakpoint

DROP POLICY IF EXISTS "tenant_module_entitlements_platform_read" ON "tenant_module_entitlements";--> statement-breakpoint
CREATE POLICY "tenant_module_entitlements_platform_read" ON "tenant_module_entitlements"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "platform_admins" pa
      WHERE pa."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );
