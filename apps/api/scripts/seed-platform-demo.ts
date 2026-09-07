/**
 * Phase 13 (ADR 0042) — Platform Access Foundation demo seed.
 *
 * Two workspaces with different module entitlements, one global platform
 * administrator, representative tenant users, and representative Profiles /
 * Permission Sets built ONLY from permissions of each workspace's entitled
 * modules. Deterministic (natural-key upserts), industry-neutral, and safe to
 * rerun. Production correctness never depends on this script.
 *
 *   Usage: `pnpm --filter @aivoryx/api run seed:platform-demo`
 *   Requires `pnpm db:migrate` + `pnpm --filter @aivoryx/db db:seed`.
 *
 * Company A — "Northwind Energy (Demo)" (slug: northwind-demo)
 *   Modules: CRM, FIELD, SUPPLY, COMMERCIAL, EPC, FINANCE, HR (all seven)
 *   Users  : Tenant Admin, Sales User, Field User, HR User, Finance User
 *
 * Company B — "Southbridge Retail (Demo)" (slug: southbridge-demo)
 *   Modules: CRM, SUPPLY  (NOT FIELD / COMMERCIAL / EPC / FINANCE / HR)
 *   Users  : Tenant Admin, Sales User, Inventory User
 *
 * Platform admin — platform-admin@aivoryx.test / Demo-Passw0rd!
 *   A row in `platform_admins`. NOT a member of any tenant: it operates the
 *   `/platform/*` routes purely on its global identity.
 *
 * Every login is `Demo-Passw0rd!`.
 */
import { hash as argon2Hash } from '@node-rs/argon2';
import {
  createDb,
  newUuidV7,
  provisionTenantAdmin,
  seedPermissions,
  type DbHandle,
} from '@aivoryx/db';
import { moduleForPermission, type ModuleKey } from '@aivoryx/shared';
import type { PoolClient } from 'pg';

const ARGON2ID = 2;
const PASSWORD = 'Demo-Passw0rd!';

interface SeededUser {
  userId: string;
  membershipId: string;
  email: string;
}

async function upsertUser(
  c: PoolClient,
  email: string,
  name: string,
  passwordHash: string,
): Promise<string> {
  await c.query(
    `insert into users (id, email, name, password_hash, password_updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (lower(email)) do update set name = excluded.name`,
    [newUuidV7(), email, name, passwordHash],
  );
  const { rows } = await c.query<{ id: string }>(
    'select id from users where lower(email) = lower($1)',
    [email],
  );
  return rows[0]!.id;
}

async function upsertMembership(c: PoolClient, userId: string, tenantId: string): Promise<string> {
  const { rows: existing } = await c.query<{ id: string }>(
    'select id from user_tenant_memberships where user_id = $1 and tenant_id = $2',
    [userId, tenantId],
  );
  if (existing[0]) return existing[0].id;
  const id = newUuidV7();
  await c.query(
    `insert into user_tenant_memberships (id, user_id, tenant_id, status) values ($1, $2, $3, 'active')`,
    [id, userId, tenantId],
  );
  return id;
}

/**
 * Upsert a `roles` row of a given `kind` and set its permissions to exactly
 * `permissionKeys` intersected with the tenant's ENTITLED modules. Returns the
 * keys that were actually granted and any that were dropped because the module
 * is not entitled (so the demo can *demonstrate* the rule, not just obey it).
 */
async function upsertConfiguredRole(
  c: PoolClient,
  opts: {
    tenantId: string;
    key: string;
    name: string;
    description: string;
    kind: 'profile' | 'permission_set';
    permissionKeys: string[];
    entitled: ReadonlySet<ModuleKey>;
  },
): Promise<{ roleId: string; granted: string[]; skipped: string[] }> {
  const granted: string[] = [];
  const skipped: string[] = [];
  for (const k of opts.permissionKeys) {
    const m = moduleForPermission(k);
    if (m === null || opts.entitled.has(m)) granted.push(k);
    else skipped.push(k);
  }

  await c.query(
    `insert into roles (id, tenant_id, key, name, description, kind)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (tenant_id, key)
       do update set name = excluded.name, description = excluded.description, kind = excluded.kind, updated_at = now()`,
    [newUuidV7(), opts.tenantId, opts.key, opts.name, opts.description, opts.kind],
  );
  const { rows } = await c.query<{ id: string }>(
    'select id from roles where tenant_id = $1 and key = $2',
    [opts.tenantId, opts.key],
  );
  const roleId = rows[0]!.id;

  await c.query('delete from role_permissions where role_id = $1', [roleId]);
  if (granted.length > 0) {
    await c.query(
      `insert into role_permissions (role_id, tenant_id, permission_id)
       select $1, $2, p.id from permissions p where p.key = any($3)
       on conflict do nothing`,
      [roleId, opts.tenantId, granted],
    );
  }
  return { roleId, granted, skipped };
}

async function assignProfile(
  c: PoolClient,
  tenantId: string,
  membershipId: string,
  roleId: string,
  dataScope: 'OWN' | 'TEAM' | 'DEPARTMENT' | 'COMPANY',
): Promise<void> {
  // one profile per member: drop existing profile-kind assignments first
  await c.query(
    `delete from membership_roles mr using roles r
      where mr.role_id = r.id and mr.membership_id = $1 and r.kind = 'profile'`,
    [membershipId],
  );
  await c.query(
    `insert into membership_roles (membership_id, role_id, tenant_id, data_scope)
     values ($1, $2, $3, $4)
     on conflict (membership_id, role_id) do update set data_scope = excluded.data_scope`,
    [membershipId, roleId, tenantId, dataScope],
  );
}

async function addPermissionSet(
  c: PoolClient,
  tenantId: string,
  membershipId: string,
  roleId: string,
): Promise<void> {
  await c.query(
    `insert into membership_roles (membership_id, role_id, tenant_id)
     values ($1, $2, $3) on conflict (membership_id, role_id) do nothing`,
    [membershipId, roleId, tenantId],
  );
}

async function upsertTenant(c: PoolClient, slug: string, name: string): Promise<string> {
  await c.query(
    `insert into tenants (id, slug, name) values ($1, $2, $3)
     on conflict (slug) do update set name = excluded.name`,
    [newUuidV7(), slug, name],
  );
  const { rows } = await c.query<{ id: string }>('select id from tenants where slug = $1', [slug]);
  return rows[0]!.id;
}

async function seedCompanyA(handle: DbHandle, c: PoolClient, pwHash: string): Promise<void> {
  const tenantId = await upsertTenant(c, 'northwind-demo', 'Northwind Energy (Demo)');
  const modules: ModuleKey[] = ['CRM', 'FIELD', 'SUPPLY', 'COMMERCIAL', 'EPC', 'FINANCE', 'HR'];
  const entitled = new Set(modules);

  const admin = await upsertUser(c, 'admin@northwind-demo.test', 'Northwind Admin', pwHash);
  const adminMembership = await upsertMembership(c, admin, tenantId);
  await provisionTenantAdmin(handle, {
    tenantId,
    actingUserId: admin,
    membershipId: adminMembership,
    moduleKeys: modules,
  });

  const users: Record<string, SeededUser> = {};
  for (const [key, email, name] of [
    ['sales', 'sales@northwind-demo.test', 'Northwind Sales'],
    ['field', 'field@northwind-demo.test', 'Northwind Field'],
    ['hr', 'hr@northwind-demo.test', 'Northwind HR'],
    ['finance', 'finance@northwind-demo.test', 'Northwind Finance'],
  ] as const) {
    const userId = await upsertUser(c, email, name, pwHash);
    users[key] = { userId, membershipId: await upsertMembership(c, userId, tenantId), email };
  }

  const salesExec = await upsertConfiguredRole(c, {
    tenantId,
    key: 'SALES_EXECUTIVE',
    name: 'Sales Executive',
    description: 'Works leads, activities, follow-ups and qualification.',
    kind: 'profile',
    permissionKeys: [
      'crm.leads.read',
      'crm.leads.create',
      'crm.leads.update',
      'crm.leads.qualify',
      'crm.leads.followup',
      'crm.activities.read',
      'crm.activities.create',
      'customers.read',
    ],
    entitled,
  });
  const fieldAgent = await upsertConfiguredRole(c, {
    tenantId,
    key: 'FIELD_AGENT_PROFILE',
    name: 'Field Agent',
    description: 'Works assigned site visits: check-in/out, survey, photos.',
    kind: 'profile',
    permissionKeys: [
      'field.visits.read',
      'field.visits.checkin',
      'field.visits.survey',
      'field.visits.attachments',
      'field.visits.complete',
      'crm.leads.create',
    ],
    entitled,
  });
  const hrExec = await upsertConfiguredRole(c, {
    tenantId,
    key: 'HR_EXECUTIVE',
    name: 'HR Executive',
    description: 'Employee records, attendance and leave administration.',
    kind: 'profile',
    permissionKeys: [
      'hr.employee.read',
      'hr.employee.update',
      'hr.organization.read',
      'hr.attendance.read',
      'hr.attendance.manage',
      'hr.leave.read',
      'hr.leave.approve',
      'hr.expense.read',
    ],
    entitled,
  });
  const financeExec = await upsertConfiguredRole(c, {
    tenantId,
    key: 'FINANCE_EXECUTIVE',
    name: 'Finance Executive',
    description: 'Invoicing, payments and credit notes.',
    kind: 'profile',
    permissionKeys: [
      'finance.read',
      'finance.invoices.read',
      'finance.invoices.create',
      'finance.invoices.issue',
      'finance.payments.read',
      'finance.payments.create',
      'finance.payments.allocate',
      'finance.credit_notes.read',
    ],
    entitled,
  });

  const crmReadOnly = await upsertConfiguredRole(c, {
    tenantId,
    key: 'CRM_READ_ONLY',
    name: 'CRM Read Only',
    description: 'Read-only visibility of leads, activities and customers.',
    kind: 'permission_set',
    permissionKeys: ['crm.leads.read', 'crm.activities.read', 'customers.read'],
    entitled,
  });
  const hrAttendanceRead = await upsertConfiguredRole(c, {
    tenantId,
    key: 'HR_ATTENDANCE_READ',
    name: 'HR Attendance Read',
    description: 'Read-only visibility of attendance.',
    kind: 'permission_set',
    permissionKeys: ['hr.attendance.read'],
    entitled,
  });
  await upsertConfiguredRole(c, {
    tenantId,
    key: 'FINANCE_READ_ONLY',
    name: 'Finance Read Only',
    description: 'Read-only visibility of invoices and payments.',
    kind: 'permission_set',
    permissionKeys: ['finance.read', 'finance.invoices.read', 'finance.payments.read'],
    entitled,
  });

  await assignProfile(c, tenantId, users.sales!.membershipId, salesExec.roleId, 'TEAM');
  await assignProfile(c, tenantId, users.field!.membershipId, fieldAgent.roleId, 'OWN');
  await assignProfile(c, tenantId, users.hr!.membershipId, hrExec.roleId, 'COMPANY');
  await assignProfile(c, tenantId, users.finance!.membershipId, financeExec.roleId, 'DEPARTMENT');
  await addPermissionSet(c, tenantId, users.sales!.membershipId, crmReadOnly.roleId);
  await addPermissionSet(c, tenantId, users.hr!.membershipId, hrAttendanceRead.roleId);

  console.warn('[seed-platform-demo] Company A: northwind-demo — 7 modules');
}

async function seedCompanyB(handle: DbHandle, c: PoolClient, pwHash: string): Promise<void> {
  const tenantId = await upsertTenant(c, 'southbridge-demo', 'Southbridge Retail (Demo)');
  const modules: ModuleKey[] = ['CRM', 'SUPPLY'];
  const entitled = new Set(modules);

  const admin = await upsertUser(c, 'admin@southbridge-demo.test', 'Southbridge Admin', pwHash);
  const adminMembership = await upsertMembership(c, admin, tenantId);
  await provisionTenantAdmin(handle, {
    tenantId,
    actingUserId: admin,
    membershipId: adminMembership,
    moduleKeys: modules,
  });

  const salesUserId = await upsertUser(
    c,
    'sales@southbridge-demo.test',
    'Southbridge Sales',
    pwHash,
  );
  const salesMembership = await upsertMembership(c, salesUserId, tenantId);
  const invUserId = await upsertUser(
    c,
    'inventory@southbridge-demo.test',
    'Southbridge Inventory',
    pwHash,
  );
  const invMembership = await upsertMembership(c, invUserId, tenantId);

  const salesExec = await upsertConfiguredRole(c, {
    tenantId,
    key: 'SALES_EXECUTIVE',
    name: 'Sales Executive',
    description: 'Works leads, activities, follow-ups and qualification.',
    kind: 'profile',
    permissionKeys: [
      'crm.leads.read',
      'crm.leads.create',
      'crm.leads.update',
      'crm.leads.qualify',
      'crm.activities.read',
      'crm.activities.create',
      'customers.read',
    ],
    entitled,
  });
  const inventoryUser = await upsertConfiguredRole(c, {
    tenantId,
    key: 'INVENTORY_USER',
    name: 'Inventory User',
    description: 'Products, warehouses and stock visibility and adjustment.',
    kind: 'profile',
    permissionKeys: [
      'products.read',
      'suppliers.read',
      'warehouses.read',
      'inventory.read',
      'inventory.adjust',
      'inventory.transfer',
      'procurement.read',
      'dispatch.read',
    ],
    entitled,
  });
  const crmReadOnly = await upsertConfiguredRole(c, {
    tenantId,
    key: 'CRM_READ_ONLY',
    name: 'CRM Read Only',
    description: 'Read-only visibility of leads, activities and customers.',
    kind: 'permission_set',
    permissionKeys: ['crm.leads.read', 'crm.activities.read', 'customers.read'],
    entitled,
  });

  // Demonstrate the rule: an HR profile CANNOT be configured for Company B —
  // every hr.* permission is dropped because HR is not entitled.
  const attemptedHrProfile = await upsertConfiguredRole(c, {
    tenantId,
    key: 'HR_EXECUTIVE_ATTEMPT',
    name: 'HR Executive (not available)',
    description: 'Illustrates that HR permissions cannot be configured without the HR module.',
    kind: 'profile',
    permissionKeys: ['hr.employee.read', 'hr.attendance.read', 'hr.leave.approve'],
    entitled,
  });

  await assignProfile(c, tenantId, salesMembership, salesExec.roleId, 'TEAM');
  await assignProfile(c, tenantId, invMembership, inventoryUser.roleId, 'COMPANY');
  await addPermissionSet(c, tenantId, salesMembership, crmReadOnly.roleId);

  console.warn(
    `[seed-platform-demo] Company B: southbridge-demo — 2 modules (CRM, SUPPLY); ` +
      `HR profile attempt granted ${attemptedHrProfile.granted.length} of 3 permissions ` +
      `(dropped: ${attemptedHrProfile.skipped.join(', ') || 'none'})`,
  );
}

async function main(): Promise<void> {
  const handle = createDb({ poolMax: 3 });
  const c = await handle.pool.connect();
  try {
    await seedPermissions(handle);
    const pwHash = await argon2Hash(PASSWORD, { algorithm: ARGON2ID });

    // Global platform administrator — no tenant membership.
    const platformAdminUserId = await upsertUser(
      c,
      'platform-admin@aivoryx.test',
      'Aivoryx Platform Admin',
      pwHash,
    );
    await c.query(
      `insert into platform_admins (id, user_id, note)
       values ($1, $2, 'seed:platform-demo')
       on conflict (user_id) do nothing`,
      [newUuidV7(), platformAdminUserId],
    );

    await seedCompanyA(handle, c, pwHash);
    await seedCompanyB(handle, c, pwHash);

    console.warn(
      '[seed-platform-demo] platform admin: platform-admin@aivoryx.test / Demo-Passw0rd!',
    );
    console.warn('[seed-platform-demo] every login password: Demo-Passw0rd!');
    console.warn('[seed-platform-demo] done.');
  } finally {
    c.release();
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-platform-demo] failed:', err);
  process.exit(1);
});
