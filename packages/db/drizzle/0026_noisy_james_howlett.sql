ALTER TABLE "raw_events" ADD COLUMN "expires_at" timestamp with time zone DEFAULT now() + interval '30 days' NOT NULL;--> statement-breakpoint
CREATE INDEX "raw_events_expires_at_idx" ON "raw_events" USING btree ("expires_at");--> statement-breakpoint

-- Raw-event retention purge (UC-1). A background job deletes expired raw payloads across tenants. It
-- runs with the non-privileged `aivoryx_app` role and sets `app.raw_event_purger = 'on'` (a
-- server-only GUC, same pattern as the outbox dispatcher above). These policies grant ONLY
-- cross-tenant SELECT + DELETE of raw_events rows that are ALREADY past `expires_at` — even a bug in
-- the job cannot touch a non-expired row. Deleting a raw event cascades to its canonical event and
-- stage log through the existing foreign keys (leads are never referenced by them, so never deleted).
DROP POLICY IF EXISTS "raw_events_purge_read" ON "raw_events";--> statement-breakpoint
CREATE POLICY "raw_events_purge_read" ON "raw_events"
  FOR SELECT
  USING (current_setting('app.raw_event_purger', true) = 'on' AND "expires_at" < now());--> statement-breakpoint
DROP POLICY IF EXISTS "raw_events_purge_delete" ON "raw_events";--> statement-breakpoint
CREATE POLICY "raw_events_purge_delete" ON "raw_events"
  FOR DELETE
  USING (current_setting('app.raw_event_purger', true) = 'on' AND "expires_at" < now());
