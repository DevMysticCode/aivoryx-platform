import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';
import { OutboxDispatcherService } from '../src/notifications/outbox-dispatcher.service.js';
import { NotificationDeliveryService } from '../src/notifications/notification-delivery.service.js';
import { NotificationEngineService } from '../src/notifications/notification-engine.service.js';
import { FakeEmailProvider } from '../src/notifications/email/fake-email-provider.js';

/**
 * Phase 8 — Notifications & Communications Engine (ADR 0037).
 *
 * Drives the real dispatcher -> engine -> recipient resolution -> template ->
 * channel adapter -> delivery-record pipeline (the background worker/queue is
 * off in this env; the Playwright E2E exercises the live queue). The fake email
 * provider captures mail — no real email is ever sent.
 */
describe.skipIf(!INTEGRATION_ENABLED)('Notifications engine', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;
  let pool: Pool;
  let dispatcher: OutboxDispatcherService;
  let delivery: NotificationDeliveryService;
  let engine: NotificationEngineService;
  let fakeEmail: FakeEmailProvider;

  beforeAll(async () => {
    fx = await makeFixtures();
    app = await bootTestApp();
    http = request(app.getHttpServer());
    pool = await rawPool();
    dispatcher = app.get(OutboxDispatcherService);
    delivery = app.get(NotificationDeliveryService);
    engine = app.get(NotificationEngineService);
    fakeEmail = app.get(FakeEmailProvider);
    fakeEmail.reset();
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

  /** Insert an outbox event exactly as a business module would. */
  async function emitEvent(
    tenantId: string,
    type: string,
    payload: Record<string, unknown>,
    actorMembershipId: string | null = null,
  ): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `insert into outbox_events (id, tenant_id, type, payload, actor_membership_id)
       values (gen_random_uuid(), $1, $2, $3::jsonb, $4) returning id`,
      [tenantId, type, JSON.stringify(payload), actorMembershipId],
    );
    return rows[0]!.id;
  }

  /** Drain the whole outbox - other suites leave undispatched events behind. */
  async function drainAll(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if ((await dispatcher.drain(200)) === 0) break;
    }
  }

  /** Drain the whole outbox, then run every resulting pending delivery. */
  async function runNotifications(): Promise<void> {
    await drainAll();
    const { rows } = await pool.query<{ id: string; tenant_id: string }>(
      `select id, tenant_id from notification_deliveries where status in ('pending','processing')`,
    );
    for (const row of rows) {
      await delivery.process(row.id, row.tenant_id).catch(() => undefined);
    }
  }

  async function makeLead(cookie: string, name: string): Promise<string> {
    const res = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({ name, phone: `9${Math.floor(Math.random() * 1e9)}`.slice(0, 10) });
    expect(res.status).toBe(200);
    return res.body.id as string;
  }

  it('a business event creates an in-app notification for a ROLE recipient', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie, 'Notify Lead A');
    await emitEvent(fx.tenantA, 'lead.created', { leadId });

    await runNotifications();

    const list = await http.get('/api/v1/notifications').set('Cookie', cookie);
    expect(list.status).toBe(200);
    const found = list.body.items.find(
      (n: { sourceEventType: string; title: string }) => n.sourceEventType === 'lead.created',
    );
    expect(found).toBeTruthy();
    expect(found.title).toContain('Notify Lead A');
    expect(found.read).toBe(false);
    expect(list.body.unread).toBeGreaterThan(0);

    const deliveries = await pool.query(
      `select d.channel, d.status from notification_deliveries d
         join notifications n on n.id = d.notification_id
        where n.tenant_id = $1 and n.source_event_type = 'lead.created'`,
      [fx.tenantA],
    );
    expect(deliveries.rows).toContainEqual({ channel: 'in_app', status: 'sent' });
  });

  it('the mark-read + mark-all-read + unread-count endpoints are self-scoped', async () => {
    const cookie = await adminCookie();
    const before = await http.get('/api/v1/notifications/unread-count').set('Cookie', cookie);
    expect(before.body.unread).toBeGreaterThan(0);

    const list = await http.get('/api/v1/notifications?unreadOnly=true').set('Cookie', cookie);
    const first = list.body.items[0];
    const readOne = await http.post(`/api/v1/notifications/${first.id}/read`).set('Cookie', cookie);
    expect(readOne.status).toBe(200);
    expect(readOne.body.unread).toBe(before.body.unread - 1);

    const all = await http.post('/api/v1/notifications/read-all').set('Cookie', cookie);
    expect(all.status).toBe(200);
    const after = await http.get('/api/v1/notifications/unread-count').set('Cookie', cookie);
    expect(after.body.unread).toBe(0);
  });

  it('emails an external customer via the fake provider without touching business state', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie, 'Email Customer');
    // a real customer row linked to the lead, with a capturable address
    await pool.query(
      `insert into customers (id, tenant_id, number, name, email, normalized_email, lead_id, created_by_membership_id)
       values (gen_random_uuid(), $1, $2, 'Email Customer', 'buyer@example.test', 'buyer@example.test', $3, $4)`,
      [fx.tenantA, `CUST-${Date.now()}`, leadId, fx.admin.membershipId],
    );
    const q = await pool.query<{ id: string; number: string }>(
      `insert into quotations (id, tenant_id, number, lead_id, status, current_revision_no, created_by_membership_id)
       values (gen_random_uuid(), $1, $2, $3, 'SENT', 1, $4) returning id, number`,
      [fx.tenantA, `Q-${Date.now()}`, leadId, fx.admin.membershipId],
    );
    await pool.query(
      `insert into quotation_revisions (id, tenant_id, quotation_id, revision_no, status, subtotal, discount_total, tax_total, total, created_by_membership_id)
       values (gen_random_uuid(), $1, $2, 1, 'sent', '100000', '0', '18000', '118000', $3)`,
      [fx.tenantA, q.rows[0]!.id, fx.admin.membershipId],
    );

    fakeEmail.reset();
    await emitEvent(
      fx.tenantA,
      'quotation.sent',
      { quotationId: q.rows[0]!.id },
      fx.admin.membershipId,
    );
    await runNotifications();

    expect(fakeEmail.sent).toHaveLength(1);
    expect(fakeEmail.sent[0]!.to).toBe('buyer@example.test');
    expect(fakeEmail.sent[0]!.subject).toContain(q.rows[0]!.number);
    expect(fakeEmail.sent[0]!.html).not.toContain('<script');

    const emailDelivery = await pool.query(
      `select status, provider, provider_message_id from notification_deliveries
        where tenant_id = $1 and channel = 'email' order by created_at desc limit 1`,
      [fx.tenantA],
    );
    expect(emailDelivery.rows[0]!.status).toBe('sent');
    expect(emailDelivery.rows[0]!.provider).toBe('fake');
    expect(emailDelivery.rows[0]!.provider_message_id).toBeTruthy();

    // business state untouched
    const quote = await pool.query(`select status from quotations where id = $1`, [q.rows[0]!.id]);
    expect(quote.rows[0]!.status).toBe('SENT');
  });

  it('a duplicate/replayed event produces exactly one notification and one delivery per channel', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie, 'Replay Lead');
    const eventId = await emitEvent(fx.tenantA, 'lead.created', { leadId });

    const event = {
      id: eventId,
      type: 'lead.created',
      tenantId: fx.tenantA,
      payload: { leadId },
      actorMembershipId: null,
    };
    const countRows = async () => {
      const notifs = await pool.query<{ n: number }>(
        `select count(*)::int as n from notifications where tenant_id = $1 and source_event_id = $2`,
        [fx.tenantA, eventId],
      );
      const dels = await pool.query<{ n: number }>(
        `select count(*)::int as n from notification_deliveries d
           join notifications n on n.id = d.notification_id
          where n.tenant_id = $1 and n.source_event_id = $2 and d.channel = 'in_app'`,
        [fx.tenantA, eventId],
      );
      return { notifs: notifs.rows[0]!.n, dels: dels.rows[0]!.n };
    };

    await engine.handleEvent(event);
    const first = await countRows();
    await engine.handleEvent(event); // worker retry / outbox replay
    const second = await countRows();

    // one notification + one in_app delivery per recipient — and replay adds nothing
    expect(first.notifs).toBeGreaterThan(0);
    expect(first.dels).toBe(first.notifs);
    expect(second).toEqual(first);
  });

  it('retries a transient provider failure, then succeeds', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie, 'Retry Customer');
    await pool.query(
      `insert into customers (id, tenant_id, number, name, email, normalized_email, lead_id, created_by_membership_id)
       values (gen_random_uuid(), $1, $2, 'Retry Customer', 'fail-once@example.test', 'fail-once@example.test', $3, $4)`,
      [fx.tenantA, `CUST-${Date.now()}-r`, leadId, fx.admin.membershipId],
    );
    const q = await pool.query<{ id: string }>(
      `insert into quotations (id, tenant_id, number, lead_id, status, current_revision_no, created_by_membership_id)
       values (gen_random_uuid(), $1, $2, $3, 'SENT', 1, $4) returning id`,
      [fx.tenantA, `Q-${Date.now()}-r`, leadId, fx.admin.membershipId],
    );
    await pool.query(
      `insert into quotation_revisions (id, tenant_id, quotation_id, revision_no, status, subtotal, discount_total, tax_total, total, created_by_membership_id)
       values (gen_random_uuid(), $1, $2, 1, 'sent', '1', '0', '0', '1', $3)`,
      [fx.tenantA, q.rows[0]!.id, fx.admin.membershipId],
    );
    await emitEvent(fx.tenantA, 'quotation.sent', { quotationId: q.rows[0]!.id });
    await drainAll();

    const [d] = (
      await pool.query<{ id: string; tenant_id: string }>(
        `select id, tenant_id from notification_deliveries where tenant_id = $1 and channel = 'email' and recipient_ref = 'fail-once@example.test'`,
        [fx.tenantA],
      )
    ).rows;

    await expect(delivery.process(d!.id, d!.tenant_id)).rejects.toThrow(); // attempt 1 (transient)
    let row = await pool.query(
      `select status, attempts from notification_deliveries where id = $1`,
      [d!.id],
    );
    expect(row.rows[0]!.status).toBe('pending');
    expect(row.rows[0]!.attempts).toBe(1);

    await delivery.process(d!.id, d!.tenant_id); // attempt 2 succeeds
    row = await pool.query(`select status from notification_deliveries where id = $1`, [d!.id]);
    expect(row.rows[0]!.status).toBe('sent');
  });

  it('marks a permanent provider failure FAILED without retrying', async () => {
    const cookie = await adminCookie();
    const leadId = await makeLead(cookie, 'Bounce Customer');
    await pool.query(
      `insert into customers (id, tenant_id, number, name, email, normalized_email, lead_id, created_by_membership_id)
       values (gen_random_uuid(), $1, $2, 'Bounce Customer', 'bounce@example.test', 'bounce@example.test', $3, $4)`,
      [fx.tenantA, `CUST-${Date.now()}-b`, leadId, fx.admin.membershipId],
    );
    const q = await pool.query<{ id: string }>(
      `insert into quotations (id, tenant_id, number, lead_id, status, current_revision_no, created_by_membership_id)
       values (gen_random_uuid(), $1, $2, $3, 'SENT', 1, $4) returning id`,
      [fx.tenantA, `Q-${Date.now()}-b`, leadId, fx.admin.membershipId],
    );
    await pool.query(
      `insert into quotation_revisions (id, tenant_id, quotation_id, revision_no, status, subtotal, discount_total, tax_total, total, created_by_membership_id)
       values (gen_random_uuid(), $1, $2, 1, 'sent', '1', '0', '0', '1', $3)`,
      [fx.tenantA, q.rows[0]!.id, fx.admin.membershipId],
    );
    await emitEvent(fx.tenantA, 'quotation.sent', { quotationId: q.rows[0]!.id });
    await drainAll();
    const [d] = (
      await pool.query<{ id: string; tenant_id: string }>(
        `select id, tenant_id from notification_deliveries where tenant_id = $1 and recipient_ref = 'bounce@example.test'`,
        [fx.tenantA],
      )
    ).rows;

    await delivery.process(d!.id, d!.tenant_id); // permanent -> no throw
    const row = await pool.query(
      `select status, failure_code, attempts from notification_deliveries where id = $1`,
      [d!.id],
    );
    expect(row.rows[0]!.status).toBe('failed');
    expect(row.rows[0]!.failure_code).toBe('EMAIL_BOUNCED');
    expect(row.rows[0]!.attempts).toBe(1);
  });

  it('respects a recipient email opt-out (suppressible rule)', async () => {
    const cookie = await adminCookie();
    // admin opts out of email
    await http
      .put('/api/v1/notifications/preferences')
      .set('Cookie', cookie)
      .send({ inAppEnabled: true, emailEnabled: false });

    const leadId = await makeLead(cookie, 'Assigned Install');
    // installation.assigned -> ASSIGNED_USER (admin) on in_app + email
    const projectRes = await pool.query<{ id: string }>(
      `insert into projects (id, tenant_id, number, lead_id, status, created_by_membership_id)
       values (gen_random_uuid(), $1, $2, $3, 'IN_PROGRESS', $4) returning id`,
      [fx.tenantA, `PRJ-${Date.now()}`, leadId, fx.admin.membershipId],
    );
    await pool.query(
      `insert into project_installations (id, tenant_id, project_id, status, assigned_membership_id, created_by_membership_id)
       values (gen_random_uuid(), $1, $2, 'ASSIGNED', $3, $3)`,
      [fx.tenantA, projectRes.rows[0]!.id, fx.admin.membershipId],
    );
    await emitEvent(
      fx.tenantA,
      'installation.assigned',
      { projectId: projectRes.rows[0]!.id, membershipId: fx.admin.membershipId },
      fx.admin.membershipId,
    );
    await runNotifications();

    const rows = await pool.query(
      `select d.channel, d.status, d.failure_code from notification_deliveries d
         join notifications n on n.id = d.notification_id
        where n.tenant_id = $1 and n.source_event_type = 'installation.assigned'`,
      [fx.tenantA],
    );
    const email = rows.rows.find((r: { channel: string }) => r.channel === 'email');
    const inApp = rows.rows.find((r: { channel: string }) => r.channel === 'in_app');
    expect(email.status).toBe('cancelled');
    expect(email.failure_code).toBe('SUPPRESSED_BY_PREFERENCE');
    expect(inApp.status).toBe('sent');

    // restore
    await http
      .put('/api/v1/notifications/preferences')
      .set('Cookie', cookie)
      .send({ inAppEnabled: true, emailEnabled: true });
  });

  it('never leaks notifications across tenants', async () => {
    const cookieA = await adminCookie();
    const cookieB = await cookieFor(fx.adminB.email, fx.adminB.password, fx.adminB.membershipId);
    const leadId = await makeLead(cookieA, 'Tenant A only');
    await emitEvent(fx.tenantA, 'lead.created', { leadId });
    await runNotifications();

    const listB = await http.get('/api/v1/notifications').set('Cookie', cookieB);
    expect(listB.status).toBe(200);
    expect(listB.body.items.some((n: { title: string }) => n.title.includes('Tenant A only'))).toBe(
      false,
    );

    // and RLS blocks a direct cross-tenant read by the app role
    const crossTenant = await pool.query(
      `select count(*)::int as n from notifications where tenant_id = $1`,
      [fx.tenantB],
    );
    // pool is the owner/superuser (bypasses RLS) — this just confirms tenant B has none of A's rows
    const aRows = await pool.query(
      `select count(*)::int as n from notifications where tenant_id = $1 and title like '%Tenant A only%'`,
      [fx.tenantA],
    );
    expect(aRows.rows[0]!.n).toBeGreaterThan(0);
    expect(crossTenant.rows[0]!.n).toBe(0);
  });

  it('enforces permissions on the admin configuration API', async () => {
    const adminC = await adminCookie();
    const plain = await cookieFor(
      fx.plainMember.email,
      fx.plainMember.password,
      fx.plainMember.membershipId,
    );

    expect((await http.get('/api/v1/admin/notifications/rules').set('Cookie', adminC)).status).toBe(
      200,
    );
    expect((await http.get('/api/v1/admin/notifications/rules').set('Cookie', plain)).status).toBe(
      403,
    );

    // toggle a rule off, then on
    const off = await http
      .patch('/api/v1/admin/notifications/rules/lead_created.admins')
      .set('Cookie', adminC)
      .send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.find((r: { key: string }) => r.key === 'lead_created.admins').isActive).toBe(
      false,
    );
    expect(off.body.find((r: { key: string }) => r.key === 'lead_created.admins').overridden).toBe(
      true,
    );

    // an unknown rule key is rejected
    const bad = await http
      .patch('/api/v1/admin/notifications/rules/not_a_rule')
      .set('Cookie', adminC)
      .send({ isActive: false });
    expect(bad.status).toBe(404);
    expect(bad.body.error.code).toBe('NOTIFICATION_RULE_NOT_FOUND');

    // restore
    await http
      .patch('/api/v1/admin/notifications/rules/lead_created.admins')
      .set('Cookie', adminC)
      .send({ isActive: true });
  });

  it('a disabled rule produces no notification', async () => {
    const cookie = await adminCookie();
    await http
      .patch('/api/v1/admin/notifications/rules/lead_created.admins')
      .set('Cookie', cookie)
      .send({ isActive: false });

    const leadId = await makeLead(cookie, 'Silent Lead');
    const eventId = await emitEvent(fx.tenantA, 'lead.created', { leadId });
    await runNotifications();

    const n = await pool.query(
      `select count(*)::int as n from notifications where source_event_id = $1`,
      [eventId],
    );
    expect(n.rows[0]!.n).toBe(0);

    await http
      .patch('/api/v1/admin/notifications/rules/lead_created.admins')
      .set('Cookie', cookie)
      .send({ isActive: true });
  });

  it('a tenant template override changes the rendered notification', async () => {
    const cookie = await adminCookie();
    await http
      .put('/api/v1/admin/notifications/templates/lead_created')
      .set('Cookie', cookie)
      .send({
        title: 'LEAD {{lead.name}} IN',
        body: 'from {{lead.source}}',
        emailSubject: 'x',
        emailBody: 'y',
      });

    const leadId = await makeLead(cookie, 'Templated Lead');
    await emitEvent(fx.tenantA, 'lead.created', { leadId });
    await runNotifications();

    const list = await http.get('/api/v1/notifications').set('Cookie', cookie);
    expect(
      list.body.items.some((x: { title: string }) => x.title === 'LEAD Templated Lead IN'),
    ).toBe(true);

    const reset = await http
      .delete('/api/v1/admin/notifications/templates/lead_created')
      .set('Cookie', cookie);
    expect(reset.status).toBe(200);
    expect(reset.body.overridden).toBe(false);
  });

  it('rejects an unauthenticated caller', async () => {
    expect((await http.get('/api/v1/notifications')).status).toBe(401);
    expect((await http.get('/api/v1/admin/notifications/rules')).status).toBe(401);
  });
});
