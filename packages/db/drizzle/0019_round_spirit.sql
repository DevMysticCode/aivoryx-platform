CREATE TYPE "public"."subscription_status" AS ENUM('active', 'canceled', 'expired');--> statement-breakpoint
ALTER TYPE "public"."tenant_status" ADD VALUE 'provisioning';--> statement-breakpoint
ALTER TYPE "public"."tenant_status" ADD VALUE 'archived';--> statement-breakpoint
CREATE TABLE "tenant_subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_key" text NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"renews_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"billing_provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_subscriptions_tenant_uq" UNIQUE("tenant_id")
);
--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD CONSTRAINT "tenant_subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_subscriptions_tenant_idx" ON "tenant_subscriptions" USING btree ("tenant_id");--> statement-breakpoint

-- Phase 14 — hand-appended: RLS + grants for tenant_subscriptions. drizzle-kit
-- models neither, so meta/0019_snapshot.json is unchanged and `db:generate`
-- reports no drift. Idempotent. Standard tenant isolation (same template as
-- migration 0018's crm_saved_views); a platform admin reads/writes this table
-- through TenantProvisioningService, which enters the target tenant's own RLS
-- context (never an owner/global connection), matching the existing
-- entitlement-write pattern.
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_subscriptions" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_subscriptions_tenant_isolation" ON "tenant_subscriptions";--> statement-breakpoint
CREATE POLICY "tenant_subscriptions_tenant_isolation" ON "tenant_subscriptions"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint

-- Additive SELECT-only platform-admin read policy, same template as
-- migration 0017 (tenants / user_tenant_memberships / tenant_module_entitlements).
DROP POLICY IF EXISTS "tenant_subscriptions_platform_read" ON "tenant_subscriptions";--> statement-breakpoint
CREATE POLICY "tenant_subscriptions_platform_read" ON "tenant_subscriptions"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM "platform_admins" pa
      WHERE pa."user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    )
  );