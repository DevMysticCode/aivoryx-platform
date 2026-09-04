CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked');--> statement-breakpoint
ALTER TYPE "public"."membership_status" ADD VALUE 'invited';--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"correlation_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"invited_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_invitations" ADD CONSTRAINT "tenant_invitations_membership_fk" FOREIGN KEY ("membership_id","tenant_id") REFERENCES "public"."user_tenant_memberships"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_events_tenant_idx" ON "outbox_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "outbox_events_type_idx" ON "outbox_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "outbox_events_undispatched_idx" ON "outbox_events" USING btree ("occurred_at") WHERE dispatched_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_invitations_token_hash_uq" ON "tenant_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_invitations_pending_membership_uq" ON "tenant_invitations" USING btree ("membership_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "tenant_invitations_tenant_idx" ON "tenant_invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_invitations_membership_idx" ON "tenant_invitations" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "tenant_invitations_status_idx" ON "tenant_invitations" USING btree ("status");--> statement-breakpoint

-- Row Level Security for the Task 3 tenant-owned tables (ADR 0027 / 0030).
-- Hand-appended: drizzle-kit does not model RLS, so meta/0004_snapshot.json
-- stays in sync and `db:generate` reports no drift.
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_invitations" TO "aivoryx_app";--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox_events" TO "aivoryx_app";--> statement-breakpoint

ALTER TABLE "tenant_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_invitations_tenant_isolation" ON "tenant_invitations";--> statement-breakpoint
CREATE POLICY "tenant_invitations_tenant_isolation" ON "tenant_invitations"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- The public invitation-acceptance flow has no session/tenant context. It sets
-- `app.invitation_token_hash` to exactly the token it holds; this policy then
-- exposes only that one row (SELECT to find it, UPDATE to mark it accepted).
DROP POLICY IF EXISTS "tenant_invitations_by_token" ON "tenant_invitations";--> statement-breakpoint
CREATE POLICY "tenant_invitations_by_token" ON "tenant_invitations"
  USING ("token_hash" = nullif(current_setting('app.invitation_token_hash', true), ''))
  WITH CHECK ("token_hash" = nullif(current_setting('app.invitation_token_hash', true), ''));--> statement-breakpoint

ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "outbox_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "outbox_events_tenant_isolation" ON "outbox_events";--> statement-breakpoint
CREATE POLICY "outbox_events_tenant_isolation" ON "outbox_events"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);