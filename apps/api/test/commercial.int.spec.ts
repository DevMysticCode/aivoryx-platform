import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 6 — commercial: customers, quotations & project booking (ADR 0035).
 * Customer CRUD, the quotation lifecycle, revision immutability, totals,
 * acceptance, the atomic booking transaction (customer promotion + project
 * activation + linkage), permissions, tenant isolation, attachment
 * authorization, and concurrency. Direct PostgreSQL RLS proof is in
 * `rls.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)('Commercial (quotation & booking)', () => {
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
  const plainCookie = () =>
    cookieFor(fx.plainMember.email, fx.plainMember.password, fx.plainMember.membershipId);

  const uniq = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  async function makeLead(cookie: string, name = 'Quote Customer') {
    const res = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({ name, phone: `9${Math.floor(Math.random() * 1e9)}`.slice(0, 10) });
    expect(res.status).toBe(200);
    return res.body.id as string;
  }

  async function makeProduct(cookie: string) {
    const unit = await http
      .post('/api/v1/inventory/units')
      .set('Cookie', cookie)
      .send({ code: `U${uniq()}`, name: 'Pieces' });
    const product = await http
      .post('/api/v1/inventory/products')
      .set('Cookie', cookie)
      .send({ sku: `SKU-${uniq()}`, name: 'Solar panel 550W', unitId: unit.body.id });
    expect(product.status).toBe(200);
    return product.body.id as string;
  }

  const draftLines = (productId?: string) => [
    productId
      ? {
          productId,
          description: '',
          quantity: '10',
          unitPrice: '2500',
          discount: '1000',
          taxRate: '0.18',
        }
      : {
          description: 'Panels',
          quantity: '10',
          unitPrice: '2500',
          discount: '1000',
          taxRate: '0.18',
        },
    { description: 'Installation labour', quantity: '1', unitPrice: '8000', taxRate: '0.18' },
  ];

  async function createQuotation(cookie: string, leadId: string, productId?: string) {
    const res = await http
      .post('/api/v1/quotations')
      .set('Cookie', cookie)
      .send({
        leadId,
        validityDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        notes: 'Payment 50% advance.',
        lines: draftLines(productId),
      });
    expect(res.status).toBe(200);
    return res.body;
  }

  // ---- customers -------------------------------------------------

  it('customer CRUD is tenant-scoped and permission-gated', async () => {
    const cookie = await adminCookie();
    const created = await http
      .post('/api/v1/customers')
      .set('Cookie', cookie)
      .send({ name: `Acme ${uniq()}`, phone: '9998887777', taxReference: 'GST-123' });
    expect(created.status).toBe(200);
    expect(created.body.number).toMatch(/^CUST-/);
    expect(created.body.status).toBe('prospect');
    const id = created.body.id;

    const updated = await http
      .patch(`/api/v1/customers/${id}`)
      .set('Cookie', cookie)
      .send({ status: 'active', city: 'Pune' });
    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe('active');
    expect(updated.body.city).toBe('Pune');

    // tenant B cannot see it
    const bCookie = await adminBCookie();
    const bGet = await http.get(`/api/v1/customers/${id}`).set('Cookie', bCookie);
    expect(bGet.status).toBe(404);

    // a member with no commercial permissions is forbidden
    const pCookie = await plainCookie();
    expect((await http.get('/api/v1/customers').set('Cookie', pCookie)).status).toBe(403);
    expect(
      (await http.post('/api/v1/customers').set('Cookie', pCookie).send({ name: 'x' })).status,
    ).toBe(403);
  });

  it('promotes a lead to a customer, idempotently', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie, 'Promote Me');
    const first = await http
      .post(`/api/v1/customers/from-lead/${leadId}`)
      .set('Cookie', cookie)
      .send({});
    expect(first.status).toBe(200);
    expect(first.body.leadId).toBe(leadId);
    expect(first.body.status).toBe('active');
    const again = await http
      .post(`/api/v1/customers/from-lead/${leadId}`)
      .set('Cookie', cookie)
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id); // same customer, not a duplicate
  });

  // ---- quotation basics + totals -------------------------------

  it('creates a quotation with product + service lines and correct totals', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie);
    const productId = await makeProduct(cookie);
    const q = await createQuotation(cookie, leadId, productId);

    expect(q.number).toMatch(/^Q-/);
    expect(q.status).toBe('DRAFT');
    expect(q.currentRevisionNo).toBe(1);
    const rev = q.currentRevision;
    // line 1: gross 25000, discount 1000 -> net 24000, tax 4320, total 28320
    // line 2: gross 8000, net 8000, tax 1440, total 9440
    expect(rev.subtotal).toBe('33000.00');
    expect(rev.discountTotal).toBe('1000.00');
    expect(rev.taxTotal).toBe('5760.00');
    expect(rev.total).toBe('37760.00');
    expect(rev.lines).toHaveLength(2);
    expect(rev.lines[0].productId).toBe(productId);
    expect(rev.lines[0].description).toBe('Solar panel 550W'); // snapshotted from the product
    expect(rev.lines[1].productId).toBeNull(); // service line, no catalogue pollution

    // visible from the lead
    const leadQuotes = await http.get(`/api/v1/leads/${leadId}/quotations`).set('Cookie', cookie);
    expect(leadQuotes.status).toBe(200);
    expect(leadQuotes.body.items.some((x: { id: string }) => x.id === q.id)).toBe(true);
  });

  // ---- lifecycle ------------------------------------------------

  it('runs the full lifecycle DRAFT -> SENT -> ACCEPTED -> BOOKED and activates a project', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie);
    const productId = await makeProduct(cookie);
    const q = await createQuotation(cookie, leadId, productId);

    const sent = await http.post(`/api/v1/quotations/${q.id}/send`).set('Cookie', cookie);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('SENT');
    expect(sent.body.currentRevision.status).toBe('sent');
    expect(sent.body.currentRevision.sentAt).toBeTruthy();

    const accepted = await http
      .post(`/api/v1/quotations/${q.id}/accept`)
      .set('Cookie', cookie)
      .send({ note: 'Confirmed on call' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('ACCEPTED');
    expect(accepted.body.currentRevision.acceptanceNote).toBe('Confirmed on call');

    const booked = await http
      .post(`/api/v1/quotations/${q.id}/book`)
      .set('Cookie', cookie)
      .send({});
    expect(booked.status).toBe(200);
    expect(booked.body.quotation.status).toBe('BOOKED');
    expect(booked.body.projectId).toBeTruthy();
    expect(booked.body.customerId).toBeTruthy();

    // project exists, is APPROVED, links back to the lead
    const project = await http
      .get(`/api/v1/projects/${booked.body.projectId}`)
      .set('Cookie', cookie);
    expect(project.status).toBe(200);
    expect(project.body.status).toBe('APPROVED');
    expect(project.body.leadId).toBe(leadId);
    expect(project.body.approvedAt).toBeTruthy();

    // lead converted; timeline shows the commercial milestones
    const lead = await http.get(`/api/v1/crm/leads/${leadId}`).set('Cookie', cookie);
    expect(lead.body.status).toBe('CONVERTED');
    const acts = await http.get(`/api/v1/crm/leads/${leadId}/activities`).set('Cookie', cookie);
    const types = acts.body.map((a: { type: string }) => a.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'quotation_created',
        'quotation_sent',
        'quotation_accepted',
        'quotation_booked',
      ]),
    );

    // quotation now carries the project + customer
    const q2 = await http.get(`/api/v1/quotations/${q.id}`).set('Cookie', cookie);
    expect(q2.body.projectId).toBe(booked.body.projectId);
    expect(q2.body.customerId).toBe(booked.body.customerId);

    // customer detail shows the linked quotation + project
    const cust = await http
      .get(`/api/v1/customers/${booked.body.customerId}`)
      .set('Cookie', cookie);
    expect(cust.body.quotations.some((x: { id: string }) => x.id === q.id)).toBe(true);
    expect(cust.body.projects.some((x: { id: string }) => x.id === booked.body.projectId)).toBe(
      true,
    );
  });

  it('booking a quotation that pre-links a draft project activates that one (no second project)', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie);
    const project = await http.post('/api/v1/projects').set('Cookie', cookie).send({ leadId });
    expect(project.status).toBe(200);
    const q = await http
      .post('/api/v1/quotations')
      .set('Cookie', cookie)
      .send({ leadId, projectId: project.body.id, lines: draftLines() });
    await http.post(`/api/v1/quotations/${q.body.id}/send`).set('Cookie', cookie);
    await http.post(`/api/v1/quotations/${q.body.id}/accept`).set('Cookie', cookie).send({});
    const booked = await http
      .post(`/api/v1/quotations/${q.body.id}/book`)
      .set('Cookie', cookie)
      .send({});
    expect(booked.status).toBe(200);
    expect(booked.body.projectId).toBe(project.body.id);
    const p = await http.get(`/api/v1/projects/${project.body.id}`).set('Cookie', cookie);
    expect(p.body.status).toBe('APPROVED');
  });

  it('cannot book a quotation that is not accepted', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie);
    const q = await createQuotation(cookie, leadId);
    await http.post(`/api/v1/quotations/${q.id}/send`).set('Cookie', cookie);
    const res = await http.post(`/api/v1/quotations/${q.id}/book`).set('Cookie', cookie).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUOTATION_NOT_ACCEPTED');
  });

  it('rejects sending a quotation with no lines', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie);
    const q = await http.post('/api/v1/quotations').set('Cookie', cookie).send({ leadId });
    expect(q.status).toBe(200);
    const res = await http.post(`/api/v1/quotations/${q.body.id}/send`).set('Cookie', cookie);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUOTATION_NO_LINES');
  });

  it('rejects accepting an expired quotation', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie);
    const q = await http
      .post('/api/v1/quotations')
      .set('Cookie', cookie)
      .send({
        leadId,
        validityDate: new Date(Date.now() - 86_400_000).toISOString(),
        lines: draftLines(),
      });
    await http.post(`/api/v1/quotations/${q.body.id}/send`).set('Cookie', cookie);
    const res = await http
      .post(`/api/v1/quotations/${q.body.id}/accept`)
      .set('Cookie', cookie)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUOTATION_EXPIRED');
  });

  // ---- revision immutability ----------------------------------

  it('freezes a sent revision and edits go onto a new revision', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie);
    const q = await createQuotation(cookie, leadId);

    // editable while draft
    const edit1 = await http
      .patch(`/api/v1/quotations/${q.id}`)
      .set('Cookie', cookie)
      .send({ lines: [{ description: 'One line', quantity: '1', unitPrice: '100' }] });
    expect(edit1.status).toBe(200);
    expect(edit1.body.currentRevision.total).toBe('100.00');

    await http.post(`/api/v1/quotations/${q.id}/send`).set('Cookie', cookie);

    // editing a sent quotation is refused
    const blocked = await http
      .patch(`/api/v1/quotations/${q.id}`)
      .set('Cookie', cookie)
      .send({ lines: [{ description: 'Sneaky', quantity: '1', unitPrice: '1' }] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('QUOTATION_IMMUTABLE');

    // revise -> new editable revision, old one preserved + superseded
    const revised = await http
      .post(`/api/v1/quotations/${q.id}/revise`)
      .set('Cookie', cookie)
      .send({ reason: 'Customer negotiated' });
    expect(revised.status).toBe(200);
    expect(revised.body.status).toBe('DRAFT');
    expect(revised.body.currentRevisionNo).toBe(2);
    expect(revised.body.revisions).toHaveLength(2);
    const rev1 = revised.body.revisions.find((r: { revisionNo: number }) => r.revisionNo === 1);
    const rev2 = revised.body.revisions.find((r: { revisionNo: number }) => r.revisionNo === 2);
    expect(rev1.status).toBe('superseded'); // the old revision is frozen, no longer current
    expect(rev1.total).toBe('100.00'); // and its pricing is preserved
    expect(rev2.status).toBe('draft');
    expect(rev2.total).toBe('100.00'); // copied from rev 1

    // now edit revision 2 only
    const edit2 = await http
      .patch(`/api/v1/quotations/${q.id}`)
      .set('Cookie', cookie)
      .send({ lines: [{ description: 'Revised', quantity: '2', unitPrice: '100' }] });
    expect(edit2.status).toBe(200);
    const after = await http.get(`/api/v1/quotations/${q.id}`).set('Cookie', cookie);
    expect(after.body.currentRevision.revisionNo).toBe(2);
    expect(after.body.currentRevision.total).toBe('200.00');
    expect(after.body.revisions.find((r: { revisionNo: number }) => r.revisionNo === 1).total).toBe(
      '100.00',
    ); // rev 1 unchanged
  });

  // ---- concurrency -------------------------------------------

  it('concurrent send resolves to exactly one SENT quotation', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie);
    const q = await createQuotation(cookie, leadId);
    const [a, b] = await Promise.all([
      http.post(`/api/v1/quotations/${q.id}/send`).set('Cookie', cookie),
      http.post(`/api/v1/quotations/${q.id}/send`).set('Cookie', cookie),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    const acts = await http.get(`/api/v1/quotations/${q.id}/activities`).set('Cookie', cookie);
    expect(acts.body.filter((x: { type: string }) => x.type === 'sent')).toHaveLength(1);
  });

  it('concurrent accept resolves to exactly one ACCEPTED quotation', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie);
    const q = await createQuotation(cookie, leadId);
    await http.post(`/api/v1/quotations/${q.id}/send`).set('Cookie', cookie);
    const [a, b] = await Promise.all([
      http.post(`/api/v1/quotations/${q.id}/accept`).set('Cookie', cookie).send({}),
      http.post(`/api/v1/quotations/${q.id}/accept`).set('Cookie', cookie).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    const acts = await http.get(`/api/v1/quotations/${q.id}/activities`).set('Cookie', cookie);
    expect(acts.body.filter((x: { type: string }) => x.type === 'accepted')).toHaveLength(1);
  });

  it('two concurrent bookings produce exactly one project and one booking', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie);
    const q = await createQuotation(cookie, leadId);
    await http.post(`/api/v1/quotations/${q.id}/send`).set('Cookie', cookie);
    await http.post(`/api/v1/quotations/${q.id}/accept`).set('Cookie', cookie).send({});

    const [a, b] = await Promise.all([
      http.post(`/api/v1/quotations/${q.id}/book`).set('Cookie', cookie).send({}),
      http.post(`/api/v1/quotations/${q.id}/book`).set('Cookie', cookie).send({}),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    expect(a.body.projectId).toBe(b.body.projectId); // same project both times

    const acts = await http.get(`/api/v1/quotations/${q.id}/activities`).set('Cookie', cookie);
    expect(acts.body.filter((x: { type: string }) => x.type === 'booked')).toHaveLength(1);

    const projects = await http
      .get('/api/v1/projects')
      .query({ leadId, pageSize: 100 })
      .set('Cookie', cookie);
    expect(projects.body.items).toHaveLength(1);
  });

  // ---- cross-tenant + RBAC ----------------------------------

  it('tenant B cannot read or act on tenant A quotations, and cross-tenant links are rejected', async () => {
    const cookieA = await adminCookie();
    const cookieB = await adminBCookie();
    const leadA = await makeLead(cookieA);
    const q = await createQuotation(cookieA, leadA);

    expect((await http.get(`/api/v1/quotations/${q.id}`).set('Cookie', cookieB)).status).toBe(404);
    expect((await http.post(`/api/v1/quotations/${q.id}/send`).set('Cookie', cookieB)).status).toBe(
      404,
    );

    // a customer from another tenant cannot be linked
    const custB = await http
      .post('/api/v1/customers')
      .set('Cookie', cookieB)
      .send({ name: 'B customer' });
    const bad = await http
      .post('/api/v1/quotations')
      .set('Cookie', cookieA)
      .send({ leadId: leadA, customerId: custB.body.id, lines: draftLines() });
    expect(bad.status).toBe(404);
    expect(bad.body.error.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('rejects unauthenticated and unauthorized callers', async () => {
    expect((await http.get('/api/v1/quotations')).status).toBe(401);
    const pCookie = await plainCookie();
    expect((await http.get('/api/v1/quotations').set('Cookie', pCookie)).status).toBe(403);
  });

  // ---- attachments + printable doc --------------------------

  it('quotation attachments are authorized and tenant-isolated; printable doc renders', async () => {
    const cookie = await adminCookie();
    const bCookie = await adminBCookie();
    const leadId = await makeLead(cookie);
    const q = await createQuotation(cookie, leadId);

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgDTD2qgAAAAASUVORK5CYII=',
      'base64',
    );
    const up = await http
      .post(`/api/v1/quotations/${q.id}/attachments`)
      .set('Cookie', cookie)
      .attach('file', png, { filename: 'quote.png', contentType: 'image/png' });
    expect(up.status).toBe(200);
    const attId = up.body.id;

    const list = await http.get(`/api/v1/quotations/${q.id}/attachments`).set('Cookie', cookie);
    expect(list.body).toHaveLength(1);

    // tenant B cannot download
    const bDl = await http
      .get(`/api/v1/quotations/${q.id}/attachments/${attId}/download`)
      .set('Cookie', bCookie);
    expect([403, 404]).toContain(bDl.status);

    const dl = await http
      .get(`/api/v1/quotations/${q.id}/attachments/${attId}/download`)
      .set('Cookie', cookie);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('image/png');

    // a non-image is rejected
    const badUp = await http
      .post(`/api/v1/quotations/${q.id}/attachments`)
      .set('Cookie', cookie)
      .attach('file', Buffer.from('#!/bin/sh'), {
        filename: 'x.sh',
        contentType: 'application/x-sh',
      });
    expect(badUp.status).toBe(400);

    const del = await http
      .delete(`/api/v1/quotations/${q.id}/attachments/${attId}`)
      .set('Cookie', cookie);
    expect(del.status).toBe(204);

    // printable document
    const doc = await http.get(`/api/v1/quotations/${q.id}/print`).set('Cookie', cookie);
    expect(doc.status).toBe(200);
    expect(doc.headers['content-type']).toContain('text/html');
    expect(doc.text).toContain(q.number);
    expect(doc.text).toContain('Quotation');
  });
});
