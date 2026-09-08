import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 13C — persistent CRM lead-list saved views (ADR 0031). Owned per
 * membership: CRUD works, views never leak between users or tenants, and every
 * route is gated by `crm.leads.read`. Direct RLS proof lives in `rls.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)('CRM saved views', () => {
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

  const cookieInA = async (u: { email: string; password: string; membershipId: string }) => {
    const cookie = sessionCookie(await login(u.email, u.password));
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: u.membershipId });
    return cookie;
  };

  it('create → list → update → delete round-trips for the owner', async () => {
    const cookie = await cookieInA(fx.admin);

    const created = await http
      .post('/api/v1/crm/saved-views')
      .set('Cookie', cookie)
      .send({ name: 'Hot leads', config: { status: 'QUALIFIED', board: true } });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      name: 'Hot leads',
      config: { status: 'QUALIFIED', board: true },
    });
    const id = created.body.id as string;

    const list = await http.get('/api/v1/crm/saved-views').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.map((v: { id: string }) => v.id)).toContain(id);

    const updated = await http
      .patch(`/api/v1/crm/saved-views/${id}`)
      .set('Cookie', cookie)
      .send({
        name: 'Hot leads (mine)',
        config: { status: 'QUALIFIED', assignedMembershipId: 'x' },
      });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe('Hot leads (mine)');
    expect(updated.body.config).toEqual({ status: 'QUALIFIED', assignedMembershipId: 'x' });

    const del = await http.delete(`/api/v1/crm/saved-views/${id}`).set('Cookie', cookie);
    expect(del.status).toBe(204);
    const after = await http.get('/api/v1/crm/saved-views').set('Cookie', cookie);
    expect(after.body.map((v: { id: string }) => v.id)).not.toContain(id);
  });

  it('rejects a duplicate name for the same owner', async () => {
    const cookie = await cookieInA(fx.admin);
    await http
      .post('/api/v1/crm/saved-views')
      .set('Cookie', cookie)
      .send({ name: 'Dupe', config: {} })
      .expect(200);
    const again = await http
      .post('/api/v1/crm/saved-views')
      .set('Cookie', cookie)
      .send({ name: 'Dupe', config: {} });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SAVED_VIEW_DUPLICATE_NAME');
  });

  it('views are private to their owner — a second user in the same tenant cannot see or mutate them', async () => {
    const owner = await cookieInA(fx.admin);
    const other = await cookieInA(fx.secondAdmin);

    const mine = await http
      .post('/api/v1/crm/saved-views')
      .set('Cookie', owner)
      .send({ name: `Private ${Date.now()}`, config: { status: 'NEW' } });
    const id = mine.body.id as string;

    const otherList = await http.get('/api/v1/crm/saved-views').set('Cookie', other);
    expect(otherList.body.map((v: { id: string }) => v.id)).not.toContain(id);

    expect(
      (await http.patch(`/api/v1/crm/saved-views/${id}`).set('Cookie', other).send({ name: 'x' }))
        .status,
    ).toBe(404);
    expect((await http.delete(`/api/v1/crm/saved-views/${id}`).set('Cookie', other)).status).toBe(
      404,
    );

    // …and it is still there for the owner
    const ownerList = await http.get('/api/v1/crm/saved-views').set('Cookie', owner);
    expect(ownerList.body.map((v: { id: string }) => v.id)).toContain(id);
  });

  it('views never cross tenants', async () => {
    const inA = await cookieInA(fx.admin);
    const inB = sessionCookie(await login(fx.adminB.email, fx.adminB.password)); // single membership → tenant B

    const aView = await http
      .post('/api/v1/crm/saved-views')
      .set('Cookie', inA)
      .send({ name: `Cross ${Date.now()}`, config: {} });
    const id = aView.body.id as string;

    const bList = await http.get('/api/v1/crm/saved-views').set('Cookie', inB);
    expect(bList.status).toBe(200);
    expect(bList.body.map((v: { id: string }) => v.id)).not.toContain(id);
    expect((await http.get(`/api/v1/crm/saved-views`).set('Cookie', inB)).body).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ id })]),
    );
  });

  it('requires crm.leads.read — a member without it is denied', async () => {
    // fx.limited holds only memberships.read in A
    const cookie = await cookieInA({ ...fx.limited, membershipId: fx.limited.membershipId });
    const res = await http.get('/api/v1/crm/saved-views').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('AUTH_FORBIDDEN');
  });
});
