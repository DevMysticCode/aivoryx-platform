/**
 * Phase 8 demo/seed data — a small notification configuration for the
 * `clans-demo` tenant, layered on the existing demos. Synthetic content only;
 * idempotent (natural-key upserts). Production behaviour never depends on this.
 *
 * Usage: `pnpm --filter @aivoryx/api exec tsx scripts/seed-notifications-demo.ts`
 * Requires `pnpm db:migrate` + `seed:supply-demo` (for the tenant + admin).
 *
 * It:
 *   - narrows the "quotation sent" customer rule to email only (already the
 *     default) and disables the noisy "purchase order approved" rule
 *   - overrides the `lead_created` template wording
 *   - sets a sample preference row for the demo admin (all channels on)
 *   - emits one `lead.created` outbox event so the bell has something to show
 *     once the worker drains it
 */
import { randomUUID } from 'node:crypto';
import { createDb, seedPermissions } from '@aivoryx/db';

async function main(): Promise<void> {
  const handle = createDb({ poolMax: 2 });
  const c = await handle.pool.connect();
  try {
    await seedPermissions(handle);

    const tenantId = (
      await c.query<{ id: string }>(`select id from tenants where slug = 'clans-demo'`)
    ).rows[0]?.id;
    if (!tenantId) throw new Error('run seed:supply-demo first (clans-demo tenant missing)');

    const adminMembershipId = (
      await c.query<{ id: string }>(
        `select m.id from user_tenant_memberships m
           join users u on u.id = m.user_id
          where m.tenant_id = $1 and u.email = 'admin@clans-demo.test'`,
        [tenantId],
      )
    ).rows[0]?.id;
    if (!adminMembershipId) throw new Error('admin membership missing');

    // 1. a disabled rule (demonstrates the toggle)
    await c.query(
      `insert into notification_rules (id, tenant_id, key, event_type, is_active, updated_by_membership_id)
       values ($1,$2,'purchase_order_approved.admins','purchase_order.approved', false, $3)
       on conflict (tenant_id, key) do update set is_active = excluded.is_active`,
      [randomUUID(), tenantId, adminMembershipId],
    );

    // 2. a template override (demonstrates tenant wording)
    for (const [channel, emailSubject, emailBody] of [
      ['in_app', null, null],
      ['email', 'New enquiry: {{lead.name}}', 'A new enquiry from {{lead.source}} just came in.'],
    ] as const) {
      await c.query(
        `insert into notification_templates
           (id, tenant_id, key, channel, title, body, email_subject, email_body, is_active, updated_by_membership_id)
         values ($1,$2,'lead_created',$3,'New enquiry — {{lead.name}}','via {{lead.source}}',$4,$5,true,$6)
         on conflict (tenant_id, key, channel) do update
           set title = excluded.title, body = excluded.body,
               email_subject = excluded.email_subject, email_body = excluded.email_body`,
        [randomUUID(), tenantId, channel, emailSubject, emailBody, adminMembershipId],
      );
    }

    // 3. a sample preference row (all channels on)
    await c.query(
      `insert into notification_preferences (id, tenant_id, membership_id, in_app_enabled, email_enabled)
       values ($1,$2,$3,true,true)
       on conflict (tenant_id, membership_id) do nothing`,
      [randomUUID(), tenantId, adminMembershipId],
    );

    // 4. one lead + a lead.created event so the bell shows something (only once)
    const existing = (
      await c.query<{ id: string }>(
        `select id from leads where tenant_id = $1 and name = 'Demo Enquiry (Noticeboard)' limit 1`,
        [tenantId],
      )
    ).rows[0]?.id;
    const leadId =
      existing ??
      (
        await c.query<{ id: string }>(
          `insert into leads (id, tenant_id, name, phone, normalized_phone, origin, status)
           values ($1,$2,'Demo Enquiry (Noticeboard)','9990001111','9990001111','manual','NEW')
           returning id`,
          [randomUUID(), tenantId],
        )
      ).rows[0]?.id;
    if (leadId && !existing) {
      await c.query(
        `insert into outbox_events (id, tenant_id, type, payload)
         values ($1,$2,'lead.created',$3::jsonb)`,
        [randomUUID(), tenantId, JSON.stringify({ leadId })],
      );
    }

    console.warn('[seed-notifications-demo] tenant: clans-demo');
    console.warn('[seed-notifications-demo] admin login: admin@clans-demo.test / Demo-Passw0rd!');
    console.warn(
      '[seed-notifications-demo] 1 rule disabled, lead_created template overridden, 1 lead.created event queued for the bell',
    );
  } finally {
    c.release();
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-notifications-demo] failed:', err);
  process.exit(1);
});
