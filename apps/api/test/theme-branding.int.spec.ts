import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 19 — theme presets, contrast-guarded custom colours, the extra logo
 * kinds, customer logos and the customer-logo-on-documents flag.
 */
describe.skipIf(!INTEGRATION_ENABLED)('Theme & white-label branding (Phase 19)', () => {
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

  const cookieFor = async (email: string, password: string, membershipId: string) => {
    const res = await http.post('/api/v1/auth/login').send({ email, password });
    const cookie = sessionCookie(res);
    await http.post('/api/v1/auth/switch-tenant').set('Cookie', cookie).send({ membershipId });
    return cookie;
  };
  const adminCookie = () => cookieFor(fx.admin.email, fx.admin.password, fx.admin.membershipId);
  const adminBCookie = () => cookieFor(fx.adminB.email, fx.adminB.password, fx.adminB.membershipId);
  const plainCookie = () =>
    cookieFor(fx.plainMember.email, fx.plainMember.password, fx.plainMember.membershipId);

  const REAL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAALElEQVR4nGPkL8tjoAZgooopDKMGEQNGA5swGA0jwmA0jAiD0TAiDAZfGAEAKEQBI+45dKMAAAAASUVORK5CYII=',
    'base64',
  );
  const attachPng = (r: request.Test) =>
    r.attach('file', REAL_PNG, { filename: 'logo.png', contentType: 'image/png' });
  const binary = (r: request.Test) =>
    r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  // ---- theme ------------------------------------------------------

  it('rejects a low-contrast custom primary with a suggestion', async () => {
    const cookie = await adminCookie();
    const res = await http
      .put('/api/v1/settings/company')
      .set('Cookie', cookie)
      .send({ themePreset: 'custom', primaryColor: '#ffff99' });
    expect(res.status).toBe(422);
    expect(res.body.error?.code ?? res.body.code).toBe('BRANDING_COLOR_LOW_CONTRAST');
    const details = res.body.error?.details ?? res.body.details;
    expect(details.suggestedPrimary).toMatch(/^#[0-9a-f]{6}$/);
    expect(Array.isArray(details.problems)).toBe(true);
    // nothing was persisted
    const branding = await http.get('/api/v1/settings/branding').set('Cookie', cookie);
    expect(branding.body.primaryColor).not.toBe('#ffff99');
  });

  it('round-trips a named preset through GET /settings/branding and /auth/me', async () => {
    const cookie = await adminCookie();
    const put = await http
      .put('/api/v1/settings/company')
      .set('Cookie', cookie)
      .send({ themePreset: 'ocean', secondaryColor: '#123456' });
    expect(put.status).toBe(200);
    expect(put.body.themePreset).toBe('ocean');
    const res = await http.get('/api/v1/settings/branding').set('Cookie', cookie);
    expect(res.body).toMatchObject({ themePreset: 'ocean', hasLogo: false, hasCompactLogo: false });
    const me = await http.get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.body.active.branding.themePreset).toBe('ocean');
  });

  it('accepts a contrast-safe custom primary and audits the branding fields', async () => {
    const cookie = await adminCookie();
    const put = await http
      .put('/api/v1/settings/company')
      .set('Cookie', cookie)
      .send({ themePreset: 'custom', primaryColor: '#1E40AF', documentAccentColor: '#1e3a8a' });
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      themePreset: 'custom',
      primaryColor: '#1e40af',
      documentAccentColor: '#1e3a8a',
    });
    const audit = await http
      .get('/api/v1/admin/audit?action=settings.branding.updated&pageSize=10')
      .set('Cookie', cookie);
    expect(audit.status).toBe(200);
    const [entry] = audit.body.items;
    expect(entry).toBeTruthy();
    const detail = await http.get(`/api/v1/admin/audit/${entry.id}`).set('Cookie', cookie);
    const text = JSON.stringify(detail.body);
    expect(text).toContain('themePreset');
    expect(text).toContain('documentAccentColor');
  });

  it('rejects bad secondary / document colours and modes at the DTO', async () => {
    const cookie = await adminCookie();
    for (const body of [
      { secondaryColor: 'nope' },
      { documentAccentColor: '#12' },
      { documentLogoMode: 'both' },
      { themePreset: 'neon' },
    ]) {
      const res = await http.put('/api/v1/settings/company').set('Cookie', cookie).send(body);
      expect(res.status).toBe(400);
    }
  });

  // ---- new tenant logo kinds ----------------------------------------

  it.each(['logo_compact', 'logo_login', 'logo_document'])(
    'uploads, streams and removes the %s logo',
    async (kind) => {
      const cookie = await adminCookie();
      const up = await attachPng(
        http.post(`/api/v1/settings/company/logo?kind=${kind}`).set('Cookie', cookie),
      );
      expect(up.status).toBe(200);
      const flag = {
        logo_compact: 'hasCompactLogo',
        logo_login: 'hasLoginLogo',
        logo_document: 'hasDocumentLogo',
      }[kind as 'logo_compact'];
      expect(up.body[flag]).toBe(true);
      const img = await binary(
        http.get(`/api/v1/settings/company/logo?kind=${kind}`).set('Cookie', cookie),
      );
      expect(img.status).toBe(200);
      expect(img.headers['content-type']).toContain('image/png');
      const del = await http
        .delete(`/api/v1/settings/company/logo?kind=${kind}`)
        .set('Cookie', cookie);
      expect(del.status).toBe(200);
      expect(del.body[flag]).toBe(false);
    },
  );

  it('rejects a non-image for a new logo kind', async () => {
    const cookie = await adminCookie();
    const res = await http
      .post('/api/v1/settings/company/logo?kind=logo_compact')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('not an image at all'), {
        filename: 'x.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(422);
  });

  // ---- customer logo ------------------------------------------------

  async function newCustomer(cookie: string): Promise<string> {
    const res = await http
      .post('/api/v1/customers')
      .set('Cookie', cookie)
      .send({ name: `Logo Co ${Math.random().toString(36).slice(2, 7)}` });
    expect(res.status).toBe(200);
    return res.body.id as string;
  }

  it('uploads, streams and removes a customer logo; never exposes the storage key', async () => {
    const cookie = await adminCookie();
    const id = await newCustomer(cookie);
    const up = await attachPng(http.post(`/api/v1/customers/${id}/logo`).set('Cookie', cookie));
    expect(up.status).toBe(200);
    expect(JSON.stringify(up.body)).not.toContain('tenants/');
    const detail = await http.get(`/api/v1/customers/${id}`).set('Cookie', cookie);
    expect(JSON.stringify(detail.body)).not.toMatch(/logoObjectKey|logo_object_key/);
    const img = await binary(http.get(`/api/v1/customers/${id}/logo`).set('Cookie', cookie));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toContain('image/png');
    expect((img.body as Buffer).equals(REAL_PNG)).toBe(true);
    const del = await http.delete(`/api/v1/customers/${id}/logo`).set('Cookie', cookie);
    expect(del.status).toBe(200);
    const gone = await http.get(`/api/v1/customers/${id}/logo`).set('Cookie', cookie);
    expect(gone.status).toBe(404);
  });

  it('validates the customer logo like a tenant logo', async () => {
    const cookie = await adminCookie();
    const id = await newCustomer(cookie);
    const res = await http
      .post(`/api/v1/customers/${id}/logo`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from('<svg/>'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(422);
    const mismatch = await http
      .post(`/api/v1/customers/${id}/logo`)
      .set('Cookie', cookie)
      .attach('file', REAL_PNG, { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(mismatch.status).toBe(422);
  });

  it('isolates customer logos per tenant (B cannot read, put or delete A’s → 404)', async () => {
    const aCookie = await adminCookie();
    const id = await newCustomer(aCookie);
    await attachPng(http.post(`/api/v1/customers/${id}/logo`).set('Cookie', aCookie));
    const bCookie = await adminBCookie();
    expect((await http.get(`/api/v1/customers/${id}/logo`).set('Cookie', bCookie)).status).toBe(
      404,
    );
    const put = await attachPng(http.post(`/api/v1/customers/${id}/logo`).set('Cookie', bCookie));
    expect(put.status).toBe(404);
    expect((await http.delete(`/api/v1/customers/${id}/logo`).set('Cookie', bCookie)).status).toBe(
      404,
    );
    // A's logo is untouched
    expect((await http.get(`/api/v1/customers/${id}/logo`).set('Cookie', aCookie)).status).toBe(
      200,
    );
  });

  it('enforces customer permissions on the logo endpoints', async () => {
    const aCookie = await adminCookie();
    const id = await newCustomer(aCookie);
    const pCookie = await plainCookie();
    expect((await http.get(`/api/v1/customers/${id}/logo`).set('Cookie', pCookie)).status).toBe(
      403,
    );
    const up = await attachPng(http.post(`/api/v1/customers/${id}/logo`).set('Cookie', pCookie));
    expect(up.status).toBe(403);
    expect((await http.delete(`/api/v1/customers/${id}/logo`).set('Cookie', pCookie)).status).toBe(
      403,
    );
    expect((await http.get(`/api/v1/customers/${id}/logo`)).status).toBe(401);
  });

  // ---- document rendering with the customer-logo flag ---------------

  it('renders a valid PDF with the customer logo flag off and on (logo embedded only when on)', async () => {
    const cookie = await adminCookie();
    const customerId = await newCustomer(cookie);
    await attachPng(http.post(`/api/v1/customers/${customerId}/logo`).set('Cookie', cookie));
    const draft = await http
      .post('/api/v1/finance/invoices')
      .set('Cookie', cookie)
      .send({
        customerId,
        currency: 'GBP',
        lines: [{ description: 'Panels', quantity: '2', unitPrice: '100.00', taxRate: '0.2' }],
      });
    expect(draft.status).toBe(200);
    const issued = await http
      .post(`/api/v1/finance/invoices/${draft.body.id}/issue`)
      .set('Cookie', cookie)
      .send({});
    expect(issued.status).toBe(200);
    const pdf = async () => {
      const res = await binary(
        http.get(`/api/v1/finance/invoices/${draft.body.id}/pdf`).set('Cookie', cookie),
      );
      expect(res.status).toBe(200);
      const body = res.body as Buffer;
      await PDFDocument.load(body);
      return body;
    };
    const imageCount = async (body: Buffer) => {
      const doc = await PDFDocument.load(body);
      let n = 0;
      for (const [, obj] of doc.context.enumerateIndirectObjects()) {
        const text = String(obj);
        if (text.includes('/Subtype /Image') || text.includes('Subtype: /Image')) n++;
      }
      return n;
    };

    await http
      .put('/api/v1/settings/company')
      .set('Cookie', cookie)
      .send({ documentShowCustomerLogo: false });
    const off = await pdf();
    await http
      .put('/api/v1/settings/company')
      .set('Cookie', cookie)
      .send({ documentShowCustomerLogo: true });
    const on = await pdf();
    // flag on: one extra embedded image (the customer logo)
    expect(await imageCount(on)).toBeGreaterThan(await imageCount(off));
    await http
      .put('/api/v1/settings/company')
      .set('Cookie', cookie)
      .send({ documentShowCustomerLogo: false });
  });
});
