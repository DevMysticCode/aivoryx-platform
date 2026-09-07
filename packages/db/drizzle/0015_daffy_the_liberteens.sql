CREATE TYPE "public"."data_scope" AS ENUM('OWN', 'TEAM', 'DEPARTMENT', 'COMPANY');--> statement-breakpoint
CREATE TYPE "public"."module_entitlement_state" AS ENUM('ENABLED', 'DISABLED');--> statement-breakpoint
CREATE TYPE "public"."role_kind" AS ENUM('profile', 'permission_set', 'custom');--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"granted_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_user_uq" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_module_entitlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module_key" text NOT NULL,
	"state" "module_entitlement_state" DEFAULT 'DISABLED' NOT NULL,
	"enabled_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"provisioned_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_module_entitlements_tenant_module_uq" UNIQUE("tenant_id","module_key")
);
--> statement-breakpoint
ALTER TABLE "membership_roles" ADD COLUMN "data_scope" "data_scope" DEFAULT 'COMPANY' NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "kind" "role_kind" DEFAULT 'custom' NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admins" ADD CONSTRAINT "platform_admins_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_module_entitlements" ADD CONSTRAINT "tenant_module_entitlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_module_entitlements_tenant_idx" ON "tenant_module_entitlements" USING btree ("tenant_id");
--> statement-breakpoint
-- Phase 13 (ADR 0042) — hand-appended: RLS + grants. drizzle-kit models
-- neither, so meta/0015_snapshot.json is unchanged and `db:generate` reports no
-- drift. Idempotent.

-- tenant_module_entitlements: tenant-owned, standard isolation. Written only by
-- the platform provisioning service, which deliberately enters the TARGET
-- tenant's RLS context for the write (never an owner connection, never a
-- client-supplied tenant id).
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_module_entitlements" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "tenant_module_entitlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_module_entitlements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_module_entitlements_tenant_isolation" ON "tenant_module_entitlements";--> statement-breakpoint
CREATE POLICY "tenant_module_entitlements_tenant_isolation" ON "tenant_module_entitlements"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- platform_admins: GLOBAL and security-sensitive. The app role may only SELECT,
-- and only its own row (self-read). Rows are created by the seed / a future
-- platform-super-admin flow running as the owner role. RLS is ENABLE + FORCE so
-- a stray owner query cannot enumerate platform admins either.
REVOKE INSERT, UPDATE, DELETE ON "platform_admins" FROM "aivoryx_app";--> statement-breakpoint
GRANT SELECT ON "platform_admins" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "platform_admins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_admins" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "platform_admins_self_read" ON "platform_admins";--> statement-breakpoint
CREATE POLICY "platform_admins_self_read" ON "platform_admins"
  FOR SELECT
  USING ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);
