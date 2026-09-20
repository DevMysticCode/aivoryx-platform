import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import {
  startConnectorHarness,
  WEBHOOK_ROUTES,
  type ConnectorHarness,
} from './support/connector.js';

/**
 * Universal Connector UC-0 — characterization / contract suite for the inbound
 * connector, written BEFORE the adapter / canonical-ingestion refactor.
 *
 * What is frozen here is EXTERNALLY OBSERVABLE behaviour and IMPORTANT PERSISTED
 * side effects, read through the public HTTP API or plain SQL on the physical
 * tables. It deliberately does not reference application classes, the adapter,
 * the pipeline's internal stage names, or the shape of the code — those are what
 * UC-2/UC-3 are meant to change.
 *
 * Every expectation below was derived from the real responses of the current
 * implementation, not from a design document. The route under test is a
 * parameter (`WEBHOOK_ROUTES`) so UC-4 can prove the provider-neutral route is
 * equivalent by adding it to that list.
 */
describe.skipIf(!INTEGRATION_ENABLED)('inbound connector — contract (UC-0)', () => {
  let h: ConnectorHarness;

  beforeAll(async () => {
    h = await startConnectorHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  /** a phone number unlikely to collide with any other test's leads in the same tenant */
  const phone = () => `8${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const count = async (table: string, sourceId: string) =>
    Number(
      (
        await h.sql<{ n: string }>(`select count(*) n from ${table} where source_id = $1`, [
          sourceId,
        ])
      )[0]!.n,
    );
  const outboxFor = (sourceId: string) =>
    h.sql<{
      type: string;
      payload: Record<string, unknown>;
      correlation_id: string | null;
      actor_membership_id: string | null;
    }>(
      "select type, payload, correlation_id, actor_membership_id from outbox_events where payload->>'sourceId' = $1 order by occurred_at",
      [sourceId],
    );

  describe.each(WEBHOOK_ROUTES)('via $name', (route) => {
    const setup = async (label: string, mapping?: Record<string, string>) => {
      const cookie = await h.adminCookie();
      const src = await h.createSource(cookie, h.uniqueKey(label), mapping);
      return { cookie, ...src };
    };

    // ---- response shape (derived from the actual responses) -----------------

    describe('response contract', () => {
      it('DONE: HTTP 200 with exactly the observed keys', async () => {
        const { key, secret } = await setup('shape-done');
        const res = await h.webhook(route, key, secret, { full_name: 'A', phone_number: phone() });
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(
          [
            'accepted',
            'canonicalEventId',
            'dedupeOutcome',
            'leadId',
            'rawEventId',
            'status',
          ].sort(),
        );
        expect(res.body).toMatchObject({ accepted: true, status: 'DONE', dedupeOutcome: 'new' });
        for (const k of ['rawEventId', 'canonicalEventId', 'leadId'])
          expect(res.body[k]).toMatch(uuid);
      });

      it('VALIDATION_FAILED: HTTP 200, accepted:true, error fields present, no leadId/dedupeOutcome', async () => {
        const { key, secret } = await setup('shape-invalid');
        const res = await h.webhook(route, key, secret, { full_name: 'No Identity' });
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(
          [
            'accepted',
            'canonicalEventId',
            'errorCode',
            'errorMessage',
            'rawEventId',
            'status',
          ].sort(),
        );
        expect(res.body).toMatchObject({
          accepted: true,
          status: 'VALIDATION_FAILED',
          errorCode: 'LEAD_MISSING_IDENTITY',
        });
        expect(typeof res.body.errorMessage).toBe('string');
      });

      it('DUPLICATE_RAW and DUPLICATE_EVENT: same key set as DONE, pointing at the original', async () => {
        const { key, secret } = await setup('shape-dup');
        const body = { id: 'D-2', name: 'A', phone: phone() };
        const one = await h.webhook(route, key, secret, body);
        const dupRaw = await h.webhook(route, key, secret, body);
        expect(dupRaw.status).toBe(200);
        expect(Object.keys(dupRaw.body).sort()).toEqual(Object.keys(one.body).sort());
        expect(dupRaw.body).toMatchObject({
          accepted: true,
          status: 'DUPLICATE_RAW',
          rawEventId: one.body.rawEventId,
          canonicalEventId: one.body.canonicalEventId,
          leadId: one.body.leadId,
          dedupeOutcome: 'new',
        });

        const dupEvent = await h.webhook(route, key, secret, { ...body, name: 'Changed' });
        expect(dupEvent.status).toBe(200);
        expect(Object.keys(dupEvent.body).sort()).toEqual(Object.keys(one.body).sort());
        expect(dupEvent.body).toMatchObject({
          accepted: true,
          status: 'DUPLICATE_EVENT',
          canonicalEventId: one.body.canonicalEventId,
          leadId: one.body.leadId,
        });
        expect(dupEvent.body.rawEventId).not.toBe(one.body.rawEventId); // a new delivery was recorded
      });

      it('auth failures: 401 with { error: { code, message, correlationId } } and nothing else', async () => {
        const { key } = await setup('shape-401');
        const res = await h.webhook(route, key, 'not-a-real-secret', { phone: phone() });
        expect(res.status).toBe(401);
        expect(Object.keys(res.body)).toEqual(['error']);
        expect(Object.keys(res.body.error).sort()).toEqual(['code', 'correlationId', 'message']);
        expect(res.body.error.code).toBe('CONNECTOR_INVALID');
        expect(res.body.error.correlationId).toMatch(/^AIV-/);
      });
    });

    // ---- persistence side effects -----------------------------------------

    describe('persisted side effects', () => {
      it('success: raw event, canonical event, lead, timeline entry and outbox event all agree', async () => {
        const { key, secret, sourceId, cookie } = await setup('persist');
        const p = phone();
        const res = await h.webhook(route, key, secret, {
          id: 'REC-1',
          full_name: 'Persist Me',
          phone_number: p,
          email_address: 'Persist@Example.test',
        });
        expect(res.body.status).toBe('DONE');

        const [canon] = await h.sql<Record<string, unknown>>(
          'select status, dedupe_outcome, processing_attempts, idempotency_key, lead_id, tenant_id from canonical_lead_events where source_id = $1',
          [sourceId],
        );
        expect(canon).toMatchObject({
          status: 'DONE',
          dedupe_outcome: 'new',
          processing_attempts: 0,
          idempotency_key: 'record:REC-1',
          lead_id: res.body.leadId,
          tenant_id: h.fx.tenantA,
        });

        // an event trace exists, is ordered, and ends in DONE (stage names are NOT part of the contract)
        const log = await h.sql<{ to_status: string; correlation_id: string }>(
          'select to_status, correlation_id from integration_event_log where raw_event_id = $1 order by created_at, id',
          [res.body.rawEventId],
        );
        expect(log.length).toBeGreaterThan(0);
        expect(log[log.length - 1]!.to_status).toBe('DONE');

        const [lead] = await h.sql<Record<string, unknown>>(
          'select tenant_id, source_id, origin, status, name, normalized_phone, normalized_email from leads where id = $1',
          [res.body.leadId],
        );
        expect(lead).toMatchObject({
          tenant_id: h.fx.tenantA,
          source_id: sourceId, // source attribution
          origin: 'inbound',
          status: 'NEW',
          name: 'Persist Me',
          normalized_phone: p,
          normalized_email: 'persist@example.test',
        });

        const detail = await h.http
          .get(`/api/v1/crm/leads/${res.body.leadId}`)
          .set('Cookie', cookie);
        expect(detail.body).toMatchObject({ sourceId, origin: 'inbound' });
        expect(detail.body.sourceName).toBe(`Source ${key}`);

        const acts = await h.http
          .get(`/api/v1/crm/leads/${res.body.leadId}/activities`)
          .set('Cookie', cookie);
        const created = acts.body.find((a: { type: string }) => a.type === 'created');
        expect(created.actorMembershipId).toBeNull();
        expect(created.payload).toMatchObject({ rawEventId: res.body.rawEventId });
      });

      it('outbox: lead.created / lead.updated with the observed payload keys and the delivery correlation id', async () => {
        const { key, secret, sourceId } = await setup('outbox');
        const p = phone();
        const first = await h.webhook(route, key, secret, { name: 'Ob', phone: p });
        const second = await h.webhook(route, key, secret, {
          name: 'Ob2',
          phone: p,
          email: 'ob@x.test',
        });
        expect(second.body.dedupeOutcome).toBe('duplicate_update');

        const events = await outboxFor(sourceId);
        expect(events.map((e) => e.type)).toEqual(['lead.created', 'lead.updated']);
        for (const e of events) {
          expect(Object.keys(e.payload).sort()).toEqual(
            ['canonicalEventId', 'dedupeOutcome', 'leadId', 'rawEventId', 'sourceId'].sort(),
          );
          expect(e.actor_membership_id).toBeNull();
        }
        expect(events[0]!.payload).toMatchObject({
          leadId: first.body.leadId,
          dedupeOutcome: 'new',
        });
        expect(events[1]!.payload).toMatchObject({
          leadId: first.body.leadId,
          dedupeOutcome: 'duplicate_update',
          rawEventId: second.body.rawEventId,
        });
        const [raw] = await h.sql<{ correlation_id: string }>(
          'select correlation_id from raw_events where id = $1',
          [first.body.rawEventId],
        );
        expect(events[0]!.correlation_id).toBe(raw!.correlation_id);
      });

      it('no outbox event and no lead for VALIDATION_FAILED, DUPLICATE_RAW or DUPLICATE_EVENT', async () => {
        const { key, secret, sourceId } = await setup('no-outbox');
        await h.webhook(route, key, secret, { name: 'nobody' });
        expect(await count('leads', sourceId)).toBe(0);
        expect(await outboxFor(sourceId)).toHaveLength(0);

        const body = { id: 'NO-1', phone: phone() };
        await h.webhook(route, key, secret, body);
        expect(await outboxFor(sourceId)).toHaveLength(1);
        await h.webhook(route, key, secret, body); // DUPLICATE_RAW
        await h.webhook(route, key, secret, { ...body, name: 'x' }); // DUPLICATE_EVENT
        expect(await outboxFor(sourceId)).toHaveLength(1);
        expect(await count('leads', sourceId)).toBe(1);
      });

      it('raw payload is preserved verbatim (nested objects and arrays); only safe headers are kept', async () => {
        const { key, secret, sourceId } = await setup('raw');
        const body = {
          full_name: 'Raw Keeper',
          phone_number: phone(),
          meta: { campaign: 'summer', tags: ['a', 'b'], nested: { deep: true } },
          list: [1, { x: 2 }],
        };
        const res = await h.webhook(route, key, secret, body, { 'User-Agent': 'contract-suite' });
        expect(res.body.status).toBe('DONE');
        const [raw] = await h.sql<{
          raw_body: unknown;
          transport_metadata: Record<string, string>;
        }>('select raw_body, transport_metadata from raw_events where source_id = $1', [sourceId]);
        expect(raw!.raw_body).toEqual(body);
        expect(raw!.transport_metadata['user-agent']).toBe('contract-suite');
        expect(
          Object.keys(raw!.transport_metadata).some((k) => k.toLowerCase() === 'authorization'),
        ).toBe(false);
        expect(JSON.stringify(raw)).not.toContain(secret);
      });

      it('an exact redelivery adds no rows anywhere and is independent of JSON key order', async () => {
        const { key, secret, sourceId } = await setup('dup-raw');
        const p = phone();
        const first = await h.webhook(route, key, secret, { id: 'R-9', name: 'A', phone: p });
        const before = [
          await count('raw_events', sourceId),
          await count('canonical_lead_events', sourceId),
          await count('leads', sourceId),
          (await outboxFor(sourceId)).length,
        ];
        const again = await h.webhook(route, key, secret, { phone: p, name: 'A', id: 'R-9' }); // reordered keys
        expect(again.body.status).toBe('DUPLICATE_RAW');
        expect(again.body.rawEventId).toBe(first.body.rawEventId);
        const after = [
          await count('raw_events', sourceId),
          await count('canonical_lead_events', sourceId),
          await count('leads', sourceId),
          (await outboxFor(sourceId)).length,
        ];
        expect(after).toEqual(before);
      });
    });

    // ---- canonical idempotency ----------------------------------------------

    describe('canonical idempotency', () => {
      it('the same provider record id with a DIFFERENT body is one logical event: one canonical event, one lead', async () => {
        const { key, secret, sourceId } = await setup('idem');
        const p = phone();
        const a = await h.webhook(route, key, secret, { id: 'SAME', name: 'One', phone: p });
        const b = await h.webhook(route, key, secret, { id: 'SAME', name: 'Two', phone: p });
        expect(b.body.status).toBe('DUPLICATE_EVENT');
        expect(b.body.canonicalEventId).toBe(a.body.canonicalEventId);
        expect(await count('canonical_lead_events', sourceId)).toBe(1);
        expect(await count('leads', sourceId)).toBe(1);
        // both deliveries are kept as raw events for inspection
        expect(await count('raw_events', sourceId)).toBe(2);
      });

      it.each([['provider_record_id'], ['record_id'], ['lead_id'], ['leadId'], ['id'], ['uid']])(
        'the provider record id is taken from "%s" (idempotency_key = record:<value>)',
        async (field) => {
          const { key, secret, sourceId } = await setup(`idem-${field}`);
          const recordId = `V-${field}-${Date.now()}`; // unique: idempotency is scoped per tenant
          const res = await h.webhook(route, key, secret, { [field]: recordId, phone: phone() });
          expect(res.body.status).toBe('DONE');
          const [c] = await h.sql<{ idempotency_key: string }>(
            'select idempotency_key from canonical_lead_events where source_id = $1',
            [sourceId],
          );
          expect(c!.idempotency_key).toBe(`record:${recordId}`);
        },
      );

      it('without a provider record id the key is derived from the raw event (raw:<rawEventId>)', async () => {
        const { key, secret, sourceId } = await setup('idem-none');
        const res = await h.webhook(route, key, secret, { name: 'x', phone: phone() });
        const [c] = await h.sql<{ idempotency_key: string }>(
          'select idempotency_key from canonical_lead_events where source_id = $1',
          [sourceId],
        );
        expect(c!.idempotency_key).toBe(`raw:${res.body.rawEventId}`);
      });
    });

    // ---- normalization, dedupe, enrichment ------------------------------------

    describe('normalization, dedupe and conservative enrichment', () => {
      it('email is normalized (case + whitespace) for dedupe; an email-only lead is valid', async () => {
        const { key, secret, sourceId } = await setup('email');
        const addr = `Case.${Date.now()}@Example.TEST`;
        const first = await h.webhook(route, key, secret, { email: `  ${addr} ` });
        expect(first.body).toMatchObject({ status: 'DONE', dedupeOutcome: 'new' });
        const second = await h.webhook(route, key, secret, {
          email_address: addr.toLowerCase(),
          name: 'N',
        });
        expect(second.body).toMatchObject({ status: 'DONE', dedupeOutcome: 'duplicate_update' });
        expect(second.body.leadId).toBe(first.body.leadId);
        const [lead] = await h.sql<{ normalized_email: string; normalized_phone: string | null }>(
          'select normalized_email, normalized_phone from leads where source_id = $1',
          [sourceId],
        );
        expect(lead).toMatchObject({
          normalized_email: addr.toLowerCase(),
          normalized_phone: null,
        });
      });

      it('phone-only and email-only variants of the same person match through whichever identity is present', async () => {
        const { key, secret } = await setup('identity');
        const p = phone();
        const email = `both.${Date.now()}@x.test`;
        const first = await h.webhook(route, key, secret, { phone: p, email });
        const byPhone = await h.webhook(route, key, secret, {
          phone: `(${p.slice(0, 3)}) ${p.slice(3)}`,
        });
        const byEmail = await h.webhook(route, key, secret, { email });
        expect(byPhone.body.leadId).toBe(first.body.leadId);
        expect(byEmail.body.leadId).toBe(first.body.leadId);
      });

      it('re-ingestion fills blanks only: never overwrites, never changes lead status, leaves a system note', async () => {
        const { key, secret, cookie } = await setup('enrich');
        const p = phone();
        const first = await h.webhook(route, key, secret, { name: 'Original', phone: p });
        await h.sql("update leads set status = 'CONTACTED' where id = $1", [first.body.leadId]);

        const again = await h.webhook(route, key, secret, {
          name: 'Overwrite?',
          phone: p,
          email: 'filled@x.test',
          city: 'Pune',
        });
        expect(again.body).toMatchObject({ status: 'DONE', dedupeOutcome: 'duplicate_update' });
        const [lead] = await h.sql<Record<string, unknown>>(
          'select name, email, city, status from leads where id = $1',
          [first.body.leadId],
        );
        expect(lead).toMatchObject({
          name: 'Original',
          email: 'filled@x.test',
          city: 'Pune',
          status: 'CONTACTED',
        });

        const acts = await h.http
          .get(`/api/v1/crm/leads/${first.body.leadId}/activities`)
          .set('Cookie', cookie);
        const note = acts.body.find(
          (a: { type: string; payload: { system?: boolean } }) =>
            a.type === 'note' && a.payload.system === true,
        );
        expect(note).toBeTruthy();
        expect(note.actorMembershipId).toBeNull();
        expect(note.payload.rawEventId).toBe(again.body.rawEventId);
      });

      it('a duplicate arriving via a second source keeps the lead’s ORIGINAL source attribution', async () => {
        const a = await setup('attr-a');
        const b = await setup('attr-b');
        const p = phone();
        const first = await h.webhook(route, a.key, a.secret, { name: 'Attr', phone: p });
        const second = await h.webhook(route, b.key, b.secret, { name: 'Attr', phone: p });
        expect(second.body.dedupeOutcome).toBe('duplicate_update');
        const [lead] = await h.sql<{ source_id: string }>(
          'select source_id from leads where id = $1',
          [first.body.leadId],
        );
        expect(lead!.source_id).toBe(a.sourceId);
      });
    });

    // ---- field mapping (persisted result) ------------------------------------

    describe('field mapping', () => {
      it('built-in defaults map canonical fields; unrecognised keys are kept as unmapped, never dropped', async () => {
        const { key, secret, sourceId } = await setup('map-default');
        const p = phone();
        await h.webhook(route, key, secret, {
          full_name: 'Mapped',
          mobile: p,
          emailAddress: 'm@x.test',
          pincode: '411001',
          utm_campaign: 'summer',
        });
        const [c] = await h.sql<{
          canonical: Record<string, string>;
          unmapped: Record<string, unknown>;
        }>('select canonical, unmapped from canonical_lead_events where source_id = $1', [
          sourceId,
        ]);
        expect(c!.canonical).toMatchObject({
          name: 'Mapped',
          phone: p,
          email: 'm@x.test',
          postalCode: '411001',
        });
        expect(c!.unmapped).toMatchObject({ utm_campaign: 'summer' });
      });

      it('one level of nesting is flattened to dot keys', async () => {
        const { key, secret, sourceId } = await setup('map-nested');
        const p = phone();
        await h.webhook(route, key, secret, {
          contact: { phone: p, city: 'Nashik' },
          form: { id: 7 },
        });
        const [c] = await h.sql<{
          canonical: Record<string, string>;
          unmapped: Record<string, unknown>;
        }>('select canonical, unmapped from canonical_lead_events where source_id = $1', [
          sourceId,
        ]);
        // "contact.phone" is not a default key -> unmapped until a source override maps it
        expect(c!.unmapped).toMatchObject({
          'contact.phone': p,
          'contact.city': 'Nashik',
          'form.id': 7,
        });
      });

      it('a per-source override wins over defaults; "skip" discards a field entirely', async () => {
        const { key, secret, sourceId } = await setup('map-override', {
          'contact.phone': 'canonical:phone',
          internal_note: 'skip',
          full_name: 'canonical:city', // override beats the built-in full_name -> name
        });
        const p = phone();
        const res = await h.webhook(route, key, secret, {
          contact: { phone: p },
          internal_note: 'do not keep',
          full_name: 'Overridden',
        });
        expect(res.body.status).toBe('DONE');
        const [c] = await h.sql<{
          canonical: Record<string, string>;
          unmapped: Record<string, unknown>;
        }>('select canonical, unmapped from canonical_lead_events where source_id = $1', [
          sourceId,
        ]);
        expect(c!.canonical.phone).toBe(p);
        expect(c!.canonical.city).toBe('Overridden');
        expect(c!.canonical.name).toBeUndefined();
        expect(JSON.stringify(c)).not.toContain('do not keep');
      });
    });

    // ---- authentication / credentials ----------------------------------------

    describe('authentication and credential lifecycle', () => {
      it('bearer parsing at the wire: case-insensitive scheme and extra spaces are accepted; other schemes are not', async () => {
        const { key, secret } = await setup('auth-wire');
        const send = (header: string) =>
          h.http.post(route.path(key)).set('Authorization', header).send({ phone: phone() });
        expect((await send(`bearer ${secret}`)).status).toBe(200);
        expect((await send(`Bearer   ${secret}`)).status).toBe(200);
        for (const bad of [`Basic ${secret}`, 'Bearer ', secret]) {
          const res = await send(bad);
          expect(res.status).toBe(401);
          expect(res.body.error.code).toBe('CONNECTOR_INVALID');
        }
      });

      it('rotation: same source id and key, new secret; the old one stops working immediately', async () => {
        const { key, secret, sourceId, cookie } = await setup('rotate');
        const rotated = await h.http
          .post(`/api/v1/admin/integrations/sources/${sourceId}/rotate-secret`)
          .set('Cookie', cookie);
        expect(rotated.status).toBe(200);
        expect(Object.keys(rotated.body).sort()).toEqual(['credential', 'source']);
        expect(Object.keys(rotated.body.credential)).toEqual(['secret']);
        expect(rotated.body.source).toMatchObject({ id: sourceId, key, status: 'active' });
        const next = rotated.body.credential.secret as string;
        expect(next).not.toBe(secret);

        const old = await h.webhook(route, key, secret, { phone: phone() });
        expect(old.status).toBe(401);
        expect(old.body.error.code).toBe('CONNECTOR_INVALID');
        expect((await h.webhook(route, key, next, { phone: phone() })).status).toBe(200);
      });

      it('revocation: 401 CONNECTOR_REVOKED with the standard error shape; reactivation restores the SAME secret', async () => {
        const { key, secret, sourceId, cookie } = await setup('revoke');
        await h.http
          .post(`/api/v1/admin/integrations/sources/${sourceId}/revoke`)
          .set('Cookie', cookie);
        const blocked = await h.webhook(route, key, secret, { phone: phone() });
        expect(blocked.status).toBe(401);
        expect(Object.keys(blocked.body.error).sort()).toEqual([
          'code',
          'correlationId',
          'message',
        ]);
        expect(blocked.body.error.code).toBe('CONNECTOR_REVOKED');
        expect(await count('raw_events', sourceId)).toBe(0); // nothing recorded for a revoked source

        await h.http
          .post(`/api/v1/admin/integrations/sources/${sourceId}/reactivate`)
          .set('Cookie', cookie);
        expect((await h.webhook(route, key, secret, { phone: phone() })).status).toBe(200);
      });

      it('the secret and its hash are never returned by the source list or event APIs', async () => {
        const { key, secret, cookie, sourceId } = await setup('no-leak');
        await h.webhook(route, key, secret, { phone: phone() });
        const list = await h.http.get('/api/v1/admin/integrations/sources').set('Cookie', cookie);
        const events = await h.http.get('/api/v1/admin/integrations/events').set('Cookie', cookie);
        const json = JSON.stringify([list.body, events.body]);
        expect(json).not.toContain(secret);
        expect(json).not.toMatch(/secret_?hash/i);
        const [row] = await h.sql<{ secret_hash: string }>(
          'select secret_hash from lead_sources where id = $1',
          [sourceId],
        );
        expect(row!.secret_hash).not.toBe(secret);
        expect(row!.secret_hash).toMatch(/^[0-9a-f]{64}$/);
      });
    });

    // ---- malformed input ---------------------------------------------------

    describe('malformed input', () => {
      it('syntactically invalid JSON is rejected before the pipeline: 400 VALIDATION_ERROR, nothing persisted', async () => {
        const { key, secret, sourceId } = await setup('bad-json');
        const res = await h.http
          .post(route.path(key))
          .set('Authorization', `Bearer ${secret}`)
          .set('Content-Type', 'application/json')
          .send('{"phone":');
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(await count('raw_events', sourceId)).toBe(0);
      });

      it('a JSON primitive body is rejected with 400 VALIDATION_ERROR', async () => {
        const { key, secret } = await setup('bad-primitive');
        const res = await h.http
          .post(route.path(key))
          .set('Authorization', `Bearer ${secret}`)
          .set('Content-Type', 'application/json')
          .send('"just a string"');
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });

      it.each([
        ['a JSON array', [1, 2, 3]],
        ['an empty object', {}],
      ])(
        '%s is recorded and fails identity validation (HTTP 200, no lead)',
        async (_label, body) => {
          const { key, secret, sourceId } = await setup('bad-shape');
          const res = await h.webhook(route, key, secret, body);
          expect(res.status).toBe(200);
          expect(res.body).toMatchObject({
            accepted: true,
            status: 'VALIDATION_FAILED',
            errorCode: 'LEAD_MISSING_IDENTITY',
          });
          expect(await count('raw_events', sourceId)).toBe(1);
          expect(await count('leads', sourceId)).toBe(0);
        },
      );
    });

    // ---- tenant isolation ------------------------------------------------------

    describe('tenant isolation', () => {
      it('tenant A’s secret cannot ingest into tenant B’s source key', async () => {
        const a = await setup('iso-a');
        const bCookie = await h.adminBCookie();
        const b = await h.createSource(bCookie, h.uniqueKey('iso-b'));
        const res = await h.webhook(route, b.key, a.secret, { phone: phone() });
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('CONNECTOR_INVALID');
        expect(await count('raw_events', b.sourceId)).toBe(0);
        expect(await count('raw_events', a.sourceId)).toBe(0);
      });

      it('the same person ingested into two tenants yields two independent leads; each tenant sees only its own', async () => {
        const a = await setup('iso-lead-a');
        const bCookie = await h.adminBCookie();
        const b = await h.createSource(bCookie, h.uniqueKey('iso-lead-b'));
        const p = phone();
        const ra = await h.webhook(route, a.key, a.secret, {
          id: 'SHARED-ID',
          name: 'Iso',
          phone: p,
        });
        const rb = await h.webhook(route, b.key, b.secret, {
          id: 'SHARED-ID',
          name: 'Iso',
          phone: p,
        });
        expect(ra.body.status).toBe('DONE');
        expect(rb.body.status).toBe('DONE'); // same provider id in another tenant is NOT a duplicate
        expect(ra.body.leadId).not.toBe(rb.body.leadId);

        const rows = await h.sql<{ id: string; tenant_id: string }>(
          'select id, tenant_id from leads where id = any($1)',
          [[ra.body.leadId, rb.body.leadId]],
        );
        expect(rows.find((r) => r.id === ra.body.leadId)!.tenant_id).toBe(h.fx.tenantA);
        expect(rows.find((r) => r.id === rb.body.leadId)!.tenant_id).toBe(h.fx.tenantB);

        expect(
          (await h.http.get(`/api/v1/crm/leads/${rb.body.leadId}`).set('Cookie', a.cookie)).status,
        ).toBe(404);
        expect(
          (await h.http.get(`/api/v1/crm/leads/${ra.body.leadId}`).set('Cookie', bCookie)).status,
        ).toBe(404);
      });

      it('a tenant_id inside the payload never influences routing', async () => {
        const a = await setup('iso-payload');
        const res = await h.webhook(route, a.key, a.secret, {
          tenant_id: h.fx.tenantB,
          tenantId: h.fx.tenantB,
          phone: phone(),
        });
        expect(res.body.status).toBe('DONE');
        const [lead] = await h.sql<{ tenant_id: string }>(
          'select tenant_id from leads where id = $1',
          [res.body.leadId],
        );
        expect(lead!.tenant_id).toBe(h.fx.tenantA);
      });
    });
  });

  // ---- KNOWN CURRENT GAPS -------------------------------------------------------
  // These document today's behaviour so a later phase changes it DELIBERATELY. They are not
  // contracts: UC-1 is expected to update or remove each of them, in the same commit as the fix.
  describe('known current gaps (not contracts; each is expected to change deliberately)', () => {
    it('idempotency is scoped per TENANT, not per source: a record id re-used on a second source in the same tenant is a DUPLICATE_EVENT', async () => {
      const cookie = await h.adminCookie();
      const route = WEBHOOK_ROUTES[0];
      const a = await h.createSource(cookie, h.uniqueKey('gap-scope-a'));
      const b = await h.createSource(cookie, h.uniqueKey('gap-scope-b'));
      const p = phone();
      const first = await h.webhook(route, a.key, a.secret, { id: 'SCOPE', phone: p });
      const second = await h.webhook(route, b.key, b.secret, { id: 'SCOPE', phone: p, name: 'x' });
      expect(first.body.status).toBe('DONE');
      expect(second.body.status).toBe('DUPLICATE_EVENT');
      expect(second.body.leadId).toBe(first.body.leadId);
    });

    // UC-1 fixed this gap deliberately: the raw event now reaches PROCESSED. The full lifecycle
    // (FAILED, duplicates, retry) is covered in integrations-hardening.int.spec.ts.
    it('raw_events.status advances to PROCESSED after successful processing (was RECEIVED before UC-1)', async () => {
      const cookie = await h.adminCookie();
      const { key, secret, sourceId } = await h.createSource(cookie, h.uniqueKey('gap-raw-status'));
      const res = await h.webhook(WEBHOOK_ROUTES[0], key, secret, { phone: phone() });
      expect(res.body.status).toBe('DONE');
      const [raw] = await h.sql<{ status: string }>(
        'select status from raw_events where source_id = $1',
        [sourceId],
      );
      expect(raw!.status).toBe('PROCESSED');
    });
  });
});
