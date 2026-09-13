import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Deployment hardening — object storage. Proves the `ObjectStorageService`
 * abstraction (local adapter under test here; the S3 adapter is unit-tested
 * against a mocked client in `apps/api/src/storage/s3-object-storage.service.spec.ts`
 * since it has no real R2 credentials to exercise) actually round-trips real
 * uploads end to end through the modules that were missing integration
 * coverage — HR employee documents and expense receipts — and that the
 * authenticated-download boundary is tenant-isolated at the storage layer,
 * not just by key obscurity. Tenant logo (`platform-experience.int.spec.ts`),
 * field/visit photos (`field.int.spec.ts`), quotation attachments
 * (`commercial.int.spec.ts`) and EPC execution attachments
 * (`execution.int.spec.ts`) already exercise the same interface — this file
 * intentionally does not re-test those.
 */
describe.skipIf(!INTEGRATION_ENABLED)('object storage — cross-module attachment flows', () => {
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
  const adminBCookie = () => cookieFor(fx.adminB.email, fx.adminB.password, fx.adminB.membershipId);

  async function makeEmployee(cookie: string) {
    const res = await http
      .post('/api/v1/hr/employees')
      .set('Cookie', cookie)
      .send({
        firstName: 'Storage',
        lastName: randomUUID().slice(0, 8),
        joiningDate: '2025-01-01',
        employmentType: 'FULL_TIME',
      });
    expect(res.status).toBe(200);
    return res.body as { id: string };
  }

  it('an HR employee document round-trips through storage: upload, list, download with the right bytes and content type', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    const content = Buffer.from(`passport-scan-${randomUUID()}`);

    const upload = await http
      .post(`/api/v1/hr/employees/${emp.id}/documents`)
      .set('Cookie', cookie)
      .field('kind', 'identity')
      .field('title', 'Passport')
      .attach('file', content, { filename: 'passport.pdf', contentType: 'application/pdf' });
    expect(upload.status).toBe(200);
    const doc = (upload.body as { id: string; kind: string }[]).find((d) => d.kind === 'identity');
    expect(doc).toBeTruthy();

    const download = await http
      .get(`/api/v1/hr/employees/${emp.id}/documents/${doc!.id}/download`)
      .set('Cookie', cookie);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(Buffer.compare(download.body as Buffer, content)).toBe(0);
  });

  it('an HR expense receipt round-trips through storage: upload then download the same bytes', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    const suffix = randomUUID().slice(0, 8);
    const category = await http
      .post('/api/v1/hr/expenses/categories')
      .set('Cookie', cookie)
      .send({ name: `Storage test ${suffix}`, code: `ST${suffix}` });
    expect(category.status).toBe(200);

    const claim = await http.post('/api/v1/hr/expenses').set('Cookie', cookie).send({
      employeeId: emp.id,
      categoryId: category.body.id,
      expenseDate: '2026-05-01',
      amount: '150.00',
    });
    expect(claim.status).toBe(200);

    const receiptBytes = Buffer.from(`receipt-image-${randomUUID()}`);
    const upload = await http
      .post(`/api/v1/hr/expenses/${claim.body.id}/receipt`)
      .set('Cookie', cookie)
      .attach('file', receiptBytes, { filename: 'receipt.jpg', contentType: 'image/jpeg' });
    expect(upload.status).toBe(200);

    const download = await http
      .get(`/api/v1/hr/expenses/${claim.body.id}/receipt`)
      .set('Cookie', cookie);
    expect(download.status).toBe(200);
    expect(download.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.compare(download.body as Buffer, receiptBytes)).toBe(0);
  });

  it('tenant B cannot download tenant A’s HR document — the authenticated route, not key secrecy, is the boundary', async () => {
    const cookieA = await adminCookie();
    const emp = await makeEmployee(cookieA);
    const content = Buffer.from(`tenant-a-only-${randomUUID()}`);
    const upload = await http
      .post(`/api/v1/hr/employees/${emp.id}/documents`)
      .set('Cookie', cookieA)
      .field('kind', 'identity')
      .field('title', 'Tenant A secret')
      .attach('file', content, { filename: 'secret.pdf', contentType: 'application/pdf' });
    const doc = (upload.body as { id: string }[])[0]!;

    const cookieB = await adminBCookie();
    // tenant B holds no employee row for tenant A's employee id (RLS-scoped) —
    // the lookup that resolves an object key from (tenant, employee, document)
    // fails closed, before storage is ever consulted. The service surfaces
    // this the same way as "document not found" (HR_ATTACHMENT_INVALID, 422)
    // rather than leaking a distinct "wrong tenant" signal.
    const crossTenant = await http
      .get(`/api/v1/hr/employees/${emp.id}/documents/${doc.id}/download`)
      .set('Cookie', cookieB);
    expect(crossTenant.status).toBe(422);
    expect(crossTenant.body.error.code).toBe('HR_ATTACHMENT_INVALID');

    // and tenant A's own document is unaffected by the attempt
    const stillWorks = await http
      .get(`/api/v1/hr/employees/${emp.id}/documents/${doc.id}/download`)
      .set('Cookie', cookieA);
    expect(stillWorks.status).toBe(200);
    expect(Buffer.compare(stillWorks.body as Buffer, content)).toBe(0);
  });
});
