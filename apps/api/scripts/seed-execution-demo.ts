/**
 * Phase 7 demo/seed data — an EPC execution scenario layered onto the booked
 * `PRJ-QB-DEMO` project from the commercial demo (which itself layers on the
 * supply demo). Synthetic content only; idempotent (upserts keyed on
 * tenant-scoped ids / natural keys).
 *
 * Usage: `pnpm --filter @aivoryx/api exec tsx scripts/seed-execution-demo.ts`
 * Requires `pnpm db:migrate`, `seed:supply-demo`, `seed:field-demo` and
 * `seed:commercial-demo` to have run first.
 *
 * Leaves the project mid-execution: milestones created, an installation
 * assigned to the demo field agent and IN_PROGRESS with a partly-done
 * checklist, one PENDING QC inspection, one OPEN defect, net metering
 * SUBMITTED, handover PENDING — enough to demonstrate every screen.
 */
import { randomUUID } from 'node:crypto';
import { createDb, newUuidV7, seedPermissions } from '@aivoryx/db';
import type { PoolClient } from 'pg';
import { DEFAULT_CHECKLIST_TEMPLATES } from '../src/execution/checklist-templates.js';

const MILESTONES = [
  'PLANNING',
  'MATERIAL_READY',
  'INSTALLATION_SCHEDULED',
  'INSTALLATION_STARTED',
  'INSTALLATION_COMPLETED',
  'QC_PENDING',
  'QC_PASSED',
  'NET_METERING',
  'HANDOVER_READY',
  'HANDED_OVER',
  'COMPLETED',
];

async function ensureTemplates(c: PoolClient, tenantId: string): Promise<void> {
  for (const kind of ['installation', 'qc', 'handover'] as const) {
    for (const [i, t] of DEFAULT_CHECKLIST_TEMPLATES[kind].entries()) {
      await c.query(
        `insert into checklist_templates (id, tenant_id, kind, label, sort_order, required)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (tenant_id, kind, label) do nothing`,
        [newUuidV7(), tenantId, kind, t.label, i, t.required],
      );
    }
  }
}

async function main(): Promise<void> {
  const handle = createDb({ poolMax: 3 });
  const c = await handle.pool.connect();
  try {
    await seedPermissions(handle);

    const tenantId = (
      await c.query<{ id: string }>(`select id from tenants where slug = 'clans-demo'`)
    ).rows[0]?.id;
    if (!tenantId) throw new Error('run seed:supply-demo / seed:commercial-demo first');

    const adminMembershipId = (
      await c.query<{ id: string }>(
        `select m.id from user_tenant_memberships m
         join users u on u.id = m.user_id
         where m.tenant_id = $1 and u.email = 'admin@clans-demo.test'`,
        [tenantId],
      )
    ).rows[0]?.id;
    if (!adminMembershipId) throw new Error('admin membership missing');

    const agentMembershipId = (
      await c.query<{ id: string }>(
        `select m.id from user_tenant_memberships m
         join users u on u.id = m.user_id
         where m.tenant_id = $1 and u.email = 'agent@clans-demo.test'`,
        [tenantId],
      )
    ).rows[0]?.id;

    const projectId = (
      await c.query<{ id: string }>(
        `select id from projects where tenant_id = $1 and number = 'PRJ-QB-DEMO'`,
        [tenantId],
      )
    ).rows[0]?.id;
    if (!projectId) throw new Error('PRJ-QB-DEMO missing — run seed:commercial-demo first');

    await ensureTemplates(c, tenantId);

    // milestones
    for (const [i, key] of MILESTONES.entries()) {
      await c.query(
        `insert into project_milestones (id, tenant_id, project_id, key, sort_order, status, completed_at, completed_by_membership_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (tenant_id, project_id, key) do nothing`,
        [
          newUuidV7(),
          tenantId,
          projectId,
          key,
          i,
          ['PLANNING', 'MATERIAL_READY', 'INSTALLATION_SCHEDULED', 'INSTALLATION_STARTED'].includes(
            key,
          )
            ? 'done'
            : 'pending',
          ['PLANNING', 'MATERIAL_READY', 'INSTALLATION_SCHEDULED', 'INSTALLATION_STARTED'].includes(
            key,
          )
            ? new Date()
            : null,
          ['PLANNING', 'MATERIAL_READY', 'INSTALLATION_SCHEDULED', 'INSTALLATION_STARTED'].includes(
            key,
          )
            ? adminMembershipId
            : null,
        ],
      );
    }

    // installation — assigned + IN_PROGRESS, with a material override (demo project has no delivered stock)
    await c.query(
      `insert into project_installations
        (id, tenant_id, project_id, status, assigned_membership_id, assigned_at, assigned_by_membership_id,
         started_at, material_override, material_override_by_membership_id, material_override_reason, created_by_membership_id)
       values ($1,$2,$3,'IN_PROGRESS',$4, now() - interval '2 days', $5, now() - interval '1 day',
               true, $5, 'Demo: proceeding on partial stock', $5)
       on conflict (tenant_id, project_id) do update
         set status='IN_PROGRESS', assigned_membership_id=excluded.assigned_membership_id,
             started_at=excluded.started_at, material_override=true`,
      [newUuidV7(), tenantId, projectId, agentMembershipId ?? adminMembershipId, adminMembershipId],
    );

    // installation checklist — first three items done
    const instItemsRows = (
      await c.query<{ n: number }>(
        `select count(*)::int as n from project_checklist_items
         where tenant_id=$1 and project_id=$2 and kind='installation'`,
        [tenantId, projectId],
      )
    ).rows;
    if ((instItemsRows[0]?.n ?? 0) === 0) {
      for (const [i, t] of DEFAULT_CHECKLIST_TEMPLATES.installation.entries()) {
        await c.query(
          `insert into project_checklist_items
            (id, tenant_id, project_id, kind, label, sort_order, required, status, completed_at, completed_by_membership_id)
           values ($1,$2,$3,'installation',$4,$5,$6,$7,$8,$9)`,
          [
            newUuidV7(),
            tenantId,
            projectId,
            t.label,
            i,
            t.required,
            i < 3 ? 'done' : 'pending',
            i < 3 ? new Date() : null,
            i < 3 ? (agentMembershipId ?? adminMembershipId) : null,
          ],
        );
      }
    }

    // handover checklist
    const hoItemsRows = (
      await c.query<{ n: number }>(
        `select count(*)::int as n from project_checklist_items
         where tenant_id=$1 and project_id=$2 and kind='handover'`,
        [tenantId, projectId],
      )
    ).rows;
    if ((hoItemsRows[0]?.n ?? 0) === 0) {
      for (const [i, t] of DEFAULT_CHECKLIST_TEMPLATES.handover.entries()) {
        await c.query(
          `insert into project_checklist_items (id, tenant_id, project_id, kind, label, sort_order, required)
           values ($1,$2,$3,'handover',$4,$5,$6)`,
          [newUuidV7(), tenantId, projectId, t.label, i, t.required],
        );
      }
    }

    // one PENDING QC inspection with its checklist
    let inspectionId = (
      await c.query<{ id: string }>(
        `select id from project_qc_inspections where tenant_id=$1 and project_id=$2 and seq=1`,
        [tenantId, projectId],
      )
    ).rows[0]?.id;
    if (!inspectionId) {
      inspectionId = newUuidV7();
      await c.query(
        `insert into project_qc_inspections (id, tenant_id, project_id, seq, status, created_by_membership_id)
         values ($1,$2,$3,1,'PENDING',$4)`,
        [inspectionId, tenantId, projectId, adminMembershipId],
      );
      for (const [i, t] of DEFAULT_CHECKLIST_TEMPLATES.qc.entries()) {
        await c.query(
          `insert into project_checklist_items (id, tenant_id, project_id, inspection_id, kind, label, sort_order, required)
           values ($1,$2,$3,$4,'qc',$5,$6,$7)`,
          [newUuidV7(), tenantId, projectId, inspectionId, t.label, i, t.required],
        );
      }
    }

    // one OPEN defect assigned to the field agent
    await c.query(
      `insert into project_defects (id, tenant_id, project_id, inspection_id, description, severity, status, assigned_membership_id, created_by_membership_id)
       select $1,$2,$3,$4,'Panel string 3 shows low output','high','OPEN',$5,$6
       where not exists (select 1 from project_defects where tenant_id=$2 and project_id=$3)`,
      [
        newUuidV7(),
        tenantId,
        projectId,
        inspectionId,
        agentMembershipId ?? adminMembershipId,
        adminMembershipId,
      ],
    );

    // net metering — SUBMITTED
    await c.query(
      `insert into project_net_metering (id, tenant_id, project_id, status, reference_number, submitted_at, created_by_membership_id)
       values ($1,$2,$3,'SUBMITTED','NM-DEMO-2026', now() - interval '3 days', $4)
       on conflict (tenant_id, project_id) do update set status='SUBMITTED', reference_number='NM-DEMO-2026'`,
      [newUuidV7(), tenantId, projectId, adminMembershipId],
    );

    // handover — PENDING
    await c.query(
      `insert into project_handover (id, tenant_id, project_id, status, created_by_membership_id)
       values ($1,$2,$3,'PENDING',$4)
       on conflict (tenant_id, project_id) do nothing`,
      [newUuidV7(), tenantId, projectId, adminMembershipId],
    );

    await c.query(
      `insert into project_activities (id, tenant_id, project_id, type, actor_membership_id, payload)
       select $1,$2,$3,'execution_started',$4,'{}'::jsonb
       where not exists (select 1 from project_activities where project_id=$3 and type='execution_started')`,
      [randomUUID(), tenantId, projectId, adminMembershipId],
    );

    console.warn('[seed-execution-demo] tenant: clans-demo');
    console.warn('[seed-execution-demo] admin login: admin@clans-demo.test / Demo-Passw0rd!');
    console.warn(
      `[seed-execution-demo] PRJ-QB-DEMO execution: installation IN_PROGRESS (agent${
        agentMembershipId ? ' agent@clans-demo.test' : ''
      }), 1 QC pending, 1 open defect, net metering SUBMITTED, handover PENDING`,
    );
  } finally {
    c.release();
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-execution-demo] failed:', err);
  process.exit(1);
});
