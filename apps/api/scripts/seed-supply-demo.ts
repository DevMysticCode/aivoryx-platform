/**
 * Phase 5 demo/seed data — a Clans-flavored procurement → inventory →
 * logistics scenario layered onto the same `clans-demo` tenant as the Phase 4
 * seed. Synthetic demo content only; safe to run repeatedly (idempotent
 * upserts keyed on tenant-scoped codes / numbers).
 *
 * Usage: `pnpm --filter @aivoryx/api exec tsx scripts/seed-supply-demo.ts`
 * Requires `pnpm db:migrate` + `seedPermissions` to have run.
 *
 * It seeds master data (units, categories, products, suppliers, warehouses),
 * opening stock in the main warehouse, one APPROVED project with a bill of
 * materials, and an APPROVED purchase order ready to receive. The full
 * receive → allocate → dispatch → deliver chain is exercised by the
 * Playwright golden path and by hand in the UI.
 */
import { hash as argon2Hash } from '@node-rs/argon2';
import { createDb, newUuidV7, provisionTenantAdmin, seedPermissions } from '@aivoryx/db';

const ARGON2ID = 2;

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
    const { rows: tRows } = await c.query<{ id: string }>(
      `select id from tenants where slug = 'clans-demo'`,
    );
    const tenantId = tRows[0]!.id;

    // admin user + membership + TENANT_ADMIN (full catalogue incl. Phase 5 perms)
    const adminHash = await argon2Hash('Demo-Passw0rd!', { algorithm: ARGON2ID });
    await c.query(
      `insert into users (id, email, name, password_hash, password_updated_at)
       values ($1, 'admin@clans-demo.test', 'Clans Admin', $2, now())
       on conflict (lower(email)) do update set name = excluded.name`,
      [newUuidV7(), adminHash],
    );
    const { rows: uRows } = await c.query<{ id: string }>(
      `select id from users where email = 'admin@clans-demo.test'`,
    );
    const adminUserId = uRows[0]!.id;
    let { rows: mRows } = await c.query<{ id: string }>(
      `select id from user_tenant_memberships where user_id = $1 and tenant_id = $2`,
      [adminUserId, tenantId],
    );
    if (!mRows[0]) {
      await c.query(
        `insert into user_tenant_memberships (id, user_id, tenant_id, status) values ($1,$2,$3,'active')`,
        [newUuidV7(), adminUserId, tenantId],
      );
      ({ rows: mRows } = await c.query<{ id: string }>(
        `select id from user_tenant_memberships where user_id = $1 and tenant_id = $2`,
        [adminUserId, tenantId],
      ));
    }
    const adminMembershipId = mRows[0]!.id;
    await provisionTenantAdmin(handle, {
      tenantId,
      actingUserId: adminUserId,
      membershipId: adminMembershipId,
    });

    // ---- units ----
    const unitIds = new Map<string, string>();
    for (const [code, name] of [
      ['PCS', 'Pieces'],
      ['M', 'Metres'],
      ['SET', 'Set'],
      ['KG', 'Kilograms'],
    ] as const) {
      await c.query(
        `insert into units (id, tenant_id, code, name) values ($1,$2,$3,$4)
         on conflict (tenant_id, code) do update set name = excluded.name`,
        [newUuidV7(), tenantId, code, name],
      );
    }
    for (const r of (
      await c.query<{ id: string; code: string }>(
        `select id, code from units where tenant_id = $1`,
        [tenantId],
      )
    ).rows) {
      unitIds.set(r.code, r.id);
    }

    // ---- categories ----
    const catIds = new Map<string, string>();
    for (const [code, name] of [
      ['GEN', 'Generation'],
      ['BOS', 'Balance of System'],
      ['CABLE', 'Cabling'],
      ['STORAGE', 'Storage'],
    ] as const) {
      await c.query(
        `insert into product_categories (id, tenant_id, code, name) values ($1,$2,$3,$4)
         on conflict (tenant_id, code) do update set name = excluded.name`,
        [newUuidV7(), tenantId, code, name],
      );
    }
    for (const r of (
      await c.query<{ id: string; code: string }>(
        `select id, code from product_categories where tenant_id = $1`,
        [tenantId],
      )
    ).rows) {
      catIds.set(r.code, r.id);
    }

    // ---- products (generic columns only — NO panel_wattage etc.) ----
    const productSpecs: Array<
      [string, string, string, string, string | null, string | null, string]
    > = [
      // sku, name, unit, category, brand, model, reorderLevel
      ['PANEL-550', 'Solar Panel 550W', 'PCS', 'GEN', 'Acme Solar', 'AS-550M', '20'],
      ['INV-5KW', 'String Inverter', 'PCS', 'GEN', 'VoltEdge', 'VE-5K', '2'],
      ['MOUNT-STD', 'Mounting Structure (per kW)', 'SET', 'BOS', 'RackPro', 'RP-STD', '3'],
      ['DC-CABLE', 'DC Cable 4mm²', 'M', 'CABLE', 'WireCo', null, '200'],
      ['AC-CABLE', 'AC Cable 6mm²', 'M', 'CABLE', 'WireCo', null, '150'],
      ['MC4', 'MC4 Connector Pair', 'PCS', 'BOS', 'ConnX', null, '100'],
      ['DB-BOX', 'Distribution Box', 'PCS', 'BOS', 'SwitchGear', 'SG-DB4', '5'],
      ['BATT-5KWH', 'Battery Module', 'PCS', 'STORAGE', 'CellCore', 'CC-5', '2'],
      ['EARTH-KIT', 'Earthing Kit', 'SET', 'BOS', 'GroundPro', null, '3'],
    ];
    const productIds = new Map<string, string>();
    for (const [sku, name, unit, cat, brand, model, reorder] of productSpecs) {
      await c.query(
        `insert into products (id, tenant_id, sku, name, unit_id, category_id, brand, model, reorder_level)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (tenant_id, sku) do update set name = excluded.name, reorder_level = excluded.reorder_level`,
        [
          newUuidV7(),
          tenantId,
          sku,
          name,
          unitIds.get(unit),
          catIds.get(cat),
          brand,
          model,
          reorder,
        ],
      );
    }
    for (const r of (
      await c.query<{ id: string; sku: string }>(
        `select id, sku from products where tenant_id = $1`,
        [tenantId],
      )
    ).rows) {
      productIds.set(r.sku, r.id);
    }

    // ---- suppliers ----
    for (const [code, name, email] of [
      ['SUP-ACME', 'Acme Solar Distribution', 'sales@acme-demo.test'],
      ['SUP-WIRE', 'WireCo Cables', 'orders@wireco-demo.test'],
    ] as const) {
      await c.query(
        `insert into suppliers (id, tenant_id, code, name, contact_email) values ($1,$2,$3,$4,$5)
         on conflict (tenant_id, code) do update set name = excluded.name`,
        [newUuidV7(), tenantId, code, name, email],
      );
    }
    const { rows: supRows } = await c.query<{ id: string }>(
      `select id from suppliers where tenant_id = $1 and code = 'SUP-ACME'`,
      [tenantId],
    );
    const supplierId = supRows[0]!.id;

    // ---- warehouses ----
    for (const [code, name, type] of [
      ['WH-MAIN', 'Main Warehouse', 'main'],
      ['WH-SOUTH', 'Regional Warehouse (South)', 'regional'],
    ] as const) {
      await c.query(
        `insert into warehouses (id, tenant_id, code, name, type) values ($1,$2,$3,$4,$5)
         on conflict (tenant_id, code) do update set name = excluded.name`,
        [newUuidV7(), tenantId, code, name, type],
      );
    }
    const { rows: whRows } = await c.query<{ id: string }>(
      `select id from warehouses where tenant_id = $1 and code = 'WH-MAIN'`,
      [tenantId],
    );
    const mainWarehouseId = whRows[0]!.id;

    // ---- opening stock in the main warehouse (RECEIPT movements + level) ----
    const openingStock: Array<[string, string]> = [
      ['PANEL-550', '40'],
      ['INV-5KW', '4'],
      ['MOUNT-STD', '6'],
      ['DC-CABLE', '500'],
      ['AC-CABLE', '300'],
      ['MC4', '200'],
      ['DB-BOX', '6'],
      ['EARTH-KIT', '5'],
    ];
    for (const [sku, qty] of openingStock) {
      const productId = productIds.get(sku)!;
      const { rows: lvl } = await c.query<{ id: string }>(
        `select id from stock_levels where tenant_id=$1 and warehouse_id=$2 and product_id=$3`,
        [tenantId, mainWarehouseId, productId],
      );
      if (lvl[0]) continue; // already seeded
      await c.query(
        `insert into stock_levels (id, tenant_id, warehouse_id, product_id, on_hand, reserved)
         values ($1,$2,$3,$4,$5,'0')`,
        [newUuidV7(), tenantId, mainWarehouseId, productId, qty],
      );
      await c.query(
        `insert into stock_movements
           (id, tenant_id, warehouse_id, product_id, type, on_hand_delta, reserved_delta, quantity, reference_type, notes, created_by_membership_id)
         values ($1,$2,$3,$4,'RECEIPT',$5,'0',$5,'opening_balance','Demo opening stock',$6)`,
        [newUuidV7(), tenantId, mainWarehouseId, productId, qty, adminMembershipId],
      );
    }

    // ---- demo lead + APPROVED project + bill of materials ----
    const { rows: leadRows0 } = await c.query<{ id: string }>(
      `select id from leads where tenant_id = $1 and normalized_phone = '9876500000' limit 1`,
      [tenantId],
    );
    const leadId =
      leadRows0[0]?.id ??
      (
        await c.query<{ id: string }>(
          `insert into leads (id, tenant_id, name, phone, normalized_phone, address_line, city, state, origin)
           values ($1,$2,'Ramesh Kumar (Demo)','9876500000','9876500000','12 MG Road','Bengaluru','Karnataka','manual')
           returning id`,
          [newUuidV7(), tenantId],
        )
      ).rows[0]!.id;

    const { rows: projRows0 } = await c.query<{ id: string }>(
      `select id from projects where tenant_id = $1 and number = 'PRJ-DEMO-1'`,
      [tenantId],
    );
    let projectId: string;
    if (projRows0[0]) {
      projectId = projRows0[0].id;
    } else {
      projectId = (
        await c.query<{ id: string }>(
          `insert into projects
             (id, tenant_id, lead_id, number, customer_name, status, approved_at, approved_by_membership_id,
              site_address_line, site_city, site_state, created_by_membership_id)
           values ($1,$2,$3,'PRJ-DEMO-1','Ramesh Kumar (Demo)','APPROVED', now(), $4,
                   '12 MG Road','Bengaluru','Karnataka',$4)
           returning id`,
          [newUuidV7(), tenantId, leadId, adminMembershipId],
        )
      ).rows[0]!.id;
      await c.query(
        `insert into project_activities (id, tenant_id, project_id, type, actor_membership_id, payload)
         values ($1,$2,$3,'created',$4,'{}'::jsonb), ($5,$2,$3,'approved',$4,'{}'::jsonb)`,
        [newUuidV7(), tenantId, projectId, adminMembershipId, newUuidV7()],
      );
    }

    const materials: Array<[string, string]> = [
      ['PANEL-550', '20'],
      ['INV-5KW', '1'],
      ['MOUNT-STD', '1'],
      ['MC4', '100'],
      ['DC-CABLE', '200'],
      ['EARTH-KIT', '1'],
    ];
    for (const [sku, qty] of materials) {
      await c.query(
        `insert into project_materials (id, tenant_id, project_id, product_id, required_qty)
         values ($1,$2,$3,$4,$5)
         on conflict (tenant_id, project_id, product_id) do update set required_qty = excluded.required_qty`,
        [newUuidV7(), tenantId, projectId, productIds.get(sku), qty],
      );
    }

    // ---- an APPROVED purchase order ready to receive ----
    const { rows: poRows0 } = await c.query<{ id: string }>(
      `select id from purchase_orders where tenant_id = $1 and number = 'PO-DEMO-1'`,
      [tenantId],
    );
    if (!poRows0[0]) {
      const poId = (
        await c.query<{ id: string }>(
          `insert into purchase_orders
             (id, tenant_id, number, supplier_id, project_id, status, order_date, approved_at, approved_by_membership_id,
              subtotal, tax_total, discount_total, total, created_by_membership_id)
           values ($1,$2,'PO-DEMO-1',$3,$4,'APPROVED', now(), now(), $5,
                   '520000.00','93600.00','0.00','613600.00',$5)
           returning id`,
          [newUuidV7(), tenantId, supplierId, projectId, adminMembershipId],
        )
      ).rows[0]!.id;
      const poLines: Array<[string, string, string, string]> = [
        // sku, orderedQty, unitPrice, lineTotal (net+tax at 18%)
        ['PANEL-550', '20', '13000.00', '306800.00'],
        ['INV-5KW', '1', '60000.00', '70800.00'],
        ['MOUNT-STD', '1', '40000.00', '47200.00'],
        ['DC-CABLE', '200', '150.00', '35400.00'],
        ['MC4', '100', '400.00', '47200.00'],
        ['EARTH-KIT', '1', '8000.00', '9440.00'],
      ];
      let lineNo = 1;
      for (const [sku, qty, price, total] of poLines) {
        await c.query(
          `insert into purchase_order_lines
             (id, tenant_id, purchase_order_id, product_id, line_no, ordered_qty, unit_price, tax_rate, discount, line_total)
           values ($1,$2,$3,$4,$5,$6,$7,'0.18','0.00',$8)`,
          [newUuidV7(), tenantId, poId, productIds.get(sku), lineNo++, qty, price, total],
        );
      }
      await c.query(
        `insert into project_activities (id, tenant_id, project_id, type, actor_membership_id, payload)
         values ($1,$2,$3,'purchase_order_linked',$4, $5::jsonb)`,
        [
          newUuidV7(),
          tenantId,
          projectId,
          adminMembershipId,
          JSON.stringify({ number: 'PO-DEMO-1' }),
        ],
      );
    }

    console.warn('[seed-supply-demo] tenant: clans-demo');
    console.warn('[seed-supply-demo] admin login: admin@clans-demo.test / Demo-Passw0rd!');
    console.warn(
      '[seed-supply-demo] project PRJ-DEMO-1 (APPROVED), PO-DEMO-1 (APPROVED, ready to receive)',
    );
  } finally {
    c.release();
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-supply-demo] failed:', err);
  process.exit(1);
});
