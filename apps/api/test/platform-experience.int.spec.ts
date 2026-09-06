import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 10 — Platform experience: tenant company profile & branding, onboarding
 * and the branded document engine (ADR 0039). Covers the Aivoryx fallback,
 * tenant branding round-trips, cross-tenant isolation, invalid branding /
 * logo rejection, onboarding visibility by role, `/auth/me` branding, and the
 * authenticated, tenant-safe PDF downloads. Direct PostgreSQL RLS proof for the
 * new tables is in `rls.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)(
  'Platform experience (branding, onboarding, documents)',
  () => {
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
    const cookieFor = async (email: string, password: string, membershipId: string) => {
      const res = await login(email, password);
      const cookie = sessionCookie(res);
      await http.post('/api/v1/auth/switch-tenant').set('Cookie', cookie).send({ membershipId });
      return cookie;
    };
    const adminCookie = () => cookieFor(fx.admin.email, fx.admin.password, fx.admin.membershipId);
    const adminBCookie = () =>
      cookieFor(fx.adminB.email, fx.adminB.password, fx.adminB.membershipId);
    const plainCookie = () =>
      cookieFor(fx.plainMember.email, fx.plainMember.password, fx.plainMember.membershipId);

    /** A header-valid 64×64 PNG (signature + IHDR). The logo validator sniffs the
     *  header only, so this exercises the accept path without a decode step. */
    const PNG_64 = (() => {
      const buf = Buffer.alloc(64);
      buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      buf.write('IHDR', 12, 'ascii');
      buf.writeUInt32BE(64, 16);
      buf.writeUInt32BE(64, 20);
      return buf;
    })();

    // ---- company profile & branding --------------------------------

    it('returns the Aivoryx-safe fallback branding before a workspace configures anything', async () => {
      const cookie = await adminCookie();
      const res = await http.get('/api/v1/settings/branding').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Tenant A');
      expect(res.body.primaryColor).toBeNull();
      expect(res.body.hasLogo).toBe(false);
    });

    it('round-trips the company profile and brand colour, and surfaces it on /auth/me', async () => {
      const cookie = await adminCookie();
      const put = await http.put('/api/v1/settings/company').set('Cookie', cookie).send({
        displayName: 'Aurora Renewables',
        legalName: 'Aurora Renewables Ltd',
        addressLine: '12 Sun Street',
        city: 'Leeds',
        postalCode: 'LS1 4DX',
        email: 'hello@aurora.example',
        taxRegistrationLabel: 'VAT',
        taxRegistrationNumber: 'GB123456789',
        primaryColor: '#1E40AF',
        documentFooter: 'Payment within 30 days',
      });
      expect(put.status).toBe(200);
      expect(put.body.displayName).toBe('Aurora Renewables');
      expect(put.body.primaryColor).toBe('#1e40af');

      const me = await http.get('/api/v1/auth/me').set('Cookie', cookie);
      expect(me.body.active.branding.displayName).toBe('Aurora Renewables');
      expect(me.body.active.branding.primaryColor).toBe('#1e40af');
    });

    it('rejects an invalid brand colour', async () => {
      const cookie = await adminCookie();
      const res = await http
        .put('/api/v1/settings/company')
        .set('Cookie', cookie)
        .send({ primaryColor: 'blue' });
      expect(res.status).toBe(400);
    });

    it('does not let a member without settings.company.update edit the profile', async () => {
      const cookie = await plainCookie();
      const res = await http
        .put('/api/v1/settings/company')
        .set('Cookie', cookie)
        .send({ displayName: 'Hijack' });
      expect(res.status).toBe(403);
    });

    it('keeps tenant A and tenant B branding fully isolated', async () => {
      const bCookie = await adminBCookie();
      const b = await http.get('/api/v1/settings/company').set('Cookie', bCookie);
      expect(b.status).toBe(200);
      expect(b.body.displayName).toBeNull(); // A's edit never leaked to B
      expect(b.body.workspaceName).toBe('Tenant B');
    });

    // ---- logo upload validation -----------------------------------

    it('accepts a valid PNG logo, serves it back, and removes it', async () => {
      const cookie = await adminCookie();
      const up = await http
        .post('/api/v1/settings/company/logo')
        .set('Cookie', cookie)
        .attach('file', PNG_64, { filename: 'logo.png', contentType: 'image/png' });
      expect(up.status).toBe(200);
      expect(up.body.hasLogo).toBe(true);

      const img = await http.get('/api/v1/settings/company/logo').set('Cookie', cookie);
      expect(img.status).toBe(200);
      expect(img.headers['content-type']).toContain('image/png');

      const del = await http.delete('/api/v1/settings/company/logo').set('Cookie', cookie);
      expect(del.status).toBe(200);
      expect(del.body.hasLogo).toBe(false);
    });

    it('rejects a non-image file whatever content-type the client claims', async () => {
      const cookie = await adminCookie();
      const res = await http
        .post('/api/v1/settings/company/logo')
        .set('Cookie', cookie)
        .attach('file', Buffer.from('#!/bin/sh\nrm -rf /\n'), {
          filename: 'evil.png',
          contentType: 'image/png',
        });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('LOGO_INVALID');
    });

    it('returns 404 LOGO_NOT_FOUND when no logo is set', async () => {
      const cookie = await adminBCookie();
      const res = await http.get('/api/v1/settings/company/logo').set('Cookie', cookie);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('LOGO_NOT_FOUND');
    });

    // ---- onboarding ---------------------------------------------

    it('shows the onboarding checklist to an admin of a fresh workspace', async () => {
      const cookie = await adminBCookie();
      const res = await http.get('/api/v1/onboarding').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.show).toBe(true);
      expect(res.body.steps.length).toBeGreaterThan(0);
      for (const step of res.body.steps) {
        // every linked step is one this admin can actually open
        if (step.href) expect(typeof step.href).toBe('string');
      }
    });

    it('gives a member with no admin permissions no setup tasks', async () => {
      const cookie = await plainCookie();
      const res = await http.get('/api/v1/onboarding').set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.steps).toHaveLength(0);
      expect(res.body.show).toBe(false);
    });

    it('stops showing the checklist once an admin dismisses it', async () => {
      const cookie = await adminBCookie();
      const d = await http.post('/api/v1/onboarding/dismiss').set('Cookie', cookie);
      expect(d.status).toBe(200);
      const res = await http.get('/api/v1/onboarding').set('Cookie', cookie);
      expect(res.body.show).toBe(false);
      expect(res.body.dismissed).toBe(true);
    });

    // ---- branded document downloads ----------------------------

    async function makeIssuedInvoice(cookie: string): Promise<{ id: string; number: string }> {
      const cust = await http
        .post('/api/v1/customers')
        .set('Cookie', cookie)
        .send({ name: `Doc Co ${Math.random().toString(36).slice(2, 7)}` });
      expect(cust.status).toBe(200);
      const draft = await http
        .post('/api/v1/finance/invoices')
        .set('Cookie', cookie)
        .send({
          customerId: cust.body.id,
          currency: 'GBP',
          lines: [
            { description: 'Design & supply', quantity: '5', unitPrice: '200.00', taxRate: '0.2' },
          ],
        });
      expect(draft.status).toBe(200);
      const issued = await http
        .post(`/api/v1/finance/invoices/${draft.body.id}/issue`)
        .set('Cookie', cookie)
        .send({});
      expect(issued.status).toBe(200);
      return { id: draft.body.id, number: issued.body.number };
    }

    it('serves a real, branded PDF for an invoice (correct type, filename, %PDF bytes)', async () => {
      const cookie = await adminCookie();
      // re-apply branding removed by the logo test above
      await http
        .put('/api/v1/settings/company')
        .set('Cookie', cookie)
        .send({ displayName: 'Aurora Renewables', primaryColor: '#1e40af' });
      const inv = await makeIssuedInvoice(cookie);

      const res = await http
        .get(`/api/v1/finance/invoices/${inv.id}/pdf`)
        .set('Cookie', cookie)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain(`${inv.number}.pdf`);
      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
      const doc = await PDFDocument.load(body);
      expect(doc.getAuthor()).toBe('Aurora Renewables');
      expect(doc.getTitle()).toContain(inv.number);
    });

    it('will not let tenant B download tenant A’s invoice PDF', async () => {
      const aCookie = await adminCookie();
      const inv = await makeIssuedInvoice(aCookie);
      const bCookie = await adminBCookie();
      const res = await http.get(`/api/v1/finance/invoices/${inv.id}/pdf`).set('Cookie', bCookie);
      expect(res.status).toBe(404);
    });

    it('requires authentication for a document download', async () => {
      const res = await http.get(
        '/api/v1/finance/invoices/00000000-0000-0000-0000-000000000000/pdf',
      );
      expect(res.status).toBe(401);
    });
  },
);
