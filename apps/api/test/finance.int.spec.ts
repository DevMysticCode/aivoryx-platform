import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 9 — Finance: operational invoicing & payments (ADR 0038). Draft →
 * issue → immutability, tenant-safe numbering, generic tax/discount, payment
 * recording / allocation / partial / full / multi-invoice / unallocated /
 * reversal, credit notes, overdue derivation, over-allocation + currency-
 * mismatch rejection, idempotency, concurrency, tenant isolation, permission
 * enforcement, outbox events, and the customer / project financial summaries.
 * Direct PostgreSQL RLS proof is in `rls.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)('Finance (invoicing & payments)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;
  let pool: Pool;

  beforeAll(async () => {
    fx = await makeFixtures();
    app = await bootTestApp();
    http = request(app.getHttpServer());
    pool = await rawPool();
  });

  afterAll(async () => {
    await pool?.end();
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

  async function makeCustomer(cookie: string, name = 'Finance Co'): Promise<string> {
    const res = await http
      .post('/api/v1/customers')
      .set('Cookie', cookie)
      .send({ name: `${name} ${uniq()}`, email: `pay-${uniq()}@example.test` });
    expect(res.status).toBe(200);
    return res.body.id as string;
  }

  const oneLine = (over: Record<string, unknown> = {}) => ({
    description: 'Consulting',
    quantity: '10',
    unitPrice: '1000.00',
    discountType: 'AMOUNT',
    discountValue: '0',
    taxRate: '0.18',
    ...over,
  });

  async function draftInvoice(
    cookie: string,
    customerId: string,
    body: Record<string, unknown> = {},
  ): Promise<{
    id: string;
    number: string;
    status: string;
    grandTotal: string;
    amountOutstanding: string;
  }> {
    const res = await http
      .post('/api/v1/finance/invoices')
      .set('Cookie', cookie)
      .send({ customerId, dueDate: '2020-01-01', lines: [oneLine()], ...body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body;
  }

  async function issue(cookie: string, id: string, key?: string) {
    const req = http.post(`/api/v1/finance/invoices/${id}/issue`).set('Cookie', cookie);
    if (key) req.set('Idempotency-Key', key);
    return req.send({});
  }

  async function recordPayment(
    cookie: string,
    customerId: string,
    amount: string,
    extra: Record<string, unknown> = {},
    key?: string,
  ) {
    const req = http.post('/api/v1/finance/payments').set('Cookie', cookie);
    if (key) req.set('Idempotency-Key', key);
    return req.send({ customerId, paymentDate: '2026-01-15', amount, ...extra });
  }

  // ---- 1–4. draft → edit → issue → immutable -------------------

  it('creates an editable draft, then freezes it on issue', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId);
    expect(inv.number).toMatch(/^INV-\d{6}$/);
    expect(inv.status).toBe('DRAFT');
    // 10 × 1000 = 10000 gross, +18% tax = 11800 grand total
    expect(inv.grandTotal).toBe('11800.00');
    expect(inv.amountOutstanding).toBe('11800.00');

    const edited = await http
      .patch(`/api/v1/finance/invoices/${inv.id}`)
      .set('Cookie', cookie)
      .send({
        lines: [oneLine({ quantity: '5' }), oneLine({ description: 'Extra', quantity: '1' })],
      });
    expect(edited.status).toBe(200);
    expect(edited.body.grandTotal).toBe('7080.00'); // (5000 + 1000) × 1.18

    const issued = await issue(cookie, inv.id);
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe('ISSUED');
    expect(issued.body.issuedAt).toBeTruthy();

    const editAfter = await http
      .patch(`/api/v1/finance/invoices/${inv.id}`)
      .set('Cookie', cookie)
      .send({ notes: 'nope' });
    expect(editAfter.status).toBe(409);
    expect(editAfter.body.error.code).toBe('INVOICE_IMMUTABLE');
  });

  it('rejects issuing an invoice with no lines', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const res = await http
      .post('/api/v1/finance/invoices')
      .set('Cookie', cookie)
      .send({ customerId, lines: [] });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVOICE_NO_LINES');
  });

  // ---- 5–9. payments: allocate, partial, full, multi ----------

  it('records a payment, allocates it, and drives the invoice PARTIALLY_PAID → PAID', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId, { lines: [oneLine({ taxRate: '0' })] }); // 10000
    await issue(cookie, inv.id);

    const pay1 = await recordPayment(cookie, customerId, '3000.00');
    expect(pay1.status).toBe(200);
    expect(pay1.body.status).toBe('RECORDED');
    expect(pay1.body.unallocatedAmount).toBe('3000.00');

    const alloc1 = await http
      .post(`/api/v1/finance/payments/${pay1.body.id}/allocate`)
      .set('Cookie', cookie)
      .send({ allocations: [{ invoiceId: inv.id, amount: '3000.00' }] });
    expect(alloc1.status).toBe(200);
    expect(alloc1.body.unallocatedAmount).toBe('0.00');

    const afterPartial = await http.get(`/api/v1/finance/invoices/${inv.id}`).set('Cookie', cookie);
    expect(afterPartial.body.status).toBe('PARTIALLY_PAID');
    expect(afterPartial.body.amountOutstanding).toBe('7000.00');

    // second payment records + allocates in one request
    const pay2 = await recordPayment(cookie, customerId, '7000.00', {
      allocations: [{ invoiceId: inv.id, amount: '7000.00' }],
    });
    expect(pay2.status).toBe(200);

    const paid = await http.get(`/api/v1/finance/invoices/${inv.id}`).set('Cookie', cookie);
    expect(paid.body.status).toBe('PAID');
    expect(paid.body.amountOutstanding).toBe('0.00');
    expect(paid.body.amountPaid).toBe('10000.00');
  });

  it('splits one payment across multiple invoices', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const a = await draftInvoice(cookie, customerId, {
      lines: [oneLine({ quantity: '6', taxRate: '0' })],
    });
    const b = await draftInvoice(cookie, customerId, {
      lines: [oneLine({ quantity: '4', taxRate: '0' })],
    });
    await issue(cookie, a.id);
    await issue(cookie, b.id);

    const pay = await recordPayment(cookie, customerId, '10000.00', {
      allocations: [
        { invoiceId: a.id, amount: '6000.00' },
        { invoiceId: b.id, amount: '4000.00' },
      ],
    });
    expect(pay.status).toBe(200);
    expect(pay.body.unallocatedAmount).toBe('0.00');
    expect(
      (await http.get(`/api/v1/finance/invoices/${a.id}`).set('Cookie', cookie)).body.status,
    ).toBe('PAID');
    expect(
      (await http.get(`/api/v1/finance/invoices/${b.id}`).set('Cookie', cookie)).body.status,
    ).toBe('PAID');
  });

  it('keeps an unallocated payment authoritative and allocates it later', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const pay = await recordPayment(cookie, customerId, '5000.00');
    expect(pay.body.unallocatedAmount).toBe('5000.00');
    expect(pay.body.allocatedAmount).toBe('0.00');

    const inv = await draftInvoice(cookie, customerId, {
      lines: [oneLine({ quantity: '5', taxRate: '0' })],
    });
    await issue(cookie, inv.id);
    const alloc = await http
      .post(`/api/v1/finance/payments/${pay.body.id}/allocate`)
      .set('Cookie', cookie)
      .send({ allocations: [{ invoiceId: inv.id, amount: '5000.00' }] });
    expect(alloc.status).toBe(200);
    expect(alloc.body.unallocatedAmount).toBe('0.00');
  });

  it('rejects over-allocation (invoice outstanding) and does not discard money', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId, {
      lines: [oneLine({ quantity: '1', taxRate: '0' })],
    }); // 1000
    await issue(cookie, inv.id);
    const pay = await recordPayment(cookie, customerId, '5000.00');
    const bad = await http
      .post(`/api/v1/finance/payments/${pay.body.id}/allocate`)
      .set('Cookie', cookie)
      .send({ allocations: [{ invoiceId: inv.id, amount: '1500.00' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('ALLOCATION_EXCEEDS_INVOICE');
    // the payment is untouched
    const fresh = await http.get(`/api/v1/finance/payments/${pay.body.id}`).set('Cookie', cookie);
    expect(fresh.body.unallocatedAmount).toBe('5000.00');
  });

  it('rejects allocating across a currency mismatch', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId, {
      currency: 'USD',
      lines: [oneLine({ quantity: '1', taxRate: '0' })],
    });
    await issue(cookie, inv.id);
    const pay = await recordPayment(cookie, customerId, '1000.00', { currency: 'INR' });
    const bad = await http
      .post(`/api/v1/finance/payments/${pay.body.id}/allocate`)
      .set('Cookie', cookie)
      .send({ allocations: [{ invoiceId: inv.id, amount: '1000.00' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('FINANCE_CURRENCY_MISMATCH');
  });

  it('rejects negative / zero / non-decimal money', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    expect((await recordPayment(cookie, customerId, '-5.00')).status).toBe(422);
    expect((await recordPayment(cookie, customerId, '0')).status).toBe(422);
    expect((await recordPayment(cookie, customerId, 'lots')).status).toBe(422);
  });

  // ---- 10. payment reversal -----------------------------------

  it('reverses a payment: preserves the record, undoes allocations, cannot double-reverse', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId, {
      lines: [oneLine({ quantity: '5', taxRate: '0' })],
    }); // 5000
    await issue(cookie, inv.id);
    const pay = await recordPayment(cookie, customerId, '5000.00', {
      allocations: [{ invoiceId: inv.id, amount: '5000.00' }],
    });
    expect(
      (await http.get(`/api/v1/finance/invoices/${inv.id}`).set('Cookie', cookie)).body.status,
    ).toBe('PAID');

    const rev = await http
      .post(`/api/v1/finance/payments/${pay.body.id}/reverse`)
      .set('Cookie', cookie)
      .send({ reason: 'bounced' });
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('REVERSED');
    expect(rev.body.reversedAt).toBeTruthy();
    expect(rev.body.allocatedAmount).toBe('0.00');

    const back = await http.get(`/api/v1/finance/invoices/${inv.id}`).set('Cookie', cookie);
    expect(back.body.status).toBe('ISSUED');
    expect(back.body.amountOutstanding).toBe('5000.00');

    const rev2 = await http
      .post(`/api/v1/finance/payments/${pay.body.id}/reverse`)
      .set('Cookie', cookie)
      .send({});
    // idempotent — returns the already-reversed payment, does nothing more
    expect(rev2.status).toBe(200);
    expect(rev2.body.status).toBe('REVERSED');
    const rows = await pool.query(
      `select count(*)::int n from outbox_events where type='payment.reversed' and payload->>'paymentId' = $1`,
      [pay.body.id],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  // ---- 11–13. credit notes ----------------------------------

  it('a credit note reduces then (on cancel) restores the invoice receivable', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId, {
      lines: [oneLine({ quantity: '10', taxRate: '0' })],
    }); // 10000
    await issue(cookie, inv.id);

    const cn = await http
      .post('/api/v1/finance/credit-notes')
      .set('Cookie', cookie)
      .send({ customerId, invoiceId: inv.id, amount: '2500.00', reason: 'goodwill' });
    expect(cn.status).toBe(200);
    expect(cn.body.status).toBe('DRAFT');
    // draft has no financial effect yet
    expect(
      (await http.get(`/api/v1/finance/invoices/${inv.id}`).set('Cookie', cookie)).body
        .amountOutstanding,
    ).toBe('10000.00');

    const issued = await http
      .post(`/api/v1/finance/credit-notes/${cn.body.id}/issue`)
      .set('Cookie', cookie)
      .send({});
    expect(issued.status).toBe(200);
    const afterCredit = await http.get(`/api/v1/finance/invoices/${inv.id}`).set('Cookie', cookie);
    expect(afterCredit.body.amountCredited).toBe('2500.00');
    expect(afterCredit.body.amountOutstanding).toBe('7500.00');

    const cancelled = await http
      .post(`/api/v1/finance/credit-notes/${cn.body.id}/cancel`)
      .set('Cookie', cookie)
      .send({});
    expect(cancelled.status).toBe(200);
    expect(
      (await http.get(`/api/v1/finance/invoices/${inv.id}`).set('Cookie', cookie)).body
        .amountOutstanding,
    ).toBe('10000.00');
  });

  it('rejects a credit note larger than the invoice outstanding', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId, {
      lines: [oneLine({ quantity: '1', taxRate: '0' })],
    }); // 1000
    await issue(cookie, inv.id);
    const cn = await http
      .post('/api/v1/finance/credit-notes')
      .set('Cookie', cookie)
      .send({ customerId, invoiceId: inv.id, amount: '5000.00', reason: 'too big' });
    const bad = await http
      .post(`/api/v1/finance/credit-notes/${cn.body.id}/issue`)
      .set('Cookie', cookie)
      .send({});
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('CREDIT_NOTE_EXCEEDS_INVOICE');
  });

  // ---- 14–16. cancellation + overdue -----------------------

  it('cancels an issued invoice only when it has no active allocations', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId, {
      lines: [oneLine({ quantity: '2', taxRate: '0' })],
    }); // 2000
    await issue(cookie, inv.id);
    const pay = await recordPayment(cookie, customerId, '1000.00', {
      allocations: [{ invoiceId: inv.id, amount: '1000.00' }],
    });
    expect(
      (await http.get(`/api/v1/finance/invoices/${inv.id}`).set('Cookie', cookie)).body.status,
    ).toBe('PARTIALLY_PAID');
    const blocked = await http
      .post(`/api/v1/finance/invoices/${inv.id}/cancel`)
      .set('Cookie', cookie)
      .send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('INVOICE_HAS_ALLOCATIONS');

    await http
      .post(`/api/v1/finance/payments/${pay.body.id}/reverse`)
      .set('Cookie', cookie)
      .send({});
    const ok = await http
      .post(`/api/v1/finance/invoices/${inv.id}/cancel`)
      .set('Cookie', cookie)
      .send({ reason: 'duplicate' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('CANCELLED');
  });

  it('derives overdue and the sweep emits invoice.overdue exactly once', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId, {
      dueDate: '2020-06-01',
      lines: [oneLine({ quantity: '1', taxRate: '0' })],
    });
    await issue(cookie, inv.id, `issue-${inv.id}`);

    const fresh = await http.get(`/api/v1/finance/invoices/${inv.id}`).set('Cookie', cookie);
    expect(fresh.body.overdue).toBe(true);
    expect(fresh.body.daysOverdue).toBeGreaterThan(0);

    const s1 = await http
      .post('/api/v1/finance/maintenance/overdue-sweep')
      .set('Cookie', cookie)
      .send({});
    expect(s1.status).toBe(200);
    expect(s1.body.notified).toBeGreaterThanOrEqual(1);
    const s2 = await http
      .post('/api/v1/finance/maintenance/overdue-sweep')
      .set('Cookie', cookie)
      .send({});
    // already notified — not re-emitted
    const rows = await pool.query(
      `select count(*)::int n from outbox_events where type='invoice.overdue' and payload->>'invoiceId' = $1`,
      [inv.id],
    );
    expect(rows.rows[0].n).toBe(1);
    expect(s2.body.notified).toBe(0);
  });

  // ---- 17. idempotency -------------------------------------

  it('a repeated record-payment request with the same Idempotency-Key creates one payment', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const key = `pay-${uniq()}`;
    const a = await recordPayment(cookie, customerId, '1234.00', {}, key);
    const b = await recordPayment(cookie, customerId, '1234.00', {}, key);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    const rows = await pool.query(`select count(*)::int n from payments where customer_id = $1`, [
      customerId,
    ]);
    expect(rows.rows[0].n).toBe(1);
  });

  // ---- 18. concurrency ------------------------------------

  it('concurrent allocation of the same payment to one invoice never over-pays', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId, {
      lines: [oneLine({ quantity: '1', taxRate: '0' })],
    }); // 1000
    await issue(cookie, inv.id);
    const pay = await recordPayment(cookie, customerId, '1000.00');

    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        http
          .post(`/api/v1/finance/payments/${pay.body.id}/allocate`)
          .set('Cookie', cookie)
          .send({ allocations: [{ invoiceId: inv.id, amount: '1000.00' }] }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value.status === 200).length;
    expect(ok).toBe(1);

    const finalInv = await http.get(`/api/v1/finance/invoices/${inv.id}`).set('Cookie', cookie);
    expect(finalInv.body.amountPaid).toBe('1000.00');
    expect(finalInv.body.amountOutstanding).toBe('0.00');
    const allocRows = await pool.query(
      `select count(*)::int n from payment_allocations where invoice_id = $1 and reversed_at is null`,
      [inv.id],
    );
    expect(allocRows.rows[0].n).toBe(1);
  });

  it('concurrent invoice creation produces unique, gapless-per-tenant numbers', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => draftInvoice(cookie, customerId)),
    );
    const numbers = results.map((r) => r.number);
    expect(new Set(numbers).size).toBe(numbers.length);
    for (const n of numbers) expect(n).toMatch(/^INV-\d{6}$/);
  });

  // ---- 19–20. isolation + permissions --------------------

  it('is tenant-isolated: admin B cannot see or act on tenant A finance rows', async () => {
    const cookieA = await adminCookie();
    const cookieB = await adminBCookie();
    const customerId = await makeCustomer(cookieA);
    const inv = await draftInvoice(cookieA, customerId);

    expect(
      (await http.get(`/api/v1/finance/invoices/${inv.id}`).set('Cookie', cookieB)).status,
    ).toBe(404);
    expect(
      (await http.post(`/api/v1/finance/invoices/${inv.id}/issue`).set('Cookie', cookieB).send({}))
        .status,
    ).toBe(404);
    const listB = await http.get('/api/v1/finance/invoices').set('Cookie', cookieB);
    expect(listB.body.items.some((i: { id: string }) => i.id === inv.id)).toBe(false);
  });

  it('enforces finance permissions', async () => {
    const plain = await plainCookie();
    expect((await http.get('/api/v1/finance/invoices').set('Cookie', plain)).status).toBe(403);
    expect((await http.post('/api/v1/finance/payments').set('Cookie', plain).send({})).status).toBe(
      403,
    );
    expect((await http.get('/api/v1/finance/overview').set('Cookie', plain)).status).toBe(403);
  });

  // ---- 21. events ---------------------------------------

  it('emits finance events into the shared outbox', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId, {
      lines: [oneLine({ quantity: '1', taxRate: '0' })],
    });
    await issue(cookie, inv.id);
    await recordPayment(cookie, customerId, '1000.00', {
      allocations: [{ invoiceId: inv.id, amount: '1000.00' }],
    });

    const types = (
      await pool.query<{ type: string }>(
        `select type from outbox_events where tenant_id = $1 and payload->>'invoiceId' = $2`,
        [fx.tenantA, inv.id],
      )
    ).rows.map((r) => r.type);
    expect(types).toEqual(
      expect.arrayContaining(['invoice.created', 'invoice.issued', 'invoice.paid']),
    );

    const payTypes = (
      await pool.query<{ type: string }>(
        `select distinct type from outbox_events where tenant_id = $1 and type like 'payment.%'`,
        [fx.tenantA],
      )
    ).rows.map((r) => r.type);
    expect(payTypes).toEqual(expect.arrayContaining(['payment.recorded', 'payment.allocated']));
  });

  // ---- 22–24. quotation → invoice + summaries -----------

  it('creates an invoice from a booked quotation, then exposes the project + customer summary', async () => {
    const cookie = await adminCookie();
    // lead → quotation → send → accept → book (reuses the commercial flow)
    const lead = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({ name: `Q2I ${uniq()}`, phone: `9${Math.floor(Math.random() * 1e9)}`.slice(0, 10) });
    const q = await http
      .post('/api/v1/quotations')
      .set('Cookie', cookie)
      .send({
        leadId: lead.body.id,
        validityDate: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        lines: [{ description: 'Panels', quantity: '10', unitPrice: '2500', taxRate: '0.18' }],
      });
    await http.post(`/api/v1/quotations/${q.body.id}/send`).set('Cookie', cookie).send({});
    await http.post(`/api/v1/quotations/${q.body.id}/accept`).set('Cookie', cookie).send({});
    const booking = await http
      .post(`/api/v1/quotations/${q.body.id}/book`)
      .set('Cookie', cookie)
      .send({});
    expect(booking.status).toBe(200);
    const projectId = booking.body.projectId as string;

    const inv = await http
      .post('/api/v1/finance/invoices/from-quotation')
      .set('Cookie', cookie)
      .send({ quotationId: q.body.id, dueDate: '2027-01-01' });
    expect(inv.status, JSON.stringify(inv.body)).toBe(200);
    expect(inv.body.source).toBe('quotation');
    expect(inv.body.projectId).toBe(projectId);
    expect(inv.body.lines).toHaveLength(1);
    expect(inv.body.grandTotal).toBe('29500.00'); // 10 × 2500 = 25000 + 18%
    await http.post(`/api/v1/finance/invoices/${inv.body.id}/issue`).set('Cookie', cookie).send({});
    await http
      .post('/api/v1/finance/payments')
      .set('Cookie', cookie)
      .send({
        customerId: inv.body.customerId,
        paymentDate: '2026-02-01',
        amount: '10000.00',
        allocations: [{ invoiceId: inv.body.id, amount: '10000.00' }],
      });

    const projSummary = await http
      .get(`/api/v1/finance/projects/${projectId}/summary`)
      .set('Cookie', cookie);
    expect(projSummary.status).toBe(200);
    expect(projSummary.body.invoicedTotal).toBe('29500.00');
    expect(projSummary.body.paidTotal).toBe('10000.00');
    expect(projSummary.body.outstandingTotal).toBe('19500.00');

    const custSummary = await http
      .get(`/api/v1/finance/customers/${inv.body.customerId}/summary`)
      .set('Cookie', cookie);
    expect(custSummary.status).toBe(200);
    expect(custSummary.body.outstandingTotal).toBe('19500.00');
    expect(custSummary.body.recentInvoices.length).toBeGreaterThan(0);
    expect(custSummary.body.recentPayments.length).toBeGreaterThan(0);
  });

  it('the printable invoice + payment receipt render', async () => {
    const cookie = await adminCookie();
    const customerId = await makeCustomer(cookie);
    const inv = await draftInvoice(cookie, customerId);
    await issue(cookie, inv.id);
    const pay = await recordPayment(cookie, customerId, '100.00');
    const invHtml = await http
      .get(`/api/v1/finance/invoices/${inv.id}/print`)
      .set('Cookie', cookie);
    expect(invHtml.status).toBe(200);
    expect(invHtml.headers['content-type']).toContain('text/html');
    expect(invHtml.text).toContain(inv.number);
    const rcpt = await http
      .get(`/api/v1/finance/payments/${pay.body.id}/print`)
      .set('Cookie', cookie);
    expect(rcpt.status).toBe(200);
    expect(rcpt.text).toContain('Payment receipt');
  });

  it('rejects an unauthenticated caller', async () => {
    expect((await http.get('/api/v1/finance/invoices')).status).toBe(401);
    expect((await http.post('/api/v1/finance/payments').send({})).status).toBe(401);
  });
});
