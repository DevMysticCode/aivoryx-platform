/**
 * Phase 9 demo/seed data — a small operational-finance scenario for the
 * `clans-demo` tenant, layered on the existing demos (uses the commercial
 * demo's `PRJ-QB-DEMO` project + its customer). Synthetic content only;
 * idempotent (natural-key checks). Production correctness never depends on it.
 *
 * Usage: `pnpm --filter @aivoryx/api exec tsx scripts/seed-finance-demo.ts`
 * Requires `pnpm db:migrate` + `seed:supply-demo` + `seed:commercial-demo`.
 *
 * Leaves: one PAID invoice, one PARTIALLY_PAID invoice, one overdue invoice,
 * one unallocated payment and one issued credit note — enough to populate the
 * finance overview, the customer summary and the project summary.
 */
import { randomUUID } from 'node:crypto';
import { createDb, seedPermissions } from '@aivoryx/db';
import type { PoolClient } from 'pg';

const money = (n: number) => n.toFixed(2);

async function nextNumber(c: PoolClient, tenantId: string, kind: string, prefix: string) {
  await c.query(
    `insert into finance_counters (id, tenant_id, kind, prefix, value)
     values (gen_random_uuid(),$1,$2,$3,0)
     on conflict (tenant_id, kind) do nothing`,
    [tenantId, kind, prefix],
  );
  const { rows } = await c.query<{ prefix: string; padding: number; value: string }>(
    `update finance_counters set value = value + 1, updated_at = now()
     where tenant_id = $1 and kind = $2
     returning prefix, padding, value`,
    [tenantId, kind],
  );
  const r = rows[0]!;
  return `${r.prefix}${String(r.value).padStart(r.padding, '0')}`;
}

async function makeInvoice(
  c: PoolClient,
  tenantId: string,
  membershipId: string,
  customerId: string,
  projectId: string | null,
  opts: { qty: number; unitPrice: number; taxRate: number; dueDate: string; issue: boolean },
) {
  const gross = opts.qty * opts.unitPrice;
  const tax = Math.round(gross * opts.taxRate * 100) / 100;
  const grand = gross + tax;
  const number = await nextNumber(c, tenantId, 'invoice', 'INV-');
  const id = randomUUID();
  await c.query(
    `insert into invoices
       (id, tenant_id, number, customer_id, project_id, source, status, currency,
        issue_date, due_date, subtotal, discount_total, tax_total, grand_total, created_by_membership_id,
        issued_at, issued_by_membership_id)
     values ($1,$2,$3,$4,$5,$6,$7,'INR', $8,$9,$10,'0.00',$11,$12,$13, $14,$15)`,
    [
      id,
      tenantId,
      number,
      customerId,
      projectId,
      projectId ? 'project' : 'manual',
      opts.issue ? 'ISSUED' : 'DRAFT',
      opts.issue ? new Date().toISOString().slice(0, 10) : null,
      opts.dueDate,
      money(gross),
      money(tax),
      money(grand),
      membershipId,
      opts.issue ? new Date() : null,
      opts.issue ? membershipId : null,
    ],
  );
  await c.query(
    `insert into invoice_lines
       (id, tenant_id, invoice_id, line_no, description, quantity, unit_price, tax_rate,
        line_subtotal, line_discount, line_taxable, line_tax, line_total)
     values (gen_random_uuid(),$1,$2,1,'Consulting services',$3,$4,$5,$6,'0.00',$6,$7,$8)`,
    [
      tenantId,
      id,
      money(opts.qty),
      money(opts.unitPrice),
      money(opts.taxRate),
      money(gross),
      money(tax),
      money(grand),
    ],
  );
  return { id, number, grand };
}

async function recordAndAllocate(
  c: PoolClient,
  tenantId: string,
  membershipId: string,
  customerId: string,
  amount: number,
  allocate?: { invoiceId: string; amount: number },
) {
  const number = await nextNumber(c, tenantId, 'payment', 'PMT-');
  const id = randomUUID();
  await c.query(
    `insert into payments
       (id, tenant_id, number, customer_id, payment_date, amount, currency, method, allocated_amount, created_by_membership_id)
     values ($1,$2,$3,$4, now()::date, $5,'INR','BANK_TRANSFER',$6,$7)`,
    [id, tenantId, number, customerId, money(amount), money(allocate?.amount ?? 0), membershipId],
  );
  if (allocate) {
    await c.query(
      `insert into payment_allocations (id, tenant_id, payment_id, invoice_id, amount, created_by_membership_id)
       values (gen_random_uuid(),$1,$2,$3,$4,$5)`,
      [tenantId, id, allocate.invoiceId, money(allocate.amount), membershipId],
    );
    // update invoice projection + status
    await c.query(
      `update invoices set amount_paid = $3,
         status = case when $3::numeric >= grand_total then 'PAID'
                       when $3::numeric > 0 then 'PARTIALLY_PAID' else status end
       where tenant_id = $1 and id = $2`,
      [tenantId, allocate.invoiceId, money(allocate.amount)],
    );
  }
  return id;
}

async function main(): Promise<void> {
  const handle = createDb({ poolMax: 2 });
  const c = await handle.pool.connect();
  try {
    await seedPermissions(handle);
    const tenantId = (
      await c.query<{ id: string }>(`select id from tenants where slug='clans-demo'`)
    ).rows[0]?.id;
    if (!tenantId) throw new Error('run seed:supply-demo first');
    const membershipId = (
      await c.query<{ id: string }>(
        `select m.id from user_tenant_memberships m join users u on u.id=m.user_id
         where m.tenant_id=$1 and u.email='admin@clans-demo.test'`,
        [tenantId],
      )
    ).rows[0]?.id;
    if (!membershipId) throw new Error('admin membership missing');

    if (
      (await c.query(`select 1 from invoices where tenant_id=$1 limit 1`, [tenantId])).rows.length >
      0
    ) {
      console.warn('[seed-finance-demo] finance rows already present — nothing to do');
      return;
    }

    const project = (
      await c.query<{ id: string; lead_id: string }>(
        `select id, lead_id from projects where tenant_id=$1 and number='PRJ-QB-DEMO'`,
        [tenantId],
      )
    ).rows[0];
    // the commercial demo promotes the customer at booking — find it by that lead
    const customerId =
      (
        await c.query<{ id: string }>(
          `select id from customers where tenant_id=$1 and lead_id=$2 limit 1`,
          [tenantId, project?.lead_id ?? null],
        )
      ).rows[0]?.id ??
      (
        await c.query<{ id: string }>(
          `insert into customers (id, tenant_id, number, name, email, created_by_membership_id)
           values (gen_random_uuid(),$1,'CUST-FIN-DEMO','Finance Demo Co','ap@finance-demo.test',$2)
           returning id`,
          [tenantId, membershipId],
        )
      ).rows[0]!.id;

    const paid = await makeInvoice(c, tenantId, membershipId, customerId, project?.id ?? null, {
      qty: 1,
      unitPrice: 120000,
      taxRate: 0.18,
      dueDate: '2026-08-01',
      issue: true,
    });
    await recordAndAllocate(c, tenantId, membershipId, customerId, paid.grand, {
      invoiceId: paid.id,
      amount: paid.grand,
    });

    const partial = await makeInvoice(c, tenantId, membershipId, customerId, project?.id ?? null, {
      qty: 1,
      unitPrice: 80000,
      taxRate: 0.18,
      dueDate: '2026-11-01',
      issue: true,
    });
    await recordAndAllocate(c, tenantId, membershipId, customerId, 40000, {
      invoiceId: partial.id,
      amount: 40000,
    });

    await makeInvoice(c, tenantId, membershipId, customerId, project?.id ?? null, {
      qty: 1,
      unitPrice: 50000,
      taxRate: 0.18,
      dueDate: '2024-01-15',
      issue: true,
    });

    // one unallocated payment
    await recordAndAllocate(c, tenantId, membershipId, customerId, 15000);

    // one issued credit note against the partially-paid invoice
    const cnNumber = await nextNumber(c, tenantId, 'credit_note', 'CN-');
    await c.query(
      `insert into credit_notes
         (id, tenant_id, number, customer_id, invoice_id, status, currency, issue_date, reason, amount,
          issued_at, issued_by_membership_id, created_by_membership_id)
       values (gen_random_uuid(),$1,$2,$3,$4,'ISSUED','INR', now()::date,'Goodwill discount','5000.00',
               now(),$5,$5)`,
      [tenantId, cnNumber, customerId, partial.id, membershipId],
    );
    await c.query(`update invoices set amount_credited='5000.00' where tenant_id=$1 and id=$2`, [
      tenantId,
      partial.id,
    ]);

    console.warn('[seed-finance-demo] tenant: clans-demo · admin@clans-demo.test / Demo-Passw0rd!');
    console.warn(
      '[seed-finance-demo] 3 invoices (paid / partially paid / overdue), 1 unallocated payment, 1 issued credit note',
    );
  } finally {
    c.release();
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-finance-demo] failed:', err);
  process.exit(1);
});
