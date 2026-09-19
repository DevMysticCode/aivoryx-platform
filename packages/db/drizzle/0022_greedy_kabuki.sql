CREATE TYPE "public"."visit_outcome" AS ENUM('SUITABLE', 'NOT_SUITABLE', 'FOLLOW_UP_REQUIRED');--> statement-breakpoint
ALTER TABLE "quotations" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "outcome" "visit_outcome";--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "outcome_note" text;--> statement-breakpoint
ALTER TABLE "quotations" ADD CONSTRAINT "quotations_visit_fk" FOREIGN KEY ("visit_id","tenant_id") REFERENCES "public"."visits"("id","tenant_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quotations_tenant_visit_idx" ON "quotations" USING btree ("tenant_id","visit_id");