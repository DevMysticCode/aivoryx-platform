import { createHmac, randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { startConnectorHarness, type ConnectorHarness } from './support/connector.js';
import { MetaGraphClient } from '../src/integrations/graph/meta-graph-client.js';

/**
 * Universal Connector — Meta Lead Ads native provider (UC-3). Proves the hydration lifecycle end
 * to end through the real HTTP surface: signature verification, the universal webhook route, the
 * reference -> hydrate -> canonical -> mapping -> dedupe -> CRM pipeline, idempotency, tenant
 * isolation of credentials, and the handshake endpoint. The Graph API is mocked at the DI boundary
 * (`MetaGraphClient`) — no real Meta credentials or network calls are used anywhere.
 */
describe.skipIf(!INTEGRATION_ENABLED)('Meta Lead Ads (UC-3)', () => {
  let h: ConnectorHarness;
  let retrieveLead: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    retrieveLead = vi.fn();
    h = await startConnectorHarness((builder) =>
      builder.overrideProvider(MetaGraphClient).useValue({ retrieveLead }),
    );
  });
  afterAll(async () => h?.close());
  afterEach(() => retrieveLead.mockReset());

  const APP_SECRET = 'meta-app-secret';
  const PAGE_TOKEN = 'meta-page-token';
  const VERIFY_TOKEN = 'meta-verify-token';

  const leadgenBody = (leadgenId: string) => ({
    object: 'page',
    entry: [
      {
        id: '111',
        time: 1700000000,
        changes: [
          { field: 'leadgen', value: { leadgen_id: leadgenId, page_id: '111', form_id: '222' } },
        ],
      },
    ],
  });
  const sign = (bodyObj: unknown, secret = APP_SECRET) => {
    const bytes = Buffer.from(JSON.stringify(bodyObj));
    return `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`;
  };
  const postMeta = (publicLookupKey: string, bodyObj: unknown, signature?: string) => {
    const req = h.http
      .post(`/api/v1/integrations/webhooks/${publicLookupKey}`)
      .set('Content-Type', 'application/json');
    if (signature) req.set('X-Hub-Signature-256', signature);
    return req.send(JSON.stringify(bodyObj));
  };

  const setupMetaSource = async () => {
    const cookie = await h.adminCookie();
    const { sourceId, publicLookupKey } = await h.createMetaSource(cookie, h.uniqueKey('meta'));
    const credRes = await h.setCredentials(cookie, sourceId, {
      appSecret: APP_SECRET,
      pageAccessToken: PAGE_TOKEN,
      verifyToken: VERIFY_TOKEN,
    });
    expect(credRes.status).toBe(200);
    expect(credRes.body.hasCredentials).toBe(true);
    return { cookie, sourceId, publicLookupKey };
  };
  const count = async (table: string, sourceId: string) =>
    Number(
      (
        await h.sql<{ n: string }>(`select count(*) n from ${table} where source_id = $1`, [
          sourceId,
        ])
      )[0]!.n,
    );

  describe('connection + credential setup', () => {
    it('creating a Meta source mints a public lookup key and no bearer secret is needed', async () => {
      const { sourceId } = await setupMetaSource();
      const [row] = await h.sql<{ secret_hash: string; public_lookup_key: string }>(
        'select secret_hash, public_lookup_key from lead_sources where id = $1',
        [sourceId],
      );
      expect(row!.public_lookup_key).toBeTruthy();
      expect(row!.secret_hash).toMatch(/^[0-9a-f]{64}$/); // minted anyway, simply unused by Meta
    });

    it('credentials are encrypted at rest — the plaintext app secret/token never appear in the DB row', async () => {
      const { sourceId } = await setupMetaSource();
      const [row] = await h.sql('select * from connector_credentials where source_id = $1', [
        sourceId,
      ]);
      const raw = JSON.stringify(row);
      expect(raw).not.toContain(APP_SECRET);
      expect(raw).not.toContain(PAGE_TOKEN);
      expect(raw).not.toContain(VERIFY_TOKEN);
    });

    it('credentials are never returned by any admin API response', async () => {
      const { cookie, sourceId } = await setupMetaSource();
      const list = await h.http.get('/api/v1/admin/integrations/sources').set('Cookie', cookie);
      const one = await h.http
        .get(`/api/v1/admin/integrations/sources/${sourceId}`)
        .set('Cookie', cookie);
      for (const body of [list.body, one.body]) {
        const raw = JSON.stringify(body);
        expect(raw).not.toContain(APP_SECRET);
        expect(raw).not.toContain(PAGE_TOKEN);
        expect(raw).not.toContain(VERIFY_TOKEN);
      }
    });
  });

  describe('signature verification', () => {
    it('valid signature + successful hydration creates a CRM lead', async () => {
      const { cookie, publicLookupKey, sourceId } = await setupMetaSource();
      retrieveLead.mockResolvedValue({
        id: 'LEAD-OK',
        createdTime: '2024-01-01T00:00:00Z',
        adId: '333',
        formId: '222',
        fieldData: [
          { name: 'full_name', values: ['Jane Doe'] },
          { name: 'email', values: ['jane@example.test'] },
        ],
      });
      const body = leadgenBody('LEAD-OK');
      const res = await postMeta(publicLookupKey, body, sign(body));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ accepted: true, status: 'DONE', dedupeOutcome: 'new' });
      expect(retrieveLead).toHaveBeenCalledWith('LEAD-OK', PAGE_TOKEN);

      const lead = await h.http.get(`/api/v1/crm/leads/${res.body.leadId}`).set('Cookie', cookie);
      expect(lead.body).toMatchObject({ name: 'Jane Doe', email: 'jane@example.test', sourceId });
    });

    it('missing signature is rejected before anything is persisted', async () => {
      const { publicLookupKey, sourceId } = await setupMetaSource();
      const res = await postMeta(publicLookupKey, leadgenBody('LEAD-X'));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CONNECTOR_INVALID');
      expect(await count('raw_events', sourceId)).toBe(0);
      expect(retrieveLead).not.toHaveBeenCalled();
    });

    it('an invalid (wrong-secret) signature is rejected; nothing persisted, Graph API never called', async () => {
      const { publicLookupKey, sourceId } = await setupMetaSource();
      const body = leadgenBody('LEAD-Y');
      const res = await postMeta(publicLookupKey, body, sign(body, 'not-the-right-secret'));
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CONNECTOR_INVALID');
      expect(await count('raw_events', sourceId)).toBe(0);
      expect(retrieveLead).not.toHaveBeenCalled();
    });

    it('a body modified after signing is rejected', async () => {
      const { publicLookupKey } = await setupMetaSource();
      const signedForThis = sign(leadgenBody('LEAD-ORIGINAL'));
      const res = await postMeta(publicLookupKey, leadgenBody('LEAD-TAMPERED'), signedForThis);
      expect(res.status).toBe(401);
    });

    it('an unknown public lookup key is rejected the same way as an unknown Pabbly secret', async () => {
      const res = await postMeta(
        'does-not-exist',
        leadgenBody('LEAD-Z'),
        'sha256=' + 'a'.repeat(64),
      );
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('CONNECTOR_INVALID');
    });
  });

  describe('hydration failures', () => {
    it('signature verifies fine; hydration fails because NO page access token is configured — not CONNECTOR_INVALID, no lead, no secret leaked, redelivery stays non-retryable', async () => {
      // Realistic admin misconfiguration: the app secret (for signature verification) is set, but
      // the page access token (needed only afterward, by hydrate()) never was.
      const cookie = await h.adminCookie();
      const { sourceId, publicLookupKey } = await h.createMetaSource(
        cookie,
        h.uniqueKey('meta-no-token'),
      );
      const credRes = await h.setCredentials(cookie, sourceId, {
        appSecret: APP_SECRET,
        verifyToken: VERIFY_TOKEN,
        // pageAccessToken deliberately omitted
      });
      expect(credRes.status).toBe(200);
      expect(credRes.body.hasCredentials).toBe(true);

      const body = leadgenBody('LEAD-NO-TOKEN');
      const res = await postMeta(publicLookupKey, body, sign(body));

      // the signature itself is valid -- this must NOT be reported as a connector/auth boundary
      // failure (CONNECTOR_INVALID is for a bad secret/signature, not a missing downstream credential)
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.code).not.toBe('CONNECTOR_INVALID');
      expect(JSON.stringify(res.body)).not.toContain(APP_SECRET);
      expect(JSON.stringify(res.body)).not.toContain(VERIFY_TOKEN);
      expect(retrieveLead).not.toHaveBeenCalled(); // never reached the Graph API at all

      expect(await count('leads', sourceId)).toBe(0);
      const [raw] = await h.sql<{ status: string }>(
        'select status from raw_events where source_id = $1',
        [sourceId],
      );
      expect(raw!.status).toBe('FAILED');
      const [canon] = await h.sql<{
        status: string;
        last_error_code: string;
        lead_id: string | null;
      }>(
        'select status, last_error_code, lead_id from canonical_lead_events where source_id = $1',
        [sourceId],
      );
      // classified as a provider AUTHENTICATION/configuration failure, not a generic/internal one
      expect(canon).toMatchObject({
        status: 'FAILED',
        last_error_code: 'PROVIDER_AUTH_FAILED',
        lead_id: null,
      });

      // redelivery: PROVIDER_AUTH_FAILED is non-retryable (same family as the 404 case below) --
      // Meta resending the identical body stays a DUPLICATE_RAW, never a fresh hydration attempt
      retrieveLead.mockClear();
      const redelivered = await postMeta(publicLookupKey, body, sign(body));
      expect(redelivered.body.status).toBe('DUPLICATE_RAW');
      expect(retrieveLead).not.toHaveBeenCalled();
      expect(await count('leads', sourceId)).toBe(0);
    });

    it('a 404 from the Graph API fails the event without creating a lead, and is not auto-retried on redelivery', async () => {
      const { publicLookupKey, sourceId } = await setupMetaSource();
      const { HydrationError } = await import('../src/integrations/adapters/connector-adapter.js');
      retrieveLead.mockRejectedValue(new HydrationError('PROVIDER_RECORD_NOT_FOUND', 'gone'));
      const body = leadgenBody('LEAD-404');
      const res = await postMeta(publicLookupKey, body, sign(body));
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(await count('leads', sourceId)).toBe(0);

      const [canon] = await h.sql<{
        status: string;
        last_error_code: string;
        lead_id: string | null;
      }>(
        'select status, last_error_code, lead_id from canonical_lead_events where source_id = $1',
        [sourceId],
      );
      expect(canon).toMatchObject({
        status: 'FAILED',
        last_error_code: 'PROVIDER_RECORD_NOT_FOUND',
        lead_id: null,
      });

      // Meta redelivers the identical body — not-found is NOT retried automatically (permanent)
      retrieveLead.mockClear();
      const redelivered = await postMeta(publicLookupKey, body, sign(body));
      expect(redelivered.body.status).toBe('DUPLICATE_RAW');
      expect(retrieveLead).not.toHaveBeenCalled();
    });

    it('a rate-limited (retryable) hydration failure IS retried when Meta redelivers the same event', async () => {
      const { publicLookupKey, sourceId } = await setupMetaSource();
      const { HydrationError } = await import('../src/integrations/adapters/connector-adapter.js');
      retrieveLead.mockRejectedValueOnce(new HydrationError('PROVIDER_RATE_LIMITED', 'slow down'));
      const body = leadgenBody('LEAD-RETRY');
      const first = await postMeta(publicLookupKey, body, sign(body));
      expect(first.status).toBe(500);
      expect(await count('leads', sourceId)).toBe(0);

      retrieveLead.mockResolvedValueOnce({
        id: 'LEAD-RETRY',
        createdTime: null,
        adId: null,
        formId: null,
        fieldData: [{ name: 'phone_number', values: ['9811100099'] }],
      });
      const redelivered = await postMeta(publicLookupKey, body, sign(body));
      expect(redelivered.body).toMatchObject({ status: 'DONE', dedupeOutcome: 'new' });
      expect(await count('leads', sourceId)).toBe(1);
    });
  });

  describe('idempotency', () => {
    it('the exact same webhook delivered twice does not create a duplicate lead', async () => {
      const { publicLookupKey, sourceId } = await setupMetaSource();
      retrieveLead.mockResolvedValue({
        id: 'LEAD-DUP',
        createdTime: null,
        adId: null,
        formId: null,
        fieldData: [{ name: 'phone_number', values: ['9822200088'] }],
      });
      const body = leadgenBody('LEAD-DUP');
      const first = await postMeta(publicLookupKey, body, sign(body));
      const second = await postMeta(publicLookupKey, body, sign(body));
      expect(first.body.status).toBe('DONE');
      expect(second.body.status).toBe('DUPLICATE_RAW');
      expect(second.body.leadId).toBe(first.body.leadId);
      expect(await count('leads', sourceId)).toBe(1);
      expect(retrieveLead).toHaveBeenCalledTimes(1); // the duplicate never re-hydrates
    });

    it('the same leadgen_id wrapped in a structurally different webhook body is still one event', async () => {
      const { publicLookupKey, sourceId } = await setupMetaSource();
      retrieveLead.mockResolvedValue({
        id: 'LEAD-SAME-ID',
        createdTime: null,
        adId: null,
        formId: null,
        fieldData: [{ name: 'phone_number', values: ['9833300077'] }],
      });
      const first = await postMeta(
        publicLookupKey,
        leadgenBody('LEAD-SAME-ID'),
        sign(leadgenBody('LEAD-SAME-ID')),
      );
      const differentShape = {
        object: 'page',
        entry: [
          {
            id: '111',
            time: 1800000000, // different "time" -> different raw bytes/hash -> NOT a raw duplicate
            changes: [{ field: 'leadgen', value: { leadgen_id: 'LEAD-SAME-ID', page_id: '999' } }],
          },
        ],
      };
      const second = await postMeta(publicLookupKey, differentShape, sign(differentShape));
      expect(first.body.status).toBe('DONE');
      expect(second.body.status).toBe('DUPLICATE_EVENT');
      expect(second.body.leadId).toBe(first.body.leadId);
      expect(await count('leads', sourceId)).toBe(1);
    });
  });

  describe('tenant isolation', () => {
    it('hydration can only ever use its OWN tenant/source credential, never another tenant’s', async () => {
      const a = await setupMetaSource();
      const bCookie = await h.adminBCookie();
      const { sourceId: bSourceId, publicLookupKey: bKey } = await h.createMetaSource(
        bCookie,
        h.uniqueKey('meta-b'),
      );
      await h.setCredentials(bCookie, bSourceId, {
        appSecret: 'tenant-b-app-secret',
        pageAccessToken: 'tenant-b-page-token',
        verifyToken: 'tenant-b-verify',
      });

      retrieveLead.mockResolvedValue({
        id: 'X',
        createdTime: null,
        adId: null,
        formId: null,
        fieldData: [],
      });
      const body = leadgenBody('LEAD-TENANT-B');
      const res = await postMeta(bKey, body, sign(body, 'tenant-b-app-secret'));
      expect(res.status).toBe(200);
      expect(retrieveLead).toHaveBeenCalledWith('LEAD-TENANT-B', 'tenant-b-page-token');
      void a;
    });

    it('tenant A cannot read or write tenant B’s source credentials', async () => {
      const bCookie = await h.adminBCookie();
      const b = await h.createMetaSource(bCookie, h.uniqueKey('iso-b'));
      const aCookie = await h.adminCookie();
      const getAsA = await h.http
        .get(`/api/v1/admin/integrations/sources/${b.sourceId}`)
        .set('Cookie', aCookie);
      expect(getAsA.status).toBe(404);
      const writeAsA = await h.setCredentials(aCookie, b.sourceId, { appSecret: 'hijack' });
      expect(writeAsA.status).toBe(404);
    });

    it('is enforced at the database level by RLS, not just the application', async () => {
      const bCookie = await h.adminBCookie();
      const b = await h.createMetaSource(bCookie, h.uniqueKey('rls-b'));
      await h.setCredentials(bCookie, b.sourceId, { appSecret: 'b-secret' });

      const db = await import('@aivoryx/db');
      const { sql } = await import('drizzle-orm');
      // tenant A's RLS context, querying tenant B's row directly — the row EXISTS, but must not
      // be visible, proving isolation at the database layer rather than only in SourcesService.
      const rows = await db.withTenantContext(
        db.getDb(),
        { tenantId: h.fx.tenantA, userId: h.fx.admin.userId },
        async (tx) =>
          (
            await tx.execute(
              sql`select 1 from connector_credentials where source_id = ${b.sourceId}`,
            )
          ).rows,
      );
      expect(rows).toHaveLength(0);

      const fromSuperuser = await h.sql(
        'select 1 from connector_credentials where source_id = $1',
        [b.sourceId],
      );
      expect(fromSuperuser).toHaveLength(1); // confirms the row genuinely exists, RLS just hides it
    });
  });

  describe('webhook handshake (GET, separate from POST ingestion)', () => {
    it('a valid verify_token echoes the challenge back', async () => {
      const { publicLookupKey } = await setupMetaSource();
      const res = await h.http.get(
        `/api/v1/integrations/webhooks/${publicLookupKey}/handshake` +
          `?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`,
      );
      expect(res.status).toBe(200);
      expect(res.text).toBe('12345');
    });

    it('an invalid verify_token is rejected and the challenge is never echoed', async () => {
      const { publicLookupKey } = await setupMetaSource();
      const res = await h.http.get(
        `/api/v1/integrations/webhooks/${publicLookupKey}/handshake` +
          `?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=12345`,
      );
      expect(res.status).toBe(403);
      expect(res.text).not.toContain('12345');
    });

    it('missing parameters are rejected', async () => {
      const { publicLookupKey } = await setupMetaSource();
      const res = await h.http.get(`/api/v1/integrations/webhooks/${publicLookupKey}/handshake`);
      expect(res.status).toBe(403);
    });

    it('an unknown source key is rejected without revealing whether the key exists', async () => {
      const res = await h.http.get(
        `/api/v1/integrations/webhooks/${randomBytes(16).toString('base64url')}/handshake` +
          `?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=99`,
      );
      expect(res.status).toBe(403);
    });

    it('the handshake never touches ingestion — no raw event is created', async () => {
      const { publicLookupKey, sourceId } = await setupMetaSource();
      await h.http.get(
        `/api/v1/integrations/webhooks/${publicLookupKey}/handshake` +
          `?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1`,
      );
      expect(await count('raw_events', sourceId)).toBe(0);
    });
  });

  describe('backward compatibility', () => {
    it('an unregistered connector type is rejected at source-creation time', async () => {
      const cookie = await h.adminCookie();
      const res = await h.http
        .post('/api/v1/admin/integrations/sources')
        .set('Cookie', cookie)
        .send({ key: h.uniqueKey('bad'), name: 'x', connectorType: 'not_a_real_provider' });
      expect(res.status).toBe(400);
    });
  });
});
