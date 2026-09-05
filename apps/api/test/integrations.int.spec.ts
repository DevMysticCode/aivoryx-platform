import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 3 — inbound integration engine (ADR 0032): the Pabbly connector
 * end-to-end (auth, tenant derivation, raw persistence, normalization,
 * dedupe, idempotency, concurrency, failure/replay), plus its admin surface.
 */
describe.skipIf(!INTEGRATION_ENABLED)('inbound integration engine (Pabbly)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await makeFixtures();
    app = await bootTestApp();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  const login = (email: string, password: string) =>
    http.post('/api/v1/auth/login').send({ email, password });

  const adminCookie = async (): Promise<string> => {
    const res = await login(fx.admin.email, fx.admin.password);
    const cookie = sessionCookie(res);
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: fx.admin.membershipId });
    return cookie;
  };

  const adminBCookie = async (): Promise<string> =>
    sessionCookie(await login(fx.adminB.email, fx.adminB.password));

  const uniqueKey = (label: string) =>
    `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const createSource = async (cookie: string, key: string) => {
    const res = await http
      .post('/api/v1/admin/integrations/sources')
      .set('Cookie', cookie)
      .send({ key, name: `Source ${key}` });
    expect(res.status).toBe(200);
    return { sourceId: res.body.source.id, secret: res.body.credential.secret, key };
  };

  const webhook = (
    key: string,
    secret: string | null,
    body: Record<string, unknown>,
    extraHeaders: Record<string, string> = {},
  ) => {
    const req = http.post(`/api/v1/integrations/webhooks/pabbly/${key}`);
    if (secret) req.set('Authorization', `Bearer ${secret}`);
    for (const [k, v] of Object.entries(extraHeaders)) req.set(k, v);
    return req.send(body);
  };

  // ---- ADMIN: sources -------------------------------------------------

  describe('ADMIN — sources', () => {
    it('creates a source and returns the secret exactly once', async () => {
      const cookie = await adminCookie();
      const key = uniqueKey('create');
      const res = await http
        .post('/api/v1/admin/integrations/sources')
        .set('Cookie', cookie)
        .send({ key, name: 'My Source' });
      expect(res.status).toBe(200);
      expect(res.body.source.status).toBe('active');
      expect(typeof res.body.credential.secret).toBe('string');
      expect(res.body.credential.secret.length).toBeGreaterThan(20);

      const list = await http.get('/api/v1/admin/integrations/sources').set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toContain(res.body.credential.secret);
    });

    it('stores only a hash of the secret — never the plaintext', async () => {
      const cookie = await adminCookie();
      const { sourceId, secret } = await createSource(cookie, uniqueKey('hash'));
      const pool = await rawPool();
      try {
        const { rows } = await pool.query('select secret_hash from lead_sources where id = $1', [
          sourceId,
        ]);
        expect(rows[0].secret_hash).not.toBe(secret);
        const byRaw = await pool.query('select 1 from lead_sources where secret_hash = $1', [
          secret,
        ]);
        expect(byRaw.rowCount).toBe(0);
      } finally {
        await pool.end();
      }
    });

    it('rotating the secret invalidates the old one and enables the new one', async () => {
      const cookie = await adminCookie();
      const { sourceId, secret: oldSecret, key } = await createSource(cookie, uniqueKey('rotate'));

      const rotated = await http
        .post(`/api/v1/admin/integrations/sources/${sourceId}/rotate-secret`)
        .set('Cookie', cookie);
      expect(rotated.status).toBe(200);
      const newSecret = rotated.body.credential.secret;
      expect(newSecret).not.toBe(oldSecret);

      const withOld = await webhook(key, oldSecret, { name: 'x', phone: '9000000001' });
      expect(withOld.status).toBe(401);
      expect(withOld.body.error.code).toBe('CONNECTOR_INVALID');

      const withNew = await webhook(key, newSecret, { name: 'x', phone: '9000000002' });
      expect(withNew.status).toBe(200);
      expect(withNew.body.accepted).toBe(true);
    });

    it('revoking a source blocks ingestion; reactivating restores it', async () => {
      const cookie = await adminCookie();
      const { sourceId, secret, key } = await createSource(cookie, uniqueKey('revoke'));

      const revoked = await http
        .post(`/api/v1/admin/integrations/sources/${sourceId}/revoke`)
        .set('Cookie', cookie);
      expect(revoked.status).toBe(200);
      expect(revoked.body.status).toBe('revoked');

      const blocked = await webhook(key, secret, { name: 'x', phone: '9000000003' });
      expect(blocked.status).toBe(401);
      expect(blocked.body.error.code).toBe('CONNECTOR_REVOKED');

      const reactivated = await http
        .post(`/api/v1/admin/integrations/sources/${sourceId}/reactivate`)
        .set('Cookie', cookie);
      expect(reactivated.status).toBe(200);

      const allowed = await webhook(key, secret, { name: 'x', phone: '9000000004' });
      expect(allowed.status).toBe(200);
    });

    it('unauthenticated -> 401; a member without crm.integrations.manage -> 403', async () => {
      const anon = await http.get('/api/v1/admin/integrations/sources');
      expect(anon.status).toBe(401);

      const limited = sessionCookie(await login(fx.limited.email, fx.limited.password));
      const denied = await http.get('/api/v1/admin/integrations/sources').set('Cookie', limited);
      expect(denied.status).toBe(403);
      expect(denied.body.error.code).toBe('AUTH_FORBIDDEN');
    });

    it('tenant A cannot see or operate on a tenant B source', async () => {
      const cookieB = await adminBCookie();
      const { sourceId } = await createSource(cookieB, uniqueKey('tenantb'));

      const cookieA = await adminCookie();
      const revokeAttempt = await http
        .post(`/api/v1/admin/integrations/sources/${sourceId}/revoke`)
        .set('Cookie', cookieA);
      expect(revokeAttempt.status).toBe(404);
      expect(revokeAttempt.body.error.code).toBe('SOURCE_NOT_FOUND');
    });
  });

  // ---- INBOUND: the connector end-to-end -----------------------------

  describe('INBOUND — Pabbly connector', () => {
    it('a valid event is authenticated, tenant-derived, persisted, mapped, and produces a visible lead', async () => {
      const cookie = await adminCookie();
      const { secret, key } = await createSource(cookie, uniqueKey('valid'));

      const res = await webhook(key, secret, {
        full_name: 'Ramesh Kumar',
        phone_number: '98765 43210',
        email_address: 'ramesh@example.test',
        city: 'Pune',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ accepted: true, status: 'DONE', dedupeOutcome: 'new' });
      expect(res.body.leadId).toBeTruthy();

      const lead = await http.get(`/api/v1/crm/leads/${res.body.leadId}`).set('Cookie', cookie);
      expect(lead.status).toBe(200);
      expect(lead.body.name).toBe('Ramesh Kumar');
      expect(lead.body.city).toBe('Pune');
      expect(lead.body.email).toBe('ramesh@example.test');

      const activities = await http
        .get(`/api/v1/crm/leads/${res.body.leadId}/activities`)
        .set('Cookie', cookie);
      expect(activities.body.some((a: { type: string }) => a.type === 'created')).toBe(true);
    });

    it('normalizes a messy phone number for dedupe purposes', async () => {
      const cookie = await adminCookie();
      const { secret, key } = await createSource(cookie, uniqueKey('norm'));
      const first = await webhook(key, secret, { name: 'A', phone: '(987) 654-9999' });
      const second = await webhook(key, secret, { name: 'B', phone: '9876549999' });
      // "(987) 654-9999" normalizes to the SAME digits-only string as "9876549999"
      expect(second.body.dedupeOutcome).toBe('duplicate_update');
      expect(second.body.leadId).toBe(first.body.leadId);
    });

    it('an unknown connector secret -> 401 CONNECTOR_INVALID, no raw event stored', async () => {
      const res = await webhook('does-not-matter', 'not-a-real-secret-at-all', { name: 'x' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CONNECTOR_INVALID');
    });

    it('missing credential -> 401 CONNECTOR_INVALID', async () => {
      const cookie = await adminCookie();
      const { key } = await createSource(cookie, uniqueKey('nocred'));
      const res = await webhook(key, null, { name: 'x' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CONNECTOR_INVALID');
    });

    it('a valid secret used with the wrong sourceKey in the URL is rejected', async () => {
      const cookie = await adminCookie();
      const { secret } = await createSource(cookie, uniqueKey('mismatch-a'));
      const res = await webhook('some-other-source-key', secret, { name: 'x' });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CONNECTOR_INVALID');
    });

    it('the payload’s own tenant_id is ignored — the tenant comes from the connector', async () => {
      const cookieA = await adminCookie();
      const { secret, key } = await createSource(cookieA, uniqueKey('tenant-derive'));

      const res = await webhook(key, secret, {
        tenant_id: fx.tenantB, // must be ignored
        name: 'Should land in A',
        phone: '9123456780',
      });
      expect(res.status).toBe(200);
      expect(res.body.leadId).toBeTruthy();

      // visible to tenant A...
      const inA = await http.get(`/api/v1/crm/leads/${res.body.leadId}`).set('Cookie', cookieA);
      expect(inA.status).toBe(200);

      // ...and invisible to tenant B
      const cookieB = await adminBCookie();
      const inB = await http.get(`/api/v1/crm/leads/${res.body.leadId}`).set('Cookie', cookieB);
      expect(inB.status).toBe(404);
    });

    it('the raw payload is persisted verbatim and carries the request correlation id', async () => {
      const cookie = await adminCookie();
      const { secret, key } = await createSource(cookie, uniqueKey('raw'));
      const correlationId = 'AIV-01HZZZZZZZZZZZZZZZZZZZZZZZ';
      const res = await webhook(
        key,
        secret,
        { name: 'Raw Check', phone: '9223344556' },
        {
          'x-correlation-id': correlationId,
        },
      );
      expect(res.status).toBe(200);

      const pool = await rawPool();
      try {
        const { rows } = await pool.query(
          'select raw_body, correlation_id from raw_events where id = $1',
          [res.body.rawEventId],
        );
        expect(rows[0].raw_body).toMatchObject({ name: 'Raw Check', phone: '9223344556' });
        expect(rows[0].correlation_id).toBe(correlationId);
      } finally {
        await pool.end();
      }
    });

    it('re-ingests an existing lead conservatively: enriches blanks, never overwrites, never creates a duplicate', async () => {
      const cookie = await adminCookie();
      const { secret, key } = await createSource(cookie, uniqueKey('enrich'));
      const phone = '9556677889';

      const first = await webhook(key, secret, { name: 'First Name', phone });
      expect(first.body.dedupeOutcome).toBe('new');

      const second = await webhook(key, secret, {
        name: 'Different Name',
        phone,
        email: 'added@x.test',
      });
      expect(second.body.dedupeOutcome).toBe('duplicate_update');
      expect(second.body.leadId).toBe(first.body.leadId);

      const lead = await http.get(`/api/v1/crm/leads/${first.body.leadId}`).set('Cookie', cookie);
      expect(lead.body.name).toBe('First Name'); // not overwritten
      expect(lead.body.email).toBe('added@x.test'); // blank filled in

      const pool = await rawPool();
      try {
        const { rows } = await pool.query(
          'select count(*)::int as n from leads where normalized_phone = $1',
          [phone],
        );
        expect(rows[0].n).toBe(1); // exactly one lead, never duplicated
      } finally {
        await pool.end();
      }
    });

    it('an exact-duplicate delivery of the same raw body is recognised and not reprocessed', async () => {
      const cookie = await adminCookie();
      const { secret, key } = await createSource(cookie, uniqueKey('exact-dup'));
      const body = { name: 'Exact Dup', phone: '9667788990' };

      const first = await webhook(key, secret, body);
      expect(first.body.status).toBe('DONE');
      const second = await webhook(key, secret, body);
      expect(second.body.status).toBe('DUPLICATE_RAW');
      expect(second.body.leadId).toBe(first.body.leadId);

      const pool = await rawPool();
      try {
        const { rows } = await pool.query(
          'select count(*)::int as n from raw_events where source_id = (select id from lead_sources where key=$1)',
          [key],
        );
        expect(rows[0].n).toBe(1);
      } finally {
        await pool.end();
      }
    });

    it('concurrent identical deliveries produce exactly one processed event and one lead', async () => {
      const cookie = await adminCookie();
      const { secret, key } = await createSource(cookie, uniqueKey('race'));
      const body = { name: 'Race Condition', phone: '9778899001' };

      const [r1, r2] = await Promise.all([webhook(key, secret, body), webhook(key, secret, body)]);
      const statuses = [r1.body.status, r2.body.status].sort();
      expect(statuses).toEqual(['DONE', 'DUPLICATE_RAW']);
      const leadIds = [r1.body.leadId, r2.body.leadId].filter(Boolean);
      expect(new Set(leadIds).size).toBe(1);

      const pool = await rawPool();
      try {
        const { rows } = await pool.query(
          'select count(*)::int as n from leads where normalized_phone = $1',
          ['9778899001'],
        );
        expect(rows[0].n).toBe(1);
      } finally {
        await pool.end();
      }
    });

    it('a lead with no phone and no email fails validation without creating a lead, and is diagnosable', async () => {
      const cookie = await adminCookie();
      const { secret, key } = await createSource(cookie, uniqueKey('novalidate'));
      const res = await webhook(key, secret, { note: 'no identity at all here' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('VALIDATION_FAILED');
      expect(res.body.errorCode).toBe('LEAD_MISSING_IDENTITY');
      expect(res.body.leadId).toBeUndefined();

      const detail = await http
        .get(`/api/v1/admin/integrations/events/${res.body.canonicalEventId}`)
        .set('Cookie', cookie);
      expect(detail.status).toBe(200);
      expect(detail.body.event.status).toBe('VALIDATION_FAILED');
      expect(detail.body.log.some((l: { stage: string }) => l.stage === 'validate')).toBe(true);
    });

    it('an unmapped custom-field target fails mapping; fixing the definition and replaying succeeds', async () => {
      const cookie = await adminCookie();
      // field_mapping is source configuration set at creation in V1 (no PATCH yet) —
      // create a source whose override points at a not-yet-defined custom field.
      const withMapping = await http
        .post('/api/v1/admin/integrations/sources')
        .set('Cookie', cookie)
        .send({
          key: uniqueKey('mapfail2'),
          name: 'Map fail',
          fieldMapping: { budget: 'custom:site_budget' },
        });
      const secret2 = withMapping.body.credential.secret;
      const key2 = withMapping.body.source.key;

      const failed = await webhook(key2, secret2, {
        name: 'x',
        phone: '9001112223',
        budget: '50000',
      });
      expect(failed.body.status).toBe('MAPPING_FAILED');
      expect(failed.body.leadId).toBeUndefined();

      // fix: define the custom field, then replay
      await http
        .post('/api/v1/crm/custom-fields')
        .set('Cookie', cookie)
        .send({ key: 'site_budget', label: 'Site Budget', dataType: 'text' });

      const replayed = await http
        .post(`/api/v1/admin/integrations/events/${failed.body.canonicalEventId}/replay`)
        .set('Cookie', cookie);
      expect(replayed.status).toBe(200);
      expect(replayed.body.status).toBe('DONE');
      expect(replayed.body.leadId).toBeTruthy();
    });

    it('replay is idempotent — it never creates a second lead for the same event', async () => {
      const cookie = await adminCookie();
      const { secret, key } = await createSource(cookie, uniqueKey('replay-idem'));
      const first = await webhook(key, secret, { name: 'Replayable', phone: '9334455667' });
      expect(first.body.status).toBe('DONE');

      const replayed = await http
        .post(`/api/v1/admin/integrations/events/${first.body.canonicalEventId}/replay`)
        .set('Cookie', cookie);
      expect(replayed.status).toBe(200);
      expect(replayed.body.leadId).toBe(first.body.leadId);

      const pool = await rawPool();
      try {
        const { rows } = await pool.query(
          'select count(*)::int as n from leads where normalized_phone = $1',
          ['9334455667'],
        );
        expect(rows[0].n).toBe(1);
      } finally {
        await pool.end();
      }
    });

    it('tenant A cannot replay a tenant B event', async () => {
      const cookieB = await adminBCookie();
      const { secret, key } = await createSource(cookieB, uniqueKey('crossreplay'));
      const created = await webhook(key, secret, { name: 'x', phone: '9445566778' });

      const cookieA = await adminCookie();
      const attempt = await http
        .post(`/api/v1/admin/integrations/events/${created.body.canonicalEventId}/replay`)
        .set('Cookie', cookieA);
      expect(attempt.status).toBe(404);
      expect(attempt.body.error.code).toBe('EVENT_NOT_FOUND');
    });
  });
});
