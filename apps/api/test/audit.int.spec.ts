import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, schema, withTenantContext } from '@aivoryx/db';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';
import { AuditService } from '../src/audit/audit.service.js';

/**
 * Phase 11 — Global Audit Log (ADR 0040). Proves: audit rows are written inside
 * the business mutation's own transaction; a failing audit write rolls the
 * mutation back; the read API is `audit.read`-gated, tenant-isolated, filtered
 * and paginated; there is no create/update/delete API; secrets never surface.
 * Direct PostgreSQL RLS + append-only proof is in `rls.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)('Global Audit Log', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;
  let audit: AuditService;

  beforeAll(async () => {
    fx = await makeFixtures();
    app = await bootTestApp();
    http = request(app.getHttpServer());
    audit = app.get(AuditService);
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

  // ---- transactional guarantee ------------------------------------

  it('writes the audit row in the SAME transaction as the mutation', async () => {
    const scope = {
      tenantId: fx.tenantA,
      userId: fx.admin.userId,
      actorMembershipId: fx.admin.membershipId,
    };
    const custId = crypto.randomUUID();
    await withTenantContext(getDb(), scope, async (tx) => {
      await tx.insert(schema.customers).values({
        id: custId,
        tenantId: fx.tenantA,
        number: `CUST-AUD-${Date.now()}`,
        name: 'Atomic Co',
        createdByMembershipId: fx.admin.membershipId,
      });
      await audit.record(tx, {
        tenantId: fx.tenantA,
        action: 'customer.created',
        entityType: 'customer',
        entityId: custId,
        actor: { type: 'USER', membershipId: fx.admin.membershipId },
      });
    });

    const pool = await rawPool();
    const cust = await pool.query('select id from customers where id=$1', [custId]);
    const log = await pool.query('select id from audit_logs where entity_id=$1', [custId]);
    await pool.end();
    expect(cust.rows).toHaveLength(1);
    expect(log.rows).toHaveLength(1);
  });

  it('rolls the mutation back when the audit write fails', async () => {
    const scope = {
      tenantId: fx.tenantA,
      userId: fx.admin.userId,
      actorMembershipId: fx.admin.membershipId,
    };
    const custId = crypto.randomUUID();
    await expect(
      withTenantContext(getDb(), scope, async (tx) => {
        await tx.insert(schema.customers).values({
          id: custId,
          tenantId: fx.tenantA,
          number: `CUST-ROLL-${Date.now()}`,
          name: 'Rollback Co',
          createdByMembershipId: fx.admin.membershipId,
        });
        // actor membership belongs to tenant B -> composite FK violation
        await audit.record(tx, {
          tenantId: fx.tenantA,
          action: 'customer.created',
          entityType: 'customer',
          entityId: custId,
          actor: { type: 'USER', membershipId: fx.adminB.membershipId },
        });
      }),
    ).rejects.toBeTruthy();

    const pool = await rawPool();
    const cust = await pool.query('select id from customers where id=$1', [custId]);
    await pool.end();
    expect(
      cust.rows,
      'the customer insert must have rolled back with the failed audit',
    ).toHaveLength(0);
  });

  // ---- read API ------------------------------------------------

  it('is gated by audit.read', async () => {
    const res = await http.get('/api/v1/admin/audit').set('Cookie', await plainCookie());
    expect(res.status).toBe(403);
  });

  it('exposes no create / update / delete route', async () => {
    const cookie = await adminCookie();
    for (const m of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await http[m]('/api/v1/admin/audit').set('Cookie', cookie).send({});
      expect([403, 404, 405]).toContain(res.status);
    }
  });

  it('an admin action shows up, correctly attributed, and is filterable', async () => {
    const cookie = await adminCookie();
    // a real audited mutation via the API
    const patch = await http
      .patch('/api/v1/admin/tenant')
      .set('Cookie', cookie)
      .send({ name: `Audit E2E ${Date.now()}` });
    expect(patch.status).toBe(200);

    const list = await http
      .get('/api/v1/admin/audit?action=tenant.updated&pageSize=5')
      .set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    const entry = list.body.items[0];
    expect(entry.action).toBe('tenant.updated');
    expect(entry.module).toBe('identity');
    expect(entry.actorType).toBe('USER');
    expect(entry.actorMembershipId).toBe(fx.admin.membershipId);
    expect(entry.actorEmail).toBe(fx.admin.email);
    expect(entry.correlationId).toBeTruthy();

    const detail = await http.get(`/api/v1/admin/audit/${entry.id}`).set('Cookie', cookie);
    expect(detail.status).toBe(200);
    expect(detail.body.changes?.name).toBeTruthy();
    expect(detail.body.metadata).toBeDefined();
    // request context captured
    expect(detail.body).toHaveProperty('ipAddress');
    expect(detail.body).toHaveProperty('userAgent');
  });

  it('paginates and never returns another tenant’s rows', async () => {
    const aCookie = await adminCookie();
    const bCookie = await adminBCookie();

    // generate a distinct action in tenant A
    await http
      .patch('/api/v1/admin/tenant')
      .set('Cookie', aCookie)
      .send({ name: `A-only ${Date.now()}` });

    const p1 = await http.get('/api/v1/admin/audit?page=1&pageSize=2').set('Cookie', aCookie);
    expect(p1.body.items.length).toBeLessThanOrEqual(2);
    expect(p1.body.page).toBe(1);
    expect(p1.body.pageSize).toBe(2);

    const bList = await http.get('/api/v1/admin/audit?pageSize=100').set('Cookie', bCookie);
    // every row B sees belongs to B's admin membership or a B system actor
    for (const row of bList.body.items) {
      if (row.actorMembershipId) expect(row.actorMembershipId).not.toBe(fx.admin.membershipId);
    }
  });

  it('cannot fetch an audit entry that belongs to another tenant', async () => {
    const aCookie = await adminCookie();
    const aRow = await http.get('/api/v1/admin/audit?pageSize=1').set('Cookie', aCookie);
    const id = aRow.body.items[0]?.id;
    expect(id).toBeTruthy();

    const bCookie = await adminBCookie();
    const res = await http.get(`/api/v1/admin/audit/${id}`).set('Cookie', bCookie);
    expect(res.status).toBe(404);
  });

  it('never stores a secret in metadata even if a caller passes one', async () => {
    const scope = {
      tenantId: fx.tenantA,
      userId: fx.admin.userId,
      actorMembershipId: fx.admin.membershipId,
    };
    await withTenantContext(getDb(), scope, (tx) =>
      audit.record(tx, {
        tenantId: fx.tenantA,
        action: 'integration.source.secret_rotated',
        entityType: 'lead_source',
        entityId: crypto.randomUUID(),
        actor: { type: 'USER', membershipId: fx.admin.membershipId },
        metadata: { secret: 'super-secret-value', apiKey: 'AKIA...', ok: 'kept' } as Record<
          string,
          unknown
        >,
      }),
    );
    const pool = await rawPool();
    const row = await pool.query(
      `select metadata from audit_logs where action='integration.source.secret_rotated'
       and tenant_id=$1 order by occurred_at desc limit 1`,
      [fx.tenantA],
    );
    await pool.end();
    const md = row.rows[0]?.metadata as Record<string, unknown>;
    expect(md.secret).toBe('[redacted]');
    expect(md.apiKey).toBe('[redacted]');
    expect(md.ok).toBe('kept');
    expect(JSON.stringify(md)).not.toContain('super-secret-value');
  });

  it('a SYSTEM actor row is stored with a source and no membership', async () => {
    const { withSystemAuditActor } = await import('../src/audit/system-actor.js');
    await withSystemAuditActor('scheduled-job', async () => {
      await withTenantContext(getDb(), { tenantId: fx.tenantA, userId: fx.admin.userId }, (tx) =>
        audit.record(tx, {
          tenantId: fx.tenantA,
          action: 'finance.invoice.issued',
          entityType: 'invoice',
          entityId: crypto.randomUUID(),
        }),
      );
    });
    const pool = await rawPool();
    const row = await pool.query(
      `select actor_type, actor_source, actor_membership_id from audit_logs
       where tenant_id=$1 and actor_type='SYSTEM' order by occurred_at desc limit 1`,
      [fx.tenantA],
    );
    await pool.end();
    expect(row.rows[0]?.actor_type).toBe('SYSTEM');
    expect(row.rows[0]?.actor_source).toBe('scheduled-job');
    expect(row.rows[0]?.actor_membership_id).toBeNull();
  });
});
