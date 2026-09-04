-- 0003_security_boundary — runtime DB role + Row Level Security (ADR 0027).
--
-- Hand-authored: drizzle-kit models neither roles, grants nor RLS policies, so
-- meta/0003_snapshot.json is intentionally identical to 0002 and `db:generate`
-- reports no drift.
--
-- Runs as the migration/owner role (the DATABASE_URL user), which must be able
-- to CREATE ROLE and GRANT. Every statement is idempotent so a re-run is safe.
--
-- Policy predicate: `nullif(current_setting('app.tenant_id', true), '')::uuid`.
-- `nullif(..., '')` matters — once a custom GUC has been touched in a session
-- (via `SET LOCAL` / `set_config(..., true)`) it reverts to the empty string,
-- not NULL, on a pooled connection; casting `''` to uuid would raise 22P02
-- instead of failing closed. NULL => no row matches.

-- 1. Non-privileged application role ----------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aivoryx_app') THEN
    CREATE ROLE "aivoryx_app" NOLOGIN NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

-- The connecting role (app == migrator connection user in this setup) must be
-- able to `SET ROLE aivoryx_app`. If a deployment uses a separate app DB user,
-- grant that user membership in aivoryx_app as well.
DO $$
BEGIN
  EXECUTE format('GRANT "aivoryx_app" TO %I', current_user);
END
$$;
--> statement-breakpoint

-- 2. Privileges: DML only. No DDL, no ownership, no RLS bypass. -------------
GRANT USAGE ON SCHEMA "public" TO "aivoryx_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "aivoryx_app";
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "aivoryx_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "aivoryx_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT USAGE, SELECT ON SEQUENCES TO "aivoryx_app";
--> statement-breakpoint

-- 3. Row Level Security on the tenant-owned identity tables ----------------
-- ENABLE makes RLS apply to ordinary roles; FORCE makes it apply to the table
-- owner too, so a mistaken owner-role query cannot bypass isolation.

ALTER TABLE "user_tenant_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_tenant_memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "utm_tenant_isolation" ON "user_tenant_memberships";--> statement-breakpoint
CREATE POLICY "utm_tenant_isolation" ON "user_tenant_memberships"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- A user may always read their own membership rows: needed to resolve tenant
-- context before a tenant is active, and for /auth/me. SELECT only.
DROP POLICY IF EXISTS "utm_self_read" ON "user_tenant_memberships";--> statement-breakpoint
CREATE POLICY "utm_self_read" ON "user_tenant_memberships"
  FOR SELECT
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "roles_tenant_isolation" ON "roles";--> statement-breakpoint
CREATE POLICY "roles_tenant_isolation" ON "roles"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "role_permissions_tenant_isolation" ON "role_permissions";--> statement-breakpoint
CREATE POLICY "role_permissions_tenant_isolation" ON "role_permissions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "membership_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "membership_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "membership_roles_tenant_isolation" ON "membership_roles";--> statement-breakpoint
CREATE POLICY "membership_roles_tenant_isolation" ON "membership_roles"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- 4. tenants: visible only for the active tenant or one the current user is a
--    member of. Defense in depth beyond the tenant_id-carrying tables.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenants_visibility" ON "tenants";--> statement-breakpoint
CREATE POLICY "tenants_visibility" ON "tenants"
  USING (
    "id" = nullif(current_setting('app.tenant_id', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM "user_tenant_memberships" m
      WHERE m."tenant_id" = "tenants"."id"
        AND m."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  )
  WITH CHECK ("id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
