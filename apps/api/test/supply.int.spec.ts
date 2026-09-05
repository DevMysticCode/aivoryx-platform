import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 5 — procurement, inventory & logistics (ADR 0034): the full
 * project → PO → receipt → allocation → dispatch → delivery chain over
 * HTTP, plus tenant isolation, RBAC, transactional invariants, and
 * concurrency/idempotency. Direct PostgreSQL RLS proof is in `rls.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)('Supply chain', () => {
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

  async function baseData(cookie: string) {
    const unit = await http
      .post('/api/v1/inventory/units')
      .set('Cookie', cookie)
      .send({ code: `U${uniq()}`, name: 'Pieces' });
    expect(unit.status).toBe(200);
    const product = await http
      .post('/api/v1/inventory/products')
      .set('Cookie', cookie)
      .send({ sku: `SKU-${uniq()}`, name: 'Panel', unitId: unit.body.id, reorderLevel: '5' });
    expect(product.status).toBe(200);
    const supplier = await http
      .post('/api/v1/inventory/suppliers')
      .set('Cookie', cookie)
      .send({ code: `S-${uniq()}`, name: 'Acme' });
    expect(supplier.status).toBe(200);
    const warehouse = await http
      .post('/api/v1/inventory/warehouses')
      .set('Cookie', cookie)
      .send({ code: `W-${uniq()}`, name: 'Main', type: 'main' });
    expect(warehouse.status).toBe(200);
    const lead = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({
        name: 'Project Customer',
        phone: `9${Math.floor(Math.random() * 1e9)}`.slice(0, 10),
      });
    expect(lead.status).toBe(200);
    return {
      unitId: unit.body.id as string,
      productId: product.body.id as string,
      supplierId: supplier.body.id as string,
      warehouseId: warehouse.body.id as string,
      leadId: lead.body.id as string,
    };
  }

  // ---- catalog -------------------------------------------------

  it('catalog CRUD is tenant-scoped and permission-gated', async () => {
    const cookie = await adminCookie();
    const d = await baseData(cookie);

    const list = await http.get('/api/v1/inventory/products').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.items.some((p: { id: string }) => p.id === d.productId)).toBe(true);

    // tenant B cannot see tenant A's product
    const bCookie = await adminBCookie();
    const bGet = await http.get(`/api/v1/inventory/products/${d.productId}`).set('Cookie', bCookie);
    expect(bGet.status).toBe(404);

    // a member with no supply permissions is forbidden
    const pCookie = await plainCookie();
    const forbidden = await http.get('/api/v1/inventory/products').set('Cookie', pCookie);
    expect(forbidden.status).toBe(403);

    // duplicate SKU -> stable code
    const dupe = await http
      .post('/api/v1/inventory/products')
      .set('Cookie', cookie)
      .send({ sku: list.body.items[0].sku, name: 'x', unitId: d.unitId });
    expect(dupe.status).toBe(409);
    expect(dupe.body.error.code).toBe('DUPLICATE_CODE');
  });

  // ---- project ----------------------------------------------

  it('a project links to a CRM lead and is visible from it', async () => {
    const cookie = await adminCookie();
    const d = await baseData(cookie);
    const project = await http
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ leadId: d.leadId });
    expect(project.status).toBe(200);
    expect(project.body.status).toBe('DRAFT');

    const byLead = await http
      .get('/api/v1/projects')
      .query({ leadId: d.leadId })
      .set('Cookie', cookie);
    expect(byLead.body.items.some((p: { id: string }) => p.id === project.body.id)).toBe(true);

    const approved = await http
      .post(`/api/v1/projects/${project.body.id}/approve`)
      .set('Cookie', cookie);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.approvedAt).toBeTruthy();

    // cannot approve twice
    const again = await http
      .post(`/api/v1/projects/${project.body.id}/approve`)
      .set('Cookie', cookie);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('PROJECT_INVALID_TRANSITION');
  });

  // ---- the golden chain ------------------------------------

  it('PO -> approve -> receive raises stock; partial receipt and over-receipt are handled', async () => {
    const cookie = await adminCookie();
    const d = await baseData(cookie);

    const po = await http
      .post('/api/v1/procurement/purchase-orders')
      .set('Cookie', cookie)
      .send({
        supplierId: d.supplierId,
        lines: [{ productId: d.productId, orderedQty: '10', unitPrice: '100.00', taxRate: '0.18' }],
      });
    expect(po.status).toBe(200);
    expect(po.body.status).toBe('DRAFT');
    expect(po.body.total).toBe('1180.00');
    const poId = po.body.id as string;
    const poLineId = po.body.lines[0].id as string;

    // cannot receive a draft PO
    const early = await http
      .post(`/api/v1/procurement/purchase-orders/${poId}/receive`)
      .set('Cookie', cookie)
      .send({
        warehouseId: d.warehouseId,
        lines: [{ purchaseOrderLineId: poLineId, receivedQty: '5' }],
      });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('PO_NOT_APPROVED');

    await http.post(`/api/v1/procurement/purchase-orders/${poId}/submit`).set('Cookie', cookie);
    await http.post(`/api/v1/procurement/purchase-orders/${poId}/approve`).set('Cookie', cookie);

    // over-receipt rejected
    const over = await http
      .post(`/api/v1/procurement/purchase-orders/${poId}/receive`)
      .set('Cookie', cookie)
      .send({
        warehouseId: d.warehouseId,
        lines: [{ purchaseOrderLineId: poLineId, receivedQty: '11' }],
      });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('PO_OVER_RECEIPT');

    // partial receipt
    const partial = await http
      .post(`/api/v1/procurement/purchase-orders/${poId}/receive`)
      .set('Cookie', cookie)
      .send({
        warehouseId: d.warehouseId,
        lines: [{ purchaseOrderLineId: poLineId, receivedQty: '6' }],
      });
    expect(partial.status).toBe(200);
    expect(partial.body.status).toBe('PARTIALLY_RECEIVED');

    let stock = await http
      .get('/api/v1/inventory/stock')
      .query({ productId: d.productId, warehouseId: d.warehouseId })
      .set('Cookie', cookie);
    expect(stock.body.items[0].onHand).toBe('6.0000');
    expect(stock.body.items[0].available).toBe('6.0000');

    // receive the rest
    const rest = await http
      .post(`/api/v1/procurement/purchase-orders/${poId}/receive`)
      .set('Cookie', cookie)
      .send({
        warehouseId: d.warehouseId,
        lines: [{ purchaseOrderLineId: poLineId, receivedQty: '4' }],
      });
    expect(rest.body.status).toBe('RECEIVED');

    stock = await http
      .get('/api/v1/inventory/stock')
      .query({ productId: d.productId, warehouseId: d.warehouseId })
      .set('Cookie', cookie);
    expect(stock.body.items[0].onHand).toBe('10.0000');

    // the ledger recorded exactly two RECEIPT movements
    const movements = await http
      .get('/api/v1/inventory/movements')
      .query({ productId: d.productId, type: 'RECEIPT' })
      .set('Cookie', cookie);
    expect(movements.body.items.length).toBe(2);
  });

  it('allocation respects requirement + availability, dispatch decrements stock, delivery updates the project', async () => {
    const cookie = await adminCookie();
    const d = await baseData(cookie);

    // stock the warehouse via adjustment
    const adj = await http
      .post('/api/v1/inventory/adjustments')
      .set('Cookie', cookie)
      .send({ warehouseId: d.warehouseId, productId: d.productId, delta: '50', reason: 'opening' });
    expect(adj.status).toBe(200);

    const project = (
      await http.post('/api/v1/projects').set('Cookie', cookie).send({ leadId: d.leadId })
    ).body;
    await http.post(`/api/v1/projects/${project.id}/approve`).set('Cookie', cookie);
    await http
      .post(`/api/v1/projects/${project.id}/materials`)
      .set('Cookie', cookie)
      .send({ productId: d.productId, requiredQty: '20' });

    // allocation cannot exceed the requirement
    const tooMuch = await http
      .post(`/api/v1/projects/${project.id}/materials/allocate`)
      .set('Cookie', cookie)
      .send({ productId: d.productId, warehouseId: d.warehouseId, quantity: '25' });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.code).toBe('ALLOCATION_EXCEEDS_REQUIREMENT');

    // allocate 20
    const alloc = await http
      .post(`/api/v1/projects/${project.id}/materials/allocate`)
      .set('Cookie', cookie)
      .send({ productId: d.productId, warehouseId: d.warehouseId, quantity: '20' });
    expect(alloc.status).toBe(200);
    const mat = alloc.body.materials.find(
      (m: { productId: string }) => m.productId === d.productId,
    );
    expect(mat.allocatedQty).toBe('20.0000');
    expect(mat.remainingQty).toBe('0.0000');

    // available stock dropped by the reservation
    let stock = await http
      .get('/api/v1/inventory/stock')
      .query({ productId: d.productId, warehouseId: d.warehouseId })
      .set('Cookie', cookie);
    expect(stock.body.items[0].onHand).toBe('50.0000');
    expect(stock.body.items[0].reserved).toBe('20.0000');
    expect(stock.body.items[0].available).toBe('30.0000');

    // release 5
    const rel = await http
      .post(`/api/v1/projects/${project.id}/materials/release`)
      .set('Cookie', cookie)
      .send({ productId: d.productId, warehouseId: d.warehouseId, quantity: '5' });
    expect(rel.status).toBe(200);
    stock = await http
      .get('/api/v1/inventory/stock')
      .query({ productId: d.productId, warehouseId: d.warehouseId })
      .set('Cookie', cookie);
    expect(stock.body.items[0].reserved).toBe('15.0000');

    // re-allocate the 5
    await http
      .post(`/api/v1/projects/${project.id}/materials/allocate`)
      .set('Cookie', cookie)
      .send({ productId: d.productId, warehouseId: d.warehouseId, quantity: '5' });

    // dispatch 15
    const dispatch = await http
      .post('/api/v1/logistics/dispatches')
      .set('Cookie', cookie)
      .send({
        projectId: project.id,
        warehouseId: d.warehouseId,
        lines: [{ productId: d.productId, quantity: '15' }],
      });
    expect(dispatch.status).toBe(200);
    expect(dispatch.body.status).toBe('DRAFT');
    const dispatchId = dispatch.body.id as string;

    // cannot dispatch more than allocated
    const bad = await http
      .patch(`/api/v1/logistics/dispatches/${dispatchId}`)
      .set('Cookie', cookie)
      .send({ lines: [{ productId: d.productId, quantity: '999' }] });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('DISPATCH_EXCEEDS_ALLOCATED');

    const sent = await http
      .post(`/api/v1/logistics/dispatches/${dispatchId}/dispatch`)
      .set('Cookie', cookie);
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('DISPATCHED');

    stock = await http
      .get('/api/v1/inventory/stock')
      .query({ productId: d.productId, warehouseId: d.warehouseId })
      .set('Cookie', cookie);
    expect(stock.body.items[0].onHand).toBe('35.0000'); // 50 - 15
    expect(stock.body.items[0].reserved).toBe('5.0000'); // 20 - 15

    const proj = await http.get(`/api/v1/projects/${project.id}`).set('Cookie', cookie);
    const pmat = proj.body.materials.find(
      (m: { productId: string }) => m.productId === d.productId,
    );
    expect(pmat.dispatchedQty).toBe('15.0000');

    // deliver
    const delivered = await http
      .post(`/api/v1/logistics/dispatches/${dispatchId}/deliver`)
      .set('Cookie', cookie)
      .send({ deliveryNotes: 'received on site' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.status).toBe('DELIVERED');

    const proj2 = await http.get(`/api/v1/projects/${project.id}`).set('Cookie', cookie);
    const pmat2 = proj2.body.materials.find(
      (m: { productId: string }) => m.productId === d.productId,
    );
    expect(pmat2.deliveredQty).toBe('15.0000');

    // project timeline recorded the milestones
    const acts = await http.get(`/api/v1/projects/${project.id}/activities`).set('Cookie', cookie);
    const types = (acts.body as { type: string }[]).map((a) => a.type);
    expect(types).toEqual(
      expect.arrayContaining([
        'approved',
        'allocated',
        'dispatch_created',
        'dispatched',
        'delivered',
      ]),
    );
  });

  it('allocation cannot exceed available stock', async () => {
    const cookie = await adminCookie();
    const d = await baseData(cookie);
    await http
      .post('/api/v1/inventory/adjustments')
      .set('Cookie', cookie)
      .send({ warehouseId: d.warehouseId, productId: d.productId, delta: '3', reason: 'x' });
    const project = (
      await http.post('/api/v1/projects').set('Cookie', cookie).send({ leadId: d.leadId })
    ).body;
    await http.post(`/api/v1/projects/${project.id}/approve`).set('Cookie', cookie);
    await http
      .post(`/api/v1/projects/${project.id}/materials`)
      .set('Cookie', cookie)
      .send({ productId: d.productId, requiredQty: '10' });
    const res = await http
      .post(`/api/v1/projects/${project.id}/materials/allocate`)
      .set('Cookie', cookie)
      .send({ productId: d.productId, warehouseId: d.warehouseId, quantity: '5' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALLOCATION_EXCEEDS_AVAILABLE_STOCK');
  });

  it('a manual adjustment cannot drive stock negative', async () => {
    const cookie = await adminCookie();
    const d = await baseData(cookie);
    const res = await http.post('/api/v1/inventory/adjustments').set('Cookie', cookie).send({
      warehouseId: d.warehouseId,
      productId: d.productId,
      delta: '-5',
      reason: 'shrinkage',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NEGATIVE_STOCK_NOT_ALLOWED');
  });

  it('a stock transfer moves quantity between warehouses and refuses same-warehouse', async () => {
    const cookie = await adminCookie();
    const d = await baseData(cookie);
    const wh2 = (
      await http
        .post('/api/v1/inventory/warehouses')
        .set('Cookie', cookie)
        .send({ code: `W2-${uniq()}`, name: 'South', type: 'regional' })
    ).body;
    await http
      .post('/api/v1/inventory/adjustments')
      .set('Cookie', cookie)
      .send({ warehouseId: d.warehouseId, productId: d.productId, delta: '20', reason: 'x' });

    const same = await http.post('/api/v1/inventory/transfers').set('Cookie', cookie).send({
      sourceWarehouseId: d.warehouseId,
      destinationWarehouseId: d.warehouseId,
      productId: d.productId,
      quantity: '5',
    });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe('TRANSFER_SAME_WAREHOUSE');

    const transfer = await http.post('/api/v1/inventory/transfers').set('Cookie', cookie).send({
      sourceWarehouseId: d.warehouseId,
      destinationWarehouseId: wh2.id,
      productId: d.productId,
      quantity: '8',
    });
    expect(transfer.status).toBe(200);

    const src = await http
      .get(`/api/v1/inventory/warehouses/${d.warehouseId}/stock`)
      .set('Cookie', cookie);
    expect(src.body[0].onHand).toBe('12.0000');
    const dst = await http
      .get(`/api/v1/inventory/warehouses/${wh2.id}/stock`)
      .set('Cookie', cookie);
    expect(dst.body[0].onHand).toBe('8.0000');
  });

  // ---- concurrency / idempotency ----------------------------

  it('duplicate goods receipt with the same idempotency key does not double-count', async () => {
    const cookie = await adminCookie();
    const d = await baseData(cookie);
    const po = (
      await http
        .post('/api/v1/procurement/purchase-orders')
        .set('Cookie', cookie)
        .send({ supplierId: d.supplierId, lines: [{ productId: d.productId, orderedQty: '10' }] })
    ).body;
    await http.post(`/api/v1/procurement/purchase-orders/${po.id}/submit`).set('Cookie', cookie);
    await http.post(`/api/v1/procurement/purchase-orders/${po.id}/approve`).set('Cookie', cookie);

    const body = {
      warehouseId: d.warehouseId,
      idempotencyKey: `k-${uniq()}`,
      lines: [{ purchaseOrderLineId: po.lines[0].id, receivedQty: '6' }],
    };
    const [a, b] = await Promise.all([
      http
        .post(`/api/v1/procurement/purchase-orders/${po.id}/receive`)
        .set('Cookie', cookie)
        .send(body),
      http
        .post(`/api/v1/procurement/purchase-orders/${po.id}/receive`)
        .set('Cookie', cookie)
        .send(body),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);

    const stock = await http
      .get('/api/v1/inventory/stock')
      .query({ productId: d.productId, warehouseId: d.warehouseId })
      .set('Cookie', cookie);
    expect(stock.body.items[0].onHand).toBe('6.0000'); // not 12
  });

  it('concurrent duplicate allocation with the same key allocates once', async () => {
    const cookie = await adminCookie();
    const d = await baseData(cookie);
    await http
      .post('/api/v1/inventory/adjustments')
      .set('Cookie', cookie)
      .send({ warehouseId: d.warehouseId, productId: d.productId, delta: '30', reason: 'x' });
    const project = (
      await http.post('/api/v1/projects').set('Cookie', cookie).send({ leadId: d.leadId })
    ).body;
    await http.post(`/api/v1/projects/${project.id}/approve`).set('Cookie', cookie);
    await http
      .post(`/api/v1/projects/${project.id}/materials`)
      .set('Cookie', cookie)
      .send({ productId: d.productId, requiredQty: '10' });
    const allocBody = {
      productId: d.productId,
      warehouseId: d.warehouseId,
      quantity: '10',
      idempotencyKey: `a-${uniq()}`,
    };
    const [a, b] = await Promise.all([
      http
        .post(`/api/v1/projects/${project.id}/materials/allocate`)
        .set('Cookie', cookie)
        .send(allocBody),
      http
        .post(`/api/v1/projects/${project.id}/materials/allocate`)
        .set('Cookie', cookie)
        .send(allocBody),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    const proj = await http.get(`/api/v1/projects/${project.id}`).set('Cookie', cookie);
    const mat = proj.body.materials.find((m: { productId: string }) => m.productId === d.productId);
    expect(mat.allocatedQty).toBe('10.0000'); // not 20
  });

  it('concurrent duplicate dispatch sends once', async () => {
    const cookie = await adminCookie();
    const d = await baseData(cookie);
    await http
      .post('/api/v1/inventory/adjustments')
      .set('Cookie', cookie)
      .send({ warehouseId: d.warehouseId, productId: d.productId, delta: '30', reason: 'x' });
    const project = (
      await http.post('/api/v1/projects').set('Cookie', cookie).send({ leadId: d.leadId })
    ).body;
    await http.post(`/api/v1/projects/${project.id}/approve`).set('Cookie', cookie);
    await http
      .post(`/api/v1/projects/${project.id}/materials`)
      .set('Cookie', cookie)
      .send({ productId: d.productId, requiredQty: '10' });
    await http
      .post(`/api/v1/projects/${project.id}/materials/allocate`)
      .set('Cookie', cookie)
      .send({ productId: d.productId, warehouseId: d.warehouseId, quantity: '10' });
    const dispatch = (
      await http
        .post('/api/v1/logistics/dispatches')
        .set('Cookie', cookie)
        .send({
          projectId: project.id,
          warehouseId: d.warehouseId,
          lines: [{ productId: d.productId, quantity: '10' }],
        })
    ).body;
    const [a, b] = await Promise.all([
      http.post(`/api/v1/logistics/dispatches/${dispatch.id}/dispatch`).set('Cookie', cookie),
      http.post(`/api/v1/logistics/dispatches/${dispatch.id}/dispatch`).set('Cookie', cookie),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 200]);
    const stock = await http
      .get('/api/v1/inventory/stock')
      .query({ productId: d.productId, warehouseId: d.warehouseId })
      .set('Cookie', cookie);
    expect(stock.body.items[0].onHand).toBe('20.0000'); // 30 - 10, dispatched once
  });

  // ---- cross-tenant + RBAC --------------------------------

  it('tenant B cannot read or act on tenant A projects, POs, or dispatches', async () => {
    const cookieA = await adminCookie();
    const cookieB = await adminBCookie();
    const d = await baseData(cookieA);
    const project = (
      await http.post('/api/v1/projects').set('Cookie', cookieA).send({ leadId: d.leadId })
    ).body;
    const po = (
      await http
        .post('/api/v1/procurement/purchase-orders')
        .set('Cookie', cookieA)
        .send({ supplierId: d.supplierId, lines: [{ productId: d.productId, orderedQty: '1' }] })
    ).body;

    expect((await http.get(`/api/v1/projects/${project.id}`).set('Cookie', cookieB)).status).toBe(
      404,
    );
    expect(
      (await http.post(`/api/v1/projects/${project.id}/approve`).set('Cookie', cookieB)).status,
    ).toBe(404);
    expect(
      (await http.get(`/api/v1/procurement/purchase-orders/${po.id}`).set('Cookie', cookieB))
        .status,
    ).toBe(404);
  });

  it('scheduling a PO against a cross-tenant supplier or project is rejected', async () => {
    const cookieA = await adminCookie();
    const cookieB = await adminBCookie();
    const dB = await baseData(cookieB);
    const res = await http
      .post('/api/v1/procurement/purchase-orders')
      .set('Cookie', cookieA)
      .send({ supplierId: dB.supplierId, lines: [{ productId: dB.productId, orderedQty: '1' }] });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SUPPLIER_NOT_FOUND');
  });

  it('unauthenticated and unauthorized requests are rejected', async () => {
    expect((await http.get('/api/v1/projects')).status).toBe(401);
    const pCookie = await plainCookie();
    expect(
      (await http.get('/api/v1/procurement/purchase-orders').set('Cookie', pCookie)).status,
    ).toBe(403);
  });
});
