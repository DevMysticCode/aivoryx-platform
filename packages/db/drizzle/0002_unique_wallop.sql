-- Statement order adjusted by hand: the UNIQUE(user_id, id) target must exist
-- before the composite FK on "sessions" can reference it (drizzle-kit emitted
-- them in the reverse order). The resulting schema matches meta/0002_snapshot.json.
ALTER TABLE "user_tenant_memberships" ADD CONSTRAINT "user_tenant_memberships_user_id_id_uq" UNIQUE("user_id","id");--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "active_membership_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_membership_fk" FOREIGN KEY ("user_id","active_membership_id") REFERENCES "public"."user_tenant_memberships"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_active_membership_idx" ON "sessions" USING btree ("active_membership_id");
