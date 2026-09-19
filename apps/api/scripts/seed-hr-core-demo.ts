/**
 * Phase 17 — HR Core demo seed. Additive and idempotent: it never touches rows
 * that `seed:hr-demo` created, so it can be rerun (or run against an existing
 * demo database) safely. Requires `seed:hr-demo` first.
 *
 *   Usage: `pnpm --filter @aivoryx/api run seed:hr-core-demo`
 *
 * Adds to the clans-demo workspace:
 *  - a TEAM-scoped manager login — manager@clans-demo.test / Demo-Passw0rd! —
 *    linked to Neha Kulkarni (Field Supervisor). Under HR data scope TEAM she
 *    sees herself and her two direct reports only, and leave/expense requests
 *    from those reports route to her for approval;
 *  - one employee in the ONBOARDING lifecycle state (starts in two weeks);
 *  - one ARCHIVED department, to show archive behaviour.
 */
import { hash as argon2Hash } from '@node-rs/argon2';
import { createDb, newUuidV7, seedPermissions } from '@aivoryx/db';

const ARGON2ID = 2;
const PASSWORD = 'Demo-Passw0rd!';
const MANAGER_EMAIL = 'manager@clans-demo.test';

const MANAGER_PROFILE_PERMISSIONS = [
  'hr.employee.read',
  'hr.attendance.read',
  'hr.attendance.self',
  'hr.leave.read',
  'hr.leave.request',
  'hr.leave.approve',
  'hr.expense.read',
  'hr.expense.submit',
  'hr.expense.approve',
  'hr.performance.read',
];

function addDays(base: Date, n: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const handle = createDb({ poolMax: 2 });
  const c = await handle.pool.connect();
  try {
    await seedPermissions(handle);

    const tenantId = (
      await c.query<{ id: string }>(`select id from tenants where slug='clans-demo'`)
    ).rows[0]?.id;
    if (!tenantId) throw new Error('clans-demo not found — run the earlier demo seeds first');

    const emp = async (name: string) =>
      (
        await c.query<{ id: string; membership_id: string | null }>(
          `select id, membership_id from hr_employees where tenant_id=$1 and display_name=$2`,
          [tenantId, name],
        )
      ).rows[0];

    const neha = await emp('Neha Kulkarni');
    if (!neha) throw new Error('HR demo employees not found — run seed:hr-demo first');
    const vikram = await emp('Vikram Singh');

    await c.query('begin');
    const adminMembershipId = (
      await c.query<{ id: string }>(
        `select m.id from user_tenant_memberships m join users u on u.id=m.user_id
         where m.tenant_id=$1 and u.email='admin@clans-demo.test'`,
        [tenantId],
      )
    ).rows[0]?.id;
    await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    if (adminMembershipId)
      await c.query(`select set_config('app.user_id', $1, true)`, [adminMembershipId]);

    // ---- team-scoped manager login -------------------------------------
    const pwHash = await argon2Hash(PASSWORD, { algorithm: ARGON2ID });
    await c.query(
      `insert into users (id, email, name, password_hash, password_updated_at)
       values ($1, $2, 'Neha Kulkarni', $3, now())
       on conflict (lower(email)) do update set name = excluded.name`,
      [newUuidV7(), MANAGER_EMAIL, pwHash],
    );
    const userId = (
      await c.query<{ id: string }>('select id from users where lower(email)=lower($1)', [
        MANAGER_EMAIL,
      ])
    ).rows[0]!.id;
    let membershipId = (
      await c.query<{ id: string }>(
        'select id from user_tenant_memberships where user_id=$1 and tenant_id=$2',
        [userId, tenantId],
      )
    ).rows[0]?.id;
    if (!membershipId) {
      membershipId = newUuidV7();
      await c.query(
        `insert into user_tenant_memberships (id, user_id, tenant_id, status) values ($1,$2,$3,'active')`,
        [membershipId, userId, tenantId],
      );
    }

    await c.query(
      `insert into roles (id, tenant_id, key, name, description, kind)
       values ($1, $2, 'TEAM_MANAGER', 'Team Manager',
               'Manages a team: sees and approves their direct reports’ HR requests.', 'profile')
       on conflict (tenant_id, key) do update
         set name = excluded.name, description = excluded.description, kind = excluded.kind, updated_at = now()`,
      [newUuidV7(), tenantId],
    );
    const roleId = (
      await c.query<{ id: string }>(
        `select id from roles where tenant_id=$1 and key='TEAM_MANAGER'`,
        [tenantId],
      )
    ).rows[0]!.id;
    await c.query('delete from role_permissions where role_id=$1', [roleId]);
    await c.query(
      `insert into role_permissions (role_id, tenant_id, permission_id)
       select $1, $2, p.id from permissions p where p.key = any($3) on conflict do nothing`,
      [roleId, tenantId, MANAGER_PROFILE_PERMISSIONS],
    );
    await c.query(
      `delete from membership_roles mr using roles r
        where mr.role_id = r.id and mr.membership_id = $1 and r.kind = 'profile'`,
      [membershipId],
    );
    await c.query(
      `insert into membership_roles (membership_id, role_id, tenant_id, data_scope)
       values ($1, $2, $3, 'TEAM')
       on conflict (membership_id, role_id) do update set data_scope = 'TEAM'`,
      [membershipId, roleId, tenantId],
    );
    // link her employee record to the login (only if it is not already linked)
    if (!neha.membership_id) {
      await c.query(`update hr_employees set membership_id=$1 where id=$2 and tenant_id=$3`, [
        membershipId,
        neha.id,
        tenantId,
      ]);
    }

    // ---- an employee still onboarding ---------------------------------
    let onboardingNumber: string | null = null;
    if (!(await emp('Kabir Shah'))) {
      const one = async (table: string, name: string) =>
        (
          await c.query<{ id: string }>(`select id from ${table} where tenant_id=$1 and name=$2`, [
            tenantId,
            name,
          ])
        ).rows[0]?.id ?? null;
      await c.query(
        `insert into hr_counters (id, tenant_id, kind, prefix, padding, value)
         values ($1,$2,'employee','EMP-',6,0) on conflict (tenant_id, kind) do nothing`,
        [newUuidV7(), tenantId],
      );
      const counter = await c.query<{ prefix: string; padding: number; value: string }>(
        `update hr_counters set value = value + 1, updated_at = now()
          where tenant_id=$1 and kind='employee' returning prefix, padding, value`,
        [tenantId],
      );
      const row = counter.rows[0]!;
      onboardingNumber = `${row.prefix}${String(row.value).padStart(row.padding, '0')}`;
      await c.query(
        `insert into hr_employees
           (id, tenant_id, employee_number, first_name, last_name, display_name, work_email,
            joining_date, status, employment_type, department_id, designation_id,
            work_location_id, manager_id, created_by_membership_id, probation_end_date)
         values ($1,$2,$3,'Kabir','Shah','Kabir Shah','kabir.shah@clans-demo.test',
                 $4,'ONBOARDING','FULL_TIME',$5,$6,$7,$8,$9,$10)`,
        [
          newUuidV7(),
          tenantId,
          onboardingNumber,
          addDays(new Date(), 14),
          await one('hr_departments', 'Sales'),
          await one('hr_designations', 'Associate'),
          await one('hr_work_locations', 'Head Office'),
          vikram?.id ?? null,
          adminMembershipId ?? null,
          addDays(new Date(), 14 + 90),
        ],
      );
    }

    // ---- an archived department --------------------------------------
    await c.query(
      `insert into hr_departments (id, tenant_id, name, code, status)
       values ($1,$2,'Legacy Projects','LEGACY','ARCHIVED')
       on conflict (tenant_id, code) do nothing`,
      [newUuidV7(), tenantId],
    );

    await c.query('commit');
    console.warn(
      `[seed-hr-core-demo] manager login: ${MANAGER_EMAIL} / ${PASSWORD} (TEAM scope, linked to Neha Kulkarni)`,
    );
    console.warn(
      onboardingNumber
        ? `[seed-hr-core-demo] onboarding employee Kabir Shah created (${onboardingNumber}), starts ${addDays(new Date(), 14)}`
        : '[seed-hr-core-demo] onboarding employee already present',
    );
    console.warn('[seed-hr-core-demo] archived department "Legacy Projects" ensured');
  } catch (err) {
    await c.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    c.release();
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
