/**
 * Phase 6 demo/seed data — a Clans-flavored quotation → booking scenario
 * layered onto the same `clans-demo` tenant as the Phase 4/5 seeds. Synthetic
 * demo content only; safe to run repeatedly (idempotent upserts keyed on
 * tenant-scoped numbers).
 *
 * Usage: `pnpm --filter @aivoryx/api exec tsx scripts/seed-commercial-demo.ts`
 * Requires `pnpm db:migrate` + `seedPermissions` to have run.
 *
 * It seeds: a customer promoted from a lead, one DRAFT quotation with product
 * and service lines, one quotation with two revisions (the first frozen), and
 * one fully BOOKED quotation whose booking has activated a project. The
 * create → send → accept → book flow is exercised by the Playwright golden
 * path and by hand in the UI.
 */
import { randomUUID } from 'node:crypto';
import { hash as argon2Hash } from '@node-rs/argon2';
import { createDb, newUuidV7, provisionTenantAdmin, seedPermissions } from '@aivoryx/db';
import type { PoolClient } from 'pg';
import { lineAmounts, quoteTotals, type QuoteLineInput } from '../src/commercial/money.js';

const ARGON2ID = 2;

interface DemoLine extends QuoteLineInput {
  description: string;
  productSku?: string;
  unitLabel?: string;
}

async function upsertLead(
  c: PoolClient,
  tenantId: string,
  name: string,
  phone: string,
  status = 'QUALIFIED',
): Promise<string> {
  const existing = await c.query<{ id: string }>(
    `select id from leads where tenant_id = $1 and normalized_phone = $2 limit 1`,
    [tenantId, phone],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const id = newUuidV7();
  await c.query(
    `insert into leads (id, tenant_id, name, phone, normalized_phone, city, state, status, origin)
     values ($1,$2,$3,$4,$4,'Pune','MH',$5,'manual')`,
    [id, tenantId, name, phone, status],
  );
  return id;
}

async function writeRevisionLines(
  c: PoolClient,
  tenantId: string,
  revisionId: string,
  productBySku: Map<string, string>,
  lines: DemoLine[],
): Promise<void> {
  await c.query(`delete from quotation_lines where tenant_id = $1 and revision_id = $2`, [
    tenantId,
    revisionId,
  ]);
  for (const [i, l] of lines.entries()) {
    const amt = lineAmounts(l);
    await c.query(
      `insert into quotation_lines
        (id, tenant_id, revision_id, line_no, product_id, description, unit_label,
         quantity, unit_price, discount, tax_rate, line_net, line_tax, line_total)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        newUuidV7(),
        tenantId,
        revisionId,
        i + 1,
        l.productSku ? (productBySku.get(l.productSku) ?? null) : null,
        l.description,
        l.unitLabel ?? null,
        l.quantity,
        l.unitPrice,
        l.discount,
        l.taxRate,
        amt.lineNet,
        amt.lineTax,
        amt.lineTotal,
      ],
    );
  }
  const totals = quoteTotals(lines);
  await c.query(
    `update quotation_revisions
       set subtotal = $2, discount_total = $3, tax_total = $4, total = $5, updated_at = now()
     where id = $1`,
    [revisionId, totals.subtotal, totals.discountTotal, totals.taxTotal, totals.total],
  );
}

async function main(): Promise<void> {
  const handle = createDb({ poolMax: 3 });
  const c = await handle.pool.connect();
  try {
    await seedPermissions(handle);

    await c.query(
      `insert into tenants (id, slug, name) values ($1, 'clans-demo', 'Clans Solar (Demo)')
       on conflict (slug) do update set name = excluded.name`,
      [newUuidV7()],
    );
    const tenantId = (
      await c.query<{ id: string }>(`select id from tenants where slug = 'clans-demo'`)
    ).rows[0]!.id;

    const adminHash = await argon2Hash('Demo-Passw0rd!', { algorithm: ARGON2ID });
    await c.query(
      `insert into users (id, email, name, password_hash, password_updated_at)
       values ($1, 'admin@clans-demo.test', 'Clans Admin', $2, now())
       on conflict (lower(email)) do update set name = excluded.name`,
      [newUuidV7(), adminHash],
    );
    const adminUserId = (
      await c.query<{ id: string }>(`select id from users where email = 'admin@clans-demo.test'`)
    ).rows[0]!.id;
    let mRows = await c.query<{ id: string }>(
      `select id from user_tenant_memberships where user_id = $1 and tenant_id = $2`,
      [adminUserId, tenantId],
    );
    if (!mRows.rows[0]) {
      await c.query(
        `insert into user_tenant_memberships (id, user_id, tenant_id, status) values ($1,$2,$3,'active')`,
        [newUuidV7(), adminUserId, tenantId],
      );
      mRows = await c.query(
        `select id from user_tenant_memberships where user_id = $1 and tenant_id = $2`,
        [adminUserId, tenantId],
      );
    }
    const adminMembershipId = mRows.rows[0]!.id;
    await provisionTenantAdmin(handle, {
      tenantId,
      actingUserId: adminUserId,
      membershipId: adminMembershipId,
    });

    // products from the Phase 5 seed, if present — otherwise fall back to a unit + product
    const productBySku = new Map<string, string>();
    for (const r of (
      await c.query<{ id: string; sku: string }>(
        `select id, sku from products where tenant_id = $1`,
        [tenantId],
      )
    ).rows) {
      productBySku.set(r.sku, r.id);
    }
    if (productBySku.size === 0) {
      await c.query(
        `insert into units (id, tenant_id, code, name) values ($1,$2,'PCS','Pieces')
         on conflict (tenant_id, code) do nothing`,
        [newUuidV7(), tenantId],
      );
      const unitId = (
        await c.query<{ id: string }>(
          `select id from units where tenant_id = $1 and code = 'PCS'`,
          [tenantId],
        )
      ).rows[0]!.id;
      const pid = newUuidV7();
      await c.query(
        `insert into products (id, tenant_id, sku, name, unit_id) values ($1,$2,'PANEL-550','Solar panel 550W',$3)`,
        [pid, tenantId, unitId],
      );
      productBySku.set('PANEL-550', pid);
    }
    const [firstSku, secondSku] = [...productBySku.keys()];

    const demoLines: DemoLine[] = [
      {
        description: `${firstSku ?? 'Panels'} supply`,
        productSku: firstSku,
        unitLabel: 'PCS',
        quantity: '18',
        unitPrice: '9500',
        discount: '5000',
        taxRate: '0.18',
      },
      {
        description: secondSku ? `${secondSku} supply` : 'Mounting structure',
        productSku: secondSku,
        unitLabel: 'SET',
        quantity: '1',
        unitPrice: '42000',
        discount: '0',
        taxRate: '0.18',
      },
      {
        description: 'Installation, testing & commissioning (labour)',
        quantity: '1',
        unitPrice: '35000',
        discount: '0',
        taxRate: '0.18',
      },
    ];

    // ---- Q-QB-DEMO-1 : a DRAFT quotation ----
    const leadDraft = await upsertLead(c, tenantId, 'Quotation Demo — Rao', '9811100001');
    await c.query(
      `insert into quotations (id, tenant_id, number, lead_id, status, current_revision_no, created_by_membership_id)
       values ($1,$2,'Q-QB-DEMO-1',$3,'DRAFT',1,$4)
       on conflict (tenant_id, number) do nothing`,
      [newUuidV7(), tenantId, leadDraft, adminMembershipId],
    );
    const qDraft = (
      await c.query<{ id: string }>(
        `select id from quotations where tenant_id = $1 and number = 'Q-QB-DEMO-1'`,
        [tenantId],
      )
    ).rows[0]!.id;
    await c.query(
      `insert into quotation_revisions (id, tenant_id, quotation_id, revision_no, status, validity_date, notes, created_by_membership_id)
       values ($1,$2,$3,1,'draft', now() + interval '14 days', '50% advance, balance before dispatch.', $4)
       on conflict (tenant_id, quotation_id, revision_no) do nothing`,
      [newUuidV7(), tenantId, qDraft, adminMembershipId],
    );
    const qDraftRev = (
      await c.query<{ id: string }>(
        `select id from quotation_revisions where tenant_id = $1 and quotation_id = $2 and revision_no = 1`,
        [tenantId, qDraft],
      )
    ).rows[0]!.id;
    await writeRevisionLines(c, tenantId, qDraftRev, productBySku, demoLines);
    await c.query(
      `insert into quotation_activities (id, tenant_id, quotation_id, type, actor_membership_id, payload)
       select $1,$2,$3,'created',$4,'{}'::jsonb
       where not exists (select 1 from quotation_activities where quotation_id = $3 and type = 'created')`,
      [newUuidV7(), tenantId, qDraft, adminMembershipId],
    );

    // ---- Q-QB-DEMO-2 : two revisions, the first frozen ----
    const leadRev = await upsertLead(c, tenantId, 'Quotation Demo — Kunal', '9811100002');
    await c.query(
      `insert into quotations (id, tenant_id, number, lead_id, status, current_revision_no, created_by_membership_id)
       values ($1,$2,'Q-QB-DEMO-2',$3,'DRAFT',2,$4)
       on conflict (tenant_id, number) do update set current_revision_no = 2`,
      [newUuidV7(), tenantId, leadRev, adminMembershipId],
    );
    const q2 = (
      await c.query<{ id: string }>(
        `select id from quotations where tenant_id = $1 and number = 'Q-QB-DEMO-2'`,
        [tenantId],
      )
    ).rows[0]!.id;
    for (const [no, status] of [
      [1, 'superseded'],
      [2, 'draft'],
    ] as const) {
      await c.query(
        `insert into quotation_revisions (id, tenant_id, quotation_id, revision_no, status, validity_date, created_by_membership_id)
         values ($1,$2,$3,$4,$5, now() + interval '10 days', $6)
         on conflict (tenant_id, quotation_id, revision_no) do update set status = excluded.status`,
        [newUuidV7(), tenantId, q2, no, status, adminMembershipId],
      );
      const rid = (
        await c.query<{ id: string }>(
          `select id from quotation_revisions where tenant_id = $1 and quotation_id = $2 and revision_no = $3`,
          [tenantId, q2, no],
        )
      ).rows[0]!.id;
      const lines = no === 1 ? demoLines : demoLines.map((l) => ({ ...l, discount: '0' }));
      await writeRevisionLines(c, tenantId, rid, productBySku, lines);
    }

    // ---- Q-QB-DEMO-3 : a BOOKED quotation with an activated project ----
    const leadBooked = await upsertLead(
      c,
      tenantId,
      'Quotation Demo — Menon',
      '9811100003',
      'CONVERTED',
    );
    await c.query(
      `insert into customers (id, tenant_id, number, name, phone, normalized_phone, city, state, status, lead_id, created_by_membership_id)
       values ($1,$2,'CUST-QB-DEMO','Menon Residency','9811100003','9811100003','Pune','MH','active',$3,$4)
       on conflict (tenant_id, number) do update set status = 'active'`,
      [newUuidV7(), tenantId, leadBooked, adminMembershipId],
    );
    const customerId = (
      await c.query<{ id: string }>(
        `select id from customers where tenant_id = $1 and number = 'CUST-QB-DEMO'`,
        [tenantId],
      )
    ).rows[0]!.id;

    await c.query(
      `insert into projects (id, tenant_id, lead_id, number, customer_name, status, approved_at, approved_by_membership_id, created_by_membership_id)
       values ($1,$2,$3,'PRJ-QB-DEMO','Menon Residency','APPROVED', now(), $4, $4)
       on conflict (tenant_id, number) do update set status = 'APPROVED'`,
      [newUuidV7(), tenantId, leadBooked, adminMembershipId],
    );
    const projectId = (
      await c.query<{ id: string }>(
        `select id from projects where tenant_id = $1 and number = 'PRJ-QB-DEMO'`,
        [tenantId],
      )
    ).rows[0]!.id;
    await c.query(
      `insert into project_activities (id, tenant_id, project_id, type, actor_membership_id, payload)
       select $1,$2,$3,'booked',$4,'{"quotationNumber":"Q-QB-DEMO-3"}'::jsonb
       where not exists (select 1 from project_activities where project_id = $3 and type = 'booked')`,
      [newUuidV7(), tenantId, projectId, adminMembershipId],
    );

    await c.query(
      `insert into quotations (id, tenant_id, number, lead_id, customer_id, project_id, status, current_revision_no, booked_at, booked_by_membership_id, created_by_membership_id)
       values ($1,$2,'Q-QB-DEMO-3',$3,$4,$5,'BOOKED',1, now(), $6, $6)
       on conflict (tenant_id, number) do update set status = 'BOOKED', project_id = excluded.project_id, customer_id = excluded.customer_id`,
      [newUuidV7(), tenantId, leadBooked, customerId, projectId, adminMembershipId],
    );
    const q3 = (
      await c.query<{ id: string }>(
        `select id from quotations where tenant_id = $1 and number = 'Q-QB-DEMO-3'`,
        [tenantId],
      )
    ).rows[0]!.id;
    await c.query(
      `insert into quotation_revisions (id, tenant_id, quotation_id, revision_no, status, validity_date, sent_at, accepted_at, accepted_by_membership_id, acceptance_note, created_by_membership_id)
       values ($1,$2,$3,1,'accepted', now() + interval '30 days', now() - interval '2 days', now() - interval '1 day', $4, 'Confirmed by customer on site.', $4)
       on conflict (tenant_id, quotation_id, revision_no) do update set status = 'accepted'`,
      [newUuidV7(), tenantId, q3, adminMembershipId],
    );
    const q3Rev = (
      await c.query<{ id: string }>(
        `select id from quotation_revisions where tenant_id = $1 and quotation_id = $2 and revision_no = 1`,
        [tenantId, q3],
      )
    ).rows[0]!.id;
    await writeRevisionLines(c, tenantId, q3Rev, productBySku, demoLines);
    for (const t of ['created', 'sent', 'accepted', 'booked']) {
      await c.query(
        `insert into quotation_activities (id, tenant_id, quotation_id, type, actor_membership_id, payload)
         select $1,$2,$3,$4::quotation_activity_type,$5,'{}'::jsonb
         where not exists (select 1 from quotation_activities where quotation_id = $3 and type = $4::quotation_activity_type)`,
        [randomUUID(), tenantId, q3, t, adminMembershipId],
      );
    }

    console.warn('[seed-commercial-demo] tenant: clans-demo');
    console.warn('[seed-commercial-demo] admin login: admin@clans-demo.test / Demo-Passw0rd!');
    console.warn(
      '[seed-commercial-demo] Q-QB-DEMO-1 (DRAFT), Q-QB-DEMO-2 (rev 2 draft), Q-QB-DEMO-3 (BOOKED -> PRJ-QB-DEMO)',
    );
  } finally {
    c.release();
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-commercial-demo] failed:', err);
  process.exit(1);
});
