import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import {
  startConnectorHarness,
  WEBHOOK_ROUTES,
  type ConnectorHarness,
} from './support/connector.js';

const route = WEBHOOK_ROUTES[0];

/**
 * UC-4 — Integration Center backend additions: source detail, source configuration update
 * (name/fieldMapping only), provider metadata, and paginated/filterable events.
 *
 * Same style as the UC-0/UC-3 suites: drive the system through its public HTTP API, read
 * persisted side effects with plain SQL, never reference application classes.
 */
describe.skipIf(!INTEGRATION_ENABLED)('Integration Center (UC-4)', () => {
  let h: ConnectorHarness;

  beforeAll(async () => {
    h = await startConnectorHarness();
  });
  afterAll(async () => h?.close());

  const phone = () => `8${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  // ---- GET /admin/integrations/sources/:id -------------------------------

  describe('GET sources/:id', () => {
    it('returns the same shape as the list entry for the caller’s own tenant', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('detail-ok'));
      const res = await h.http
        .get(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: created.sourceId, key: created.key });
      expect(JSON.stringify(res.body)).not.toContain(created.secret);
    });

    it('404s for a source belonging to another tenant', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('detail-iso'));
      const bCookie = await h.adminBCookie();
      const res = await h.http
        .get(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', bCookie);
      expect(res.status).toBe(404);
    });

    it('401s with no session at all', async () => {
      const res = await h.http.get(
        `/api/v1/admin/integrations/sources/00000000-0000-0000-0000-000000000000`,
      );
      expect(res.status).toBe(401);
    });
  });

  // ---- PATCH /admin/integrations/sources/:id -----------------------------

  describe('PATCH sources/:id — configuration update', () => {
    it('updates name and fieldMapping together', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('patch-ok'));
      const res = await h.http
        .patch(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie)
        .send({ name: 'Renamed Source', fieldMapping: { contact_phone: 'canonical:phone' } });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Renamed Source');
      expect(res.body.fieldMapping).toEqual({ contact_phone: 'canonical:phone' });

      const again = await h.http
        .get(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie);
      expect(again.body.name).toBe('Renamed Source');
      expect(again.body.fieldMapping).toEqual({ contact_phone: 'canonical:phone' });
    });

    it('a partial update (name only) leaves fieldMapping untouched', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('patch-partial'), {
        legacy_field: 'canonical:city',
      });
      const res = await h.http
        .patch(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie)
        .send({ name: 'Just Renamed' });
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('Just Renamed');
      expect(res.body.fieldMapping).toEqual({ legacy_field: 'canonical:city' });
    });

    it('rejects an attempt to change the immutable key', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('patch-key'));
      const res = await h.http
        .patch(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie)
        .send({ key: 'should-not-be-allowed' });
      expect(res.status).toBe(400);

      const unchanged = await h.http
        .get(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie);
      expect(unchanged.body.key).toBe(created.key);
    });

    it('rejects an attempt to change the immutable connectorType', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('patch-type'));
      const res = await h.http
        .patch(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie)
        .send({ connectorType: 'meta_lead_ads' });
      expect(res.status).toBe(400);
    });

    it('rejects a malformed mapping target and persists nothing', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('patch-malformed'));
      const res = await h.http
        .patch(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie)
        .send({ fieldMapping: { phone: 'canonical:not_a_real_field' } });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');

      const unchanged = await h.http
        .get(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie);
      expect(unchanged.body.fieldMapping).toEqual({});
    });

    it('accepts "skip" and "custom:<key>" targets', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('patch-skip-custom'));
      const res = await h.http
        .patch(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie)
        .send({ fieldMapping: { noise: 'skip', vendor_code: 'custom:vendorCode' } });
      expect(res.status).toBe(200);
      expect(res.body.fieldMapping).toEqual({ noise: 'skip', vendor_code: 'custom:vendorCode' });
    });

    it('404s for another tenant’s source and does not leak whether it exists', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('patch-iso'));
      const bCookie = await h.adminBCookie();
      const res = await h.http
        .patch(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', bCookie)
        .send({ name: 'Hijacked' });
      expect(res.status).toBe(404);

      const stillOriginal = await h.http
        .get(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie);
      expect(stillOriginal.body.name).not.toBe('Hijacked');
    });

    it('401s with no session', async () => {
      const res = await h.http
        .patch(`/api/v1/admin/integrations/sources/00000000-0000-0000-0000-000000000000`)
        .send({ name: 'x' });
      expect(res.status).toBe(401);
    });

    it('regression: an updated mapping is actually used by the ingestion pipeline', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('patch-regression'));
      await h.http
        .patch(`/api/v1/admin/integrations/sources/${created.sourceId}`)
        .set('Cookie', cookie)
        .send({ fieldMapping: { contact_no: 'canonical:phone' } });

      const p = phone();
      const res = await h.webhook(route, created.key, created.secret, { contact_no: p });
      expect(res.body.status).toBe('DONE');

      const [lead] = await h.sql<{ phone: string }>('select phone from leads where id = $1', [
        res.body.leadId,
      ]);
      expect(lead!.phone).toBe(p);
    });
  });

  // ---- GET /admin/integrations/providers ---------------------------------

  describe('GET providers — safe, server-driven catalog', () => {
    it('lists both known providers with authMethod and credentialFields, no secret values', async () => {
      const cookie = await h.adminCookie();
      const res = await h.http.get('/api/v1/admin/integrations/providers').set('Cookie', cookie);
      expect(res.status).toBe(200);
      const pabbly = res.body.find((p: { provider: string }) => p.provider === 'pabbly_bridge');
      const meta = res.body.find((p: { provider: string }) => p.provider === 'meta_lead_ads');
      expect(pabbly).toMatchObject({ authMethod: 'bearer_secret', credentialFields: [] });
      expect(meta.authMethod).toBe('signature');
      expect(meta.credentialFields.map((f: { key: string }) => f.key).sort()).toEqual([
        'appSecret',
        'pageAccessToken',
        'verifyToken',
      ]);
      for (const field of meta.credentialFields) {
        expect(field.secret).toBe(true);
      }
      // never a credential VALUE, only field names/labels/the secret flag
      expect(JSON.stringify(res.body)).not.toMatch(/appSecretValue|pageAccessTokenValue/);
    });

    it('401s with no session', async () => {
      const res = await h.http.get('/api/v1/admin/integrations/providers');
      expect(res.status).toBe(401);
    });
  });

  // ---- GET /admin/integrations/events — pagination + filters -------------

  describe('GET events — pagination and filters', () => {
    it('paginates server-side and reports total/page/pageSize', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('events-page'));
      for (let i = 0; i < 3; i++) {
        await h.webhook(route, created.key, created.secret, { phone: phone() });
      }

      const page1 = await h.http
        .get('/api/v1/admin/integrations/events')
        .query({ sourceId: created.sourceId, page: 1, pageSize: 2 })
        .set('Cookie', cookie);
      expect(page1.status).toBe(200);
      expect(page1.body.items).toHaveLength(2);
      expect(page1.body.total).toBe(3);
      expect(page1.body.page).toBe(1);
      expect(page1.body.pageSize).toBe(2);

      const page2 = await h.http
        .get('/api/v1/admin/integrations/events')
        .query({ sourceId: created.sourceId, page: 2, pageSize: 2 })
        .set('Cookie', cookie);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.total).toBe(3);

      const idsPage1 = page1.body.items.map((e: { id: string }) => e.id);
      const idsPage2 = page2.body.items.map((e: { id: string }) => e.id);
      expect(idsPage1).not.toEqual(expect.arrayContaining(idsPage2));
    });

    it('filters by sourceId — another source’s events never leak into the filtered result', async () => {
      const cookie = await h.adminCookie();
      const a = await h.createSource(cookie, h.uniqueKey('events-filter-a'));
      const b = await h.createSource(cookie, h.uniqueKey('events-filter-b'));
      await h.webhook(route, a.key, a.secret, { phone: phone() });
      await h.webhook(route, b.key, b.secret, { phone: phone() });

      const res = await h.http
        .get('/api/v1/admin/integrations/events')
        .query({ sourceId: a.sourceId })
        .set('Cookie', cookie);
      expect(res.body.items.length).toBeGreaterThanOrEqual(1);
      for (const item of res.body.items) {
        expect(item.sourceId).toBe(a.sourceId);
      }
    });

    it('filters by status', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('events-status'));
      await h.webhook(route, created.key, created.secret, { phone: phone() });

      const res = await h.http
        .get('/api/v1/admin/integrations/events')
        .query({ sourceId: created.sourceId, status: 'DONE' })
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      for (const item of res.body.items) {
        expect(item.status).toBe('DONE');
      }
    });

    it('rejects an unknown status value', async () => {
      const cookie = await h.adminCookie();
      const res = await h.http
        .get('/api/v1/admin/integrations/events')
        .query({ status: 'NOT_A_REAL_STATUS' })
        .set('Cookie', cookie);
      expect(res.status).toBe(400);
    });

    it('never returns events belonging to another tenant, even unfiltered', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('events-iso'));
      await h.webhook(route, created.key, created.secret, { phone: phone() });

      const bCookie = await h.adminBCookie();
      const res = await h.http
        .get('/api/v1/admin/integrations/events')
        .query({ sourceId: created.sourceId })
        .set('Cookie', bCookie);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('401s with no session', async () => {
      const res = await h.http.get('/api/v1/admin/integrations/events');
      expect(res.status).toBe(401);
    });
  });

  // ---- GET /admin/integrations/events/:id — typed detail -----------------

  describe('GET events/:id — typed detail, unchanged semantics', () => {
    it('returns event, raw and log, with no credential/secret leakage', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('event-detail'));
      const sent = await h.webhook(route, created.key, created.secret, { phone: phone() });
      expect(sent.body.status).toBe('DONE');

      const res = await h.http
        .get(`/api/v1/admin/integrations/events/${sent.body.canonicalEventId}`)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.event.id).toBe(sent.body.canonicalEventId);
      expect(res.body.raw.sourceId).toBe(created.sourceId);
      expect(Array.isArray(res.body.log)).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain(created.secret);
    });

    it('404s for another tenant’s event', async () => {
      const cookie = await h.adminCookie();
      const created = await h.createSource(cookie, h.uniqueKey('event-detail-iso'));
      const sent = await h.webhook(route, created.key, created.secret, { phone: phone() });

      const bCookie = await h.adminBCookie();
      const res = await h.http
        .get(`/api/v1/admin/integrations/events/${sent.body.canonicalEventId}`)
        .set('Cookie', bCookie);
      expect(res.status).toBe(404);
    });
  });
});
