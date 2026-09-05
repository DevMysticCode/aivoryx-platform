/**
 * Phase 4 demo/seed data — a Clans-flavored field-operations scenario: one
 * field agent, one lead, one scheduled visit, and a tenant-configurable
 * `visit` survey definition set. NOT production customer data — synthetic
 * demo content only, safe to run repeatedly (idempotent upserts).
 *
 * Usage: `pnpm --filter @aivoryx/api exec tsx scripts/seed-field-demo.ts`
 * Requires `pnpm db:migrate` and the base `seedPermissions` catalogue seed to
 * have already run (see `packages/db/src/seed.ts`).
 */
import { hash as argon2Hash } from '@node-rs/argon2';
import {
  createDb,
  newUuidV7,
  provisionFieldAgentRole,
  provisionTenantAdmin,
  seedPermissions,
} from '@aivoryx/db';

const ARGON2ID = 2;

async function main(): Promise<void> {
  const handle = createDb({ poolMax: 3 });
  const c = await handle.pool.connect();
  try {
    await seedPermissions(handle);

    const tenantId = newUuidV7();
    await c.query(
      `insert into tenants (id, slug, name)
       values ($1, 'clans-demo', 'Clans Solar (Demo)')
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [tenantId],
    );
    const { rows: tenantRows } = await c.query<{ id: string }>(
      `select id from tenants where slug = 'clans-demo'`,
    );
    const clansTenantId = tenantRows[0]!.id;

    const upsertUser = async (email: string, name: string, password: string): Promise<string> => {
      const userId = newUuidV7();
      const passwordHash = await argon2Hash(password, { algorithm: ARGON2ID });
      await c.query(
        `insert into users (id, email, name, password_hash, password_updated_at)
         values ($1, $2, $3, $4, now())
         on conflict (lower(email)) do update set name = excluded.name`,
        [userId, email, name, passwordHash],
      );
      const { rows } = await c.query<{ id: string }>('select id from users where email = $1', [
        email,
      ]);
      return rows[0]!.id;
    };

    const upsertMembership = async (userId: string, tenantId: string): Promise<string> => {
      const { rows: existing } = await c.query<{ id: string }>(
        'select id from user_tenant_memberships where user_id = $1 and tenant_id = $2',
        [userId, tenantId],
      );
      if (existing[0]) return existing[0].id;
      const id = newUuidV7();
      await c.query(
        `insert into user_tenant_memberships (id, user_id, tenant_id, status)
         values ($1, $2, $3, 'active')`,
        [id, userId, tenantId],
      );
      return id;
    };

    const adminUserId = await upsertUser('admin@clans-demo.test', 'Clans Admin', 'Demo-Passw0rd!');
    const adminMembershipId = await upsertMembership(adminUserId, clansTenantId);
    await provisionTenantAdmin(handle, {
      tenantId: clansTenantId,
      actingUserId: adminUserId,
      membershipId: adminMembershipId,
    });

    const agentUserId = await upsertUser(
      'agent@clans-demo.test',
      'Field Agent Demo',
      'Demo-Passw0rd!',
    );
    const agentMembershipId = await upsertMembership(agentUserId, clansTenantId);
    await c.query(
      `insert into field_agents (id, tenant_id, membership_id, status)
       values ($1, $2, $3, 'active')
       on conflict (tenant_id, membership_id) do update set status = 'active'`,
      [newUuidV7(), clansTenantId, agentMembershipId],
    );
    await provisionFieldAgentRole(handle, {
      tenantId: clansTenantId,
      actingUserId: adminUserId,
      membershipId: agentMembershipId,
    });

    // Clans-style survey definitions on the `visit` entity — tenant-configurable,
    // no solar-specific column anywhere on `visits` itself (ADR 0033 §7).
    const surveyFields: Array<{
      key: string;
      label: string;
      dataType: 'text' | 'number' | 'boolean' | 'date' | 'select';
      isRequired: boolean;
      options?: string[];
    }> = [
      {
        key: 'property_type',
        label: 'Property type',
        dataType: 'select',
        isRequired: true,
        options: ['residential', 'commercial', 'industrial'],
      },
      {
        key: 'roof_type',
        label: 'Roof type',
        dataType: 'select',
        isRequired: true,
        options: ['flat_rcc', 'sloped_tiled', 'metal_sheet', 'other'],
      },
      {
        key: 'roof_condition',
        label: 'Roof condition',
        dataType: 'select',
        isRequired: false,
        options: ['good', 'fair', 'needs_repair'],
      },
      {
        key: 'roof_area_sqft',
        label: 'Usable roof area (sq ft)',
        dataType: 'number',
        isRequired: true,
      },
      {
        key: 'sanctioned_load_kw',
        label: 'Sanctioned load (kW)',
        dataType: 'number',
        isRequired: true,
      },
      {
        key: 'meter_type',
        label: 'Meter type',
        dataType: 'select',
        isRequired: false,
        options: ['single_phase', 'three_phase', 'net_meter_installed'],
      },
      {
        key: 'monthly_electricity_bill',
        label: 'Average monthly electricity bill (INR)',
        dataType: 'number',
        isRequired: false,
      },
      {
        key: 'roof_orientation',
        label: 'Roof orientation',
        dataType: 'select',
        isRequired: false,
        options: ['north', 'south', 'east', 'west'],
      },
      {
        key: 'shading_issues',
        label: 'Shading issues observed',
        dataType: 'boolean',
        isRequired: false,
      },
      {
        key: 'customer_requirements',
        label: 'Customer requirements / notes',
        dataType: 'text',
        isRequired: false,
      },
    ];
    for (const f of surveyFields) {
      await c.query(
        `insert into custom_field_definitions (id, tenant_id, entity, key, label, data_type, is_required, options)
         values ($1, $2, 'visit', $3, $4, $5, $6, $7)
         on conflict (tenant_id, entity, key) do update
           set label = excluded.label, data_type = excluded.data_type,
               is_required = excluded.is_required, options = excluded.options`,
        [
          newUuidV7(),
          clansTenantId,
          f.key,
          f.label,
          f.dataType,
          f.isRequired,
          f.options ? JSON.stringify(f.options) : null,
        ],
      );
    }

    // one demo lead + one scheduled, assigned visit
    const { rows: existingLead } = await c.query<{ id: string }>(
      `select id from leads where tenant_id = $1 and normalized_phone = '9876500000' limit 1`,
      [clansTenantId],
    );
    const demoLeadId =
      existingLead[0]?.id ??
      (
        await c.query<{ id: string }>(
          `insert into leads (id, tenant_id, name, phone, normalized_phone, address_line, city, state, origin)
           values ($1, $2, 'Ramesh Kumar (Demo)', '9876500000', '9876500000',
                   '12 MG Road', 'Bengaluru', 'Karnataka', 'manual')
           returning id`,
          [newUuidV7(), clansTenantId],
        )
      ).rows[0]!.id;

    const { rows: existingVisit } = await c.query<{ id: string }>(
      `select id from visits where tenant_id = $1 and lead_id = $2 limit 1`,
      [clansTenantId, demoLeadId],
    );
    if (!existingVisit[0]) {
      const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await c.query(
        `insert into visits
           (id, tenant_id, lead_id, assigned_membership_id, status, scheduled_at,
            address_line, city, state, site_lat, site_lng, created_by_membership_id)
         values ($1, $2, $3, $4, 'ASSIGNED', $5, '12 MG Road', 'Bengaluru', 'Karnataka',
                 12.9757, 77.6079, $6)`,
        [newUuidV7(), clansTenantId, demoLeadId, agentMembershipId, scheduledAt, adminMembershipId],
      );
    }

    console.warn('[seed-field-demo] tenant: clans-demo');
    console.warn('[seed-field-demo] admin login: admin@clans-demo.test / Demo-Passw0rd!');
    console.warn('[seed-field-demo] field agent login: agent@clans-demo.test / Demo-Passw0rd!');
  } finally {
    c.release();
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-field-demo] failed:', err);
  process.exit(1);
});
