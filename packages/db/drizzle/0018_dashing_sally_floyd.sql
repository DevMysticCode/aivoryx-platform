CREATE TABLE "crm_saved_views" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" numeric DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_saved_views_owner_name_uq" UNIQUE("tenant_id","membership_id","name")
);
--> statement-breakpoint
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_saved_views" ADD CONSTRAINT "crm_saved_views_member_fk" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crm_saved_views_tenant_member_idx" ON "crm_saved_views" USING btree ("tenant_id","membership_id");
--> statement-breakpoint
-- Phase 13C — hand-appended: RLS + grants for crm_saved_views. drizzle-kit
-- models neither, so meta/0018_snapshot.json is unchanged and `db:generate`
-- reports no drift. Idempotent. Standard tenant isolation; per-user isolation
-- is a `membership_id = <actor>` predicate in CrmSavedViewsService (RLS has no
-- membership binding, matching lead_notes / notification_preferences).
GRANT SELECT, INSERT, UPDATE, DELETE ON "crm_saved_views" TO "aivoryx_app";--> statement-breakpoint
ALTER TABLE "crm_saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_saved_views" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "crm_saved_views_tenant_isolation" ON "crm_saved_views";--> statement-breakpoint
CREATE POLICY "crm_saved_views_tenant_isolation" ON "crm_saved_views"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
