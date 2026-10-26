import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import {
  startConnectorHarness,
  WEBHOOK_ROUTES,
  type ConnectorHarness,
} from './support/connector.js';
import { RawEventRetentionService } from '../src/integrations/raw-event-retention.service.js';

/**
 * Lead Ingestion Failure Recovery and Replay Safety milestone.
 *
 * Architecture fact established by this milestone's audit (see
 * `docs/architecture/CUSTOMER-LAUNCH-READINESS.md` §15): there is NO
 * BullMQ-backed queue/worker for lead ingestion. Receipt, raw-event
 * persistence, canonicalization, dedup and lead creation all happen
 * SYNCHRONOUSLY inside the inbound HTTP request, across exactly two
 * database transactions (`ingestion.service.ts`'s own doc comment). BullMQ
 * exists only for notification DELIVERY, a decoupled, downstream concern.
 * So "a worker crashes mid-job" has no literal analogue here — the real
 * equivalent is "the request-handling process dies between the two
 * transactions, or while retrying," which this file reproduces by directly
 * arranging the exact row state such a crash would leave behind (the same
 * technique `test/support/db.ts`'s `createStuckProvisioningTenant` already
 * uses for an unrelated module), and by combining the existing BOOM- trigger
 * seam from `integrations-hardening.int.spec.ts` with a SECOND trigger to
 * force the "double fault" `recordProcessingFailure`'s own comment
 * anticipates (its write to record the failure also failing).
 */
describe.skipIf(!INTEGRATION_ENABLED)('Lead ingestion — failure recovery and replay safety', () => {
  const route = WEBHOOK_ROUTES[0];
  let h: ConnectorHarness;

  beforeAll(async () => {
    h = await startConnectorHarness();
  });
  afterAll(async () => {
    await h?.sql('drop trigger if exists ifr_fail_lead_insert on leads');
    await h?.sql('drop function if exists ifr_fail_lead_insert()');
    await h?.sql('drop trigger if exists ifr_fail_canonical_write on canonical_lead_events');
    await h?.sql('drop function if exists ifr_fail_canonical_write()');
    await h?.close();
  });

  const phone = () => `8${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const setup = async (label: string) => {
    const cookie = await h.adminCookie();
    return { cookie, ...(await h.createSource(cookie, h.uniqueKey(label))) };
  };

  /** fails any INSERT into `leads` whose name matches 'BOOM-%' — same seam as the hardening suite. */
  const injectLeadFailure = () =>
    h.sql(`
      create or replace function ifr_fail_lead_insert() returns trigger language plpgsql as $f$
      begin
        if new.name like 'BOOM-%' then raise exception 'ifr injected lead failure'; end if;
        return new;
      end $f$;
      drop trigger if exists ifr_fail_lead_insert on leads;
      create trigger ifr_fail_lead_insert before insert on leads
        for each row execute function ifr_fail_lead_insert();
    `);
  const clearLeadFailure = () => h.sql('drop trigger if exists ifr_fail_lead_insert on leads');

  /** fails the specific INSERT/UPDATE `recordProcessingFailure` issues to mark a canonical event
   *  FAILED (an INSERT on a first attempt, an UPDATE on a replay), for one idempotency key only —
   *  simulates that write itself also failing ("double fault"). */
  const injectDoubleFault = (idempotencyKeyPrefix: string) =>
    h.sql(`
      create or replace function ifr_fail_canonical_write() returns trigger language plpgsql as $f$
      begin
        if new.idempotency_key like '${idempotencyKeyPrefix}%' and new.status = 'FAILED' then
          raise exception 'ifr injected double fault';
        end if;
        return new;
      end $f$;
      drop trigger if exists ifr_fail_canonical_write on canonical_lead_events;
      create trigger ifr_fail_canonical_write before insert or update on canonical_lead_events
        for each row execute function ifr_fail_canonical_write();
    `);
  const clearDoubleFault = () =>
    h.sql('drop trigger if exists ifr_fail_canonical_write on canonical_lead_events');

  const backdate = (
    table: 'raw_events' | 'canonical_lead_events',
    sourceId: string,
    minutesAgo: number,
  ) =>
    h.sql(
      `update ${table} set ${table === 'raw_events' ? 'created_at' : 'updated_at'} = now() - interval '${minutesAgo} minutes' where source_id = $1`,
      [sourceId],
    );

  // ------------------------------------------------------------------
  // 1. double fault on the FIRST attempt -> stuck at RECEIVED, no canonical row
  // ------------------------------------------------------------------

  describe('double fault on first attempt (crash-before-canonical-row equivalent)', () => {
    it('a stale orphaned RECEIVED raw event with no canonical row is safely reprocessed on redelivery, not silently reported as a duplicate', async () => {
      const { key, secret, sourceId } = await setup('dblfault-1');
      const providerId = `DBLFAULT-${sourceId.slice(0, 8)}`;
      const body = { id: providerId, name: 'BOOM-first', phone: phone() };

      await injectLeadFailure();
      await injectDoubleFault(`record:${providerId}`);
      const first = await h.webhook(route, key, secret, body);
      expect(first.status).toBe(500); // recordProcessingFailure's own failure surfaces as INTERNAL_ERROR
      await clearLeadFailure();
      await clearDoubleFault();

      // confirm the exact arranged state: RECEIVED raw event, zero canonical rows
      const raw = await h.sql<{ status: string }>(
        'select status from raw_events where source_id = $1',
        [sourceId],
      );
      expect(raw).toHaveLength(1);
      expect(raw[0]!.status).toBe('RECEIVED');
      const canonicalCount = await h.sql(
        'select 1 from canonical_lead_events where source_id = $1',
        [sourceId],
      );
      expect(canonicalCount).toHaveLength(0);

      // age it past the recovery threshold, then redeliver the identical body (now that the
      // underlying issue is "fixed" — no triggers active)
      await backdate('raw_events', sourceId, 10);
      const redelivery = await h.webhook(route, key, secret, body);
      expect(redelivery.status).toBe(200);
      expect(redelivery.body.status).toBe('DONE');
      expect(redelivery.body.leadId).toBeTruthy();

      const leads = await h.sql('select 1 from leads where source_id = $1', [sourceId]);
      expect(leads).toHaveLength(1); // exactly one lead — not zero (lost), not two (duplicated)
      const canonicalAfter = await h.sql<{ status: string }>(
        'select status from canonical_lead_events where source_id = $1',
        [sourceId],
      );
      expect(canonicalAfter).toHaveLength(1);
      expect(canonicalAfter[0]!.status).toBe('DONE');
    });

    it('the SAME orphaned RECEIVED row is NOT reprocessed while still fresh — preserves the concurrent-delivery contract', async () => {
      const { key, secret, sourceId } = await setup('dblfault-fresh');
      const providerId = `DBLFAULT-FRESH-${sourceId.slice(0, 8)}`;
      const body = { id: providerId, name: 'BOOM-fresh', phone: phone() };

      await injectLeadFailure();
      await injectDoubleFault(`record:${providerId}`);
      await h.webhook(route, key, secret, body);
      await clearLeadFailure();
      await clearDoubleFault();
      // deliberately NOT backdated — this row is only moments old

      const redelivery = await h.webhook(route, key, secret, body);
      expect(redelivery.status).toBe(200);
      expect(redelivery.body.status).toBe('DUPLICATE_RAW'); // unchanged existing safe default
      expect(redelivery.body.leadId).toBeUndefined();

      const leads = await h.sql('select 1 from leads where source_id = $1', [sourceId]);
      expect(leads).toHaveLength(0); // still correctly not (yet) created
    });

    // CI Acceptance and Final Regression Gate milestone (§4): the staleness READ that decides a
    // stuck RECEIVED row is reclaim-eligible is a plain, unlocked SELECT — two concurrent
    // redeliveries of the same stale body could both pass it and both call `processRawEvent`.
    // What actually prevents a duplicate lead is downstream and already proven for the ordinary
    // concurrent-delivery case (`integrations.int.spec.ts` "concurrent identical deliveries..."):
    // the canonical event's `(tenantId, idempotencyKey)` unique constraint serializes the two
    // transactions at the upsert, so only the first to commit ever reaches lead creation — the
    // second's own dedupe lookup then sees that already-committed lead. This test proves that
    // SAME serialization holds for the reclaim path too, not only the original first-delivery path.
    it('two concurrent redeliveries of the same stale orphaned row produce exactly one lead, never two', async () => {
      const { key, secret, sourceId } = await setup('dblfault-concurrent');
      const providerId = `DBLFAULT-CC-${sourceId.slice(0, 8)}`;
      const body = { id: providerId, name: 'BOOM-concurrent', phone: phone() };

      await injectLeadFailure();
      await injectDoubleFault(`record:${providerId}`);
      await h.webhook(route, key, secret, body);
      await clearLeadFailure();
      await clearDoubleFault();
      await backdate('raw_events', sourceId, 10);

      const [a, b] = await Promise.all([
        h.webhook(route, key, secret, body),
        h.webhook(route, key, secret, body),
      ]);
      const statuses = [a.body.status, b.body.status].sort();
      // exactly one of the two actually does the work; the other sees it as a duplicate under
      // any of the raw-hash-level or canonical-idempotency-level dedup paths already proven
      // elsewhere — the only thing this test asserts beyond those is "never two leads"
      expect(statuses.filter((s) => s === 'DONE')).toHaveLength(1);

      const leads = await h.sql('select 1 from leads where source_id = $1', [sourceId]);
      expect(leads).toHaveLength(1);
      const canonicalRows = await h.sql(
        'select 1 from canonical_lead_events where source_id = $1',
        [sourceId],
      );
      expect(canonicalRows).toHaveLength(1); // never two canonical rows for the one raw event either
    });
  });

  // ------------------------------------------------------------------
  // 2. double fault on a REPLAY attempt -> stuck at PROCESSING forever
  // ------------------------------------------------------------------

  describe('double fault during a replay (crash-mid-reprocessing equivalent)', () => {
    it('a stale canonical event stuck at PROCESSING can be reclaimed by a later admin replay; a fresh one is still correctly rejected', async () => {
      const { cookie, key, secret, sourceId } = await setup('dblfault-2');
      const providerId = `DBLFAULT2-${sourceId.slice(0, 8)}`;
      const body = { id: providerId, name: 'BOOM-replay', phone: phone() };

      // first attempt fails cleanly (no double fault yet) — this path is already proven safe
      // elsewhere (`integrations-hardening.int.spec.ts`); it is only the setup for this test
      await injectLeadFailure();
      const first = await h.webhook(route, key, secret, body);
      expect(first.status).toBe(500);
      const [failedCanonical] = await h.sql<{ id: string; status: string }>(
        'select id, status from canonical_lead_events where source_id = $1',
        [sourceId],
      );
      expect(failedCanonical!.status).toBe('FAILED');
      const canonicalId = failedCanonical!.id;

      // a replay attempt now double-faults: the retry fails again AND recording that
      // second failure also fails, leaving the row committed at PROCESSING (from the
      // attempt-count bump) with nothing to ever move it out of that state
      await injectDoubleFault(`record:${providerId}`);
      const replayAttempt = await h.http
        .post(`/api/v1/admin/integrations/events/${canonicalId}/replay`)
        .set('Cookie', cookie);
      expect(replayAttempt.status).toBe(500);
      await clearLeadFailure();
      await clearDoubleFault();

      const [stuck] = await h.sql<{ status: string }>(
        'select status from canonical_lead_events where id = $1',
        [canonicalId],
      );
      expect(stuck!.status).toBe('PROCESSING'); // confirmed arranged state

      // while fresh, a further replay is correctly rejected rather than racing an attempt
      // that — for all the system can tell — might still genuinely be in flight
      const freshReplay = await h.http
        .post(`/api/v1/admin/integrations/events/${canonicalId}/replay`)
        .set('Cookie', cookie);
      expect(freshReplay.status).toBe(409);
      expect(freshReplay.body.error.code).toBe('EVENT_NOT_REPLAYABLE');

      // once stale, the SAME admin replay call recovers it instead of being blocked forever
      await h.sql(
        `update canonical_lead_events set updated_at = now() - interval '10 minutes' where id = $1`,
        [canonicalId],
      );
      const staleReplay = await h.http
        .post(`/api/v1/admin/integrations/events/${canonicalId}/replay`)
        .set('Cookie', cookie);
      expect(staleReplay.status).toBe(200);
      expect(staleReplay.body.status).toBe('DONE');
      expect(staleReplay.body.leadId).toBeTruthy();

      const leads = await h.sql('select 1 from leads where source_id = $1', [sourceId]);
      expect(leads).toHaveLength(1);

      // the reclaim is durably flagged in the audit trail
      const [auditRow] = await h.sql<{ metadata: { reclaimedStuckProcessing?: boolean } }>(
        `select metadata from audit_logs where action = 'integration.event.replayed' and entity_id = $1 order by occurred_at desc limit 1`,
        [canonicalId],
      );
      expect(auditRow!.metadata.reclaimedStuckProcessing).toBe(true);
    });
  });

  // ------------------------------------------------------------------
  // 3. permanent business failures are never reclaimed, however stale
  // ------------------------------------------------------------------

  it('a permanent validation failure is never auto-retried on redelivery, no matter how stale', async () => {
    const { key, secret, sourceId } = await setup('permanent-stale');
    const body = { name: 'No identity at all' }; // no phone, no email
    const first = await h.webhook(route, key, secret, body);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('VALIDATION_FAILED');

    await backdate('raw_events', sourceId, 60);
    await h.sql(
      `update canonical_lead_events set updated_at = now() - interval '60 minutes' where source_id = $1`,
      [sourceId],
    );

    const redelivery = await h.webhook(route, key, secret, body);
    expect(redelivery.status).toBe(200);
    expect(redelivery.body.status).toBe('DUPLICATE_RAW'); // still correctly not retried
    const leads = await h.sql('select 1 from leads where source_id = $1', [sourceId]);
    expect(leads).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // 4. retention purge must never discard an unresolved accepted lead
  // ------------------------------------------------------------------

  describe('retention purge safety', () => {
    const purger = () => h.app.get(RawEventRetentionService);

    it('an expired FAILED raw event survives the purge; an expired PROCESSED one does not', async () => {
      const { key, secret, sourceId } = await setup('purge-safety');

      await injectLeadFailure();
      const failed = await h.webhook(route, key, secret, { name: 'BOOM-purge', phone: phone() });
      expect(failed.status).toBe(500);
      await clearLeadFailure();

      const succeeded = await h.webhook(route, key, secret, { phone: phone() });
      expect(succeeded.status).toBe(200);
      expect(succeeded.body.status).toBe('DONE');

      await h.sql(
        `update raw_events set expires_at = now() - interval '1 hour' where source_id = $1`,
        [sourceId],
      );

      await purger().purgeExpired();

      const remaining = await h.sql<{ status: string }>(
        'select status from raw_events where source_id = $1',
        [sourceId],
      );
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.status).toBe('FAILED'); // the unresolved one survives
      const leads = await h.sql('select 1 from leads where source_id = $1', [sourceId]);
      expect(leads).toHaveLength(1); // the already-created lead is untouched either way
    });
  });

  // ------------------------------------------------------------------
  // 5. documented ambiguity: source revoked between receipt and (re)processing
  // ------------------------------------------------------------------

  it('[documented ambiguity] a stuck event from a source revoked after initial receipt is still reprocessed on reclaim — not a decided business rule', async () => {
    const { cookie, key, secret, sourceId } = await setup('revoked-between');
    const providerId = `REVOKED-${sourceId.slice(0, 8)}`;
    const body = { id: providerId, name: 'BOOM-revoked', phone: phone() };

    await injectLeadFailure();
    const first = await h.webhook(route, key, secret, body);
    expect(first.status).toBe(500);
    const [failedCanonical] = await h.sql<{ id: string }>(
      'select id from canonical_lead_events where source_id = $1',
      [sourceId],
    );
    await injectDoubleFault(`record:${providerId}`);
    await h.http
      .post(`/api/v1/admin/integrations/events/${failedCanonical!.id}/replay`)
      .set('Cookie', cookie);
    await clearLeadFailure();
    await clearDoubleFault();
    await h.sql(
      `update canonical_lead_events set updated_at = now() - interval '10 minutes' where id = $1`,
      [failedCanonical!.id],
    );

    // the source is revoked AFTER the event was originally accepted, before this reclaim
    await h.http
      .post(`/api/v1/admin/integrations/sources/${sourceId}/revoke`)
      .set('Cookie', cookie);

    const replay = await h.http
      .post(`/api/v1/admin/integrations/events/${failedCanonical!.id}/replay`)
      .set('Cookie', cookie);
    // current, undecided behavior: replay does not re-check source status, so a previously
    // accepted event still completes even though its source is now revoked. Documented in
    // CUSTOMER-LAUNCH-READINESS.md as a product decision, not changed here.
    expect(replay.status).toBe(200);
    expect(replay.body.status).toBe('DONE');
  });
});
