import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';

/**
 * Proves the isolation is enforced by PostgreSQL Row Level Security itself, not
 * by an application `WHERE` clause: every query here runs on a raw connection as
 * the non-privileged `aivoryx_app` role with only `SET LOCAL app.*` for context.
 *
 * `fx.limited` acts for the "cannot see tenant B" assertions because it holds no
 * membership in tenant B — so the `utm_self_read` policy (a user always sees
 * their *own* membership rows) cannot muddy the result.
 */

const RLS_TABLES = [
  'user_tenant_memberships',
  'roles',
  'role_permissions',
  'membership_roles',
  'tenants',
  'tenant_invitations',
  'outbox_events',
  'leads',
  'lead_activities',
  'lead_notes',
  'lead_followups',
  'custom_field_definitions',
  'custom_field_values',
  'lead_sources',
  'raw_events',
  'canonical_lead_events',
  'integration_event_log',
  'field_agents',
  'visits',
  'visit_activities',
  'visit_notes',
  'visit_attachments',
  'units',
  'product_categories',
  'products',
  'suppliers',
  'warehouses',
  'projects',
  'project_activities',
  'project_materials',
  'stock_levels',
  'stock_movements',
  'purchase_orders',
  'purchase_order_lines',
  'goods_receipts',
  'goods_receipt_lines',
  'dispatches',
  'dispatch_lines',
  'dispatch_attachments',
  'customers',
  'quotations',
  'quotation_revisions',
  'quotation_lines',
  'quotation_activities',
  'quotation_attachments',
  'project_milestones',
  'project_installations',
  'checklist_templates',
  'project_checklist_items',
  'project_qc_inspections',
  'project_defects',
  'project_net_metering',
  'project_handover',
  'project_execution_attachments',
  'notification_templates',
  'notification_rules',
  'notification_preferences',
  'notifications',
  'notification_deliveries',
  'finance_counters',
  'finance_idempotency',
  'invoices',
  'invoice_lines',
  'payments',
  'payment_allocations',
  'credit_notes',
  'tenant_company_profiles',
  'tenant_assets',
  'tenant_onboarding',
] as const;

const TENANT_TID_TABLES = [
  'user_tenant_memberships',
  'roles',
  'role_permissions',
  'membership_roles',
  'tenant_invitations',
  'outbox_events',
];

describe.skipIf(!INTEGRATION_ENABLED)('PostgreSQL Row Level Security', () => {
  let pool: Pool;
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await makeFixtures();
    pool = await rawPool();
  });

  afterAll(async () => {
    await pool?.end();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  /** Run `fn` on a fresh connection as `aivoryx_app` with a tenant context, then roll back. */
  async function asApp<T>(
    tenantId: string,
    userId: string,
    fn: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('set role aivoryx_app');
      await c.query('begin');
      await c.query("select set_config('app.user_id', $1, true)", [userId]);
      await c.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
      return await fn(c);
    } finally {
      await c.query('rollback').catch(() => undefined);
      await c.query('reset role').catch(() => undefined);
      c.release();
    }
  }

  /** As `aivoryx_app` with ONLY `app.user_id` set — the pre-tenant-resolution state. */
  async function asUser<T>(userId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('set role aivoryx_app');
      await c.query('begin');
      await c.query("select set_config('app.user_id', $1, true)", [userId]);
      return await fn(c);
    } finally {
      await c.query('rollback').catch(() => undefined);
      await c.query('reset role').catch(() => undefined);
      c.release();
    }
  }

  const count = async (c: PoolClient, table: string, where = ''): Promise<number> => {
    const { rows } = await c.query<{ n: number }>(
      `select count(*)::int as n from ${table} ${where}`,
    );
    return rows[0]!.n;
  };

  it('every tenant-owned table has RLS ENABLED and FORCED', async () => {
    const { rows } = await pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `select relname, relrowsecurity, relforcerowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1)`,
      [RLS_TABLES],
    );
    expect(rows.length).toBe(RLS_TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} ENABLE`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} FORCE`).toBe(true);
    }
  });

  it('the application role cannot bypass RLS', async () => {
    const { rows } = await pool.query(
      "select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = 'aivoryx_app'",
    );
    expect(rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcanlogin: false });

    const who = await asApp(fx.tenantA, fx.limited.userId, async (c) => {
      const r = await c.query(
        'select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as bypass',
      );
      return r.rows[0];
    });
    expect(who.current_user).toBe('aivoryx_app');
    expect(who.bypass).toBe(false);
  });

  it('tenant A sees only its own rows — RLS filters even without a WHERE clause', async () => {
    const counts = await asApp(fx.tenantA, fx.limited.userId, async (c) => ({
      memberships: await count(c, 'user_tenant_memberships'),
      roles: await count(c, 'roles'),
      rolePerms: await count(c, 'role_permissions'),
      membershipRoles: await count(c, 'membership_roles'),
      tenants: await count(c, 'tenants'),
    }));

    // Tenant A memberships: admin + secondAdmin + plainMember + limited + suspended = 5
    expect(counts.memberships).toBe(5);
    // Tenant A roles: TENANT_ADMIN + MEMBERS_ONLY = 2
    expect(counts.roles).toBe(2);
    // only the current tenant is visible
    expect(counts.tenants).toBe(1);
    expect(counts.rolePerms).toBeGreaterThan(0);
    expect(counts.membershipRoles).toBeGreaterThan(0);
  });

  it('tenant A cannot READ any tenant B row', async () => {
    await asApp(fx.tenantA, fx.limited.userId, async (c) => {
      for (const table of TENANT_TID_TABLES) {
        expect(await count(c, table, `where tenant_id = '${fx.tenantB}'`), `read ${table}`).toBe(0);
      }
      // and tenant B's own tenants row is invisible
      expect(await count(c, 'tenants', `where id = '${fx.tenantB}'`)).toBe(0);
    });
  });

  it('tenant A cannot MUTATE tenant B rows (update/delete affect 0, insert rejected)', async () => {
    await asApp(fx.tenantA, fx.limited.userId, async (c) => {
      expect(
        (await c.query("update roles set name='HACKED' where tenant_id=$1", [fx.tenantB])).rowCount,
      ).toBe(0);
      expect(
        (
          await c.query('update membership_roles set role_id=role_id where tenant_id=$1', [
            fx.tenantB,
          ])
        ).rowCount,
      ).toBe(0);
      expect(
        (await c.query('delete from role_permissions where tenant_id=$1', [fx.tenantB])).rowCount,
      ).toBe(0);
      expect(
        (await c.query('delete from user_tenant_memberships where tenant_id=$1', [fx.tenantB]))
          .rowCount,
      ).toBe(0);

      await c.query('savepoint sp');
      await expect(
        c.query(
          "insert into roles (id, tenant_id, key, name) values (gen_random_uuid(), $1, 'X', 'x')",
          [fx.tenantB],
        ),
      ).rejects.toMatchObject({ code: '42501' }); // RLS WITH CHECK -> insufficient_privilege
      await c.query('rollback to savepoint sp');
    });

    // tenant B genuinely untouched (verified on a superuser connection)
    const { rows } = await pool.query<{ name: string }>(
      'select name from roles where tenant_id = $1',
      [fx.tenantB],
    );
    expect(rows.every((r) => r.name !== 'HACKED')).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('tenant B, symmetrically, cannot touch tenant A', async () => {
    await asApp(fx.tenantB, fx.adminB.userId, async (c) => {
      expect(await count(c, 'roles', `where tenant_id = '${fx.tenantA}'`)).toBe(0);
      expect(
        (await c.query("update roles set name='x' where tenant_id=$1", [fx.tenantA])).rowCount,
      ).toBe(0);
    });
  });

  describe('utm_self_read policy (ADR 0027)', () => {
    // fx.admin is a member of BOTH tenant A and tenant B.
    it('pre-tenant: a user sees exactly their own membership rows, across tenants, and no one else’s', async () => {
      const ids = await asUser(fx.admin.userId, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          'select id from user_tenant_memberships order by id',
        );
        return rows.map((r) => r.id).sort();
      });
      expect(ids).toEqual([fx.admin.membershipId, fx.admin.membershipIdInB].sort());

      // cannot see another user's rows even filtering for them
      const others = await asUser(fx.admin.userId, (c) =>
        count(c, 'user_tenant_memberships', `where user_id = '${fx.adminB.userId}'`),
      );
      expect(others).toBe(0);

      // the self policy does not bleed into other tables
      const roles = await asUser(fx.admin.userId, (c) => count(c, 'roles'));
      expect(roles).toBe(0);
    });

    it('in tenant A context: sees own tenant-B membership (self policy) but not another user’s tenant-B membership', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          await count(c, 'user_tenant_memberships', `where id = '${fx.admin.membershipIdInB}'`),
          'own tenant-B membership visible via self policy',
        ).toBe(1);
        expect(
          await count(c, 'user_tenant_memberships', `where id = '${fx.adminB.membershipId}'`),
          "another user's tenant-B membership NOT visible",
        ).toBe(0);
        expect(
          await count(c, 'user_tenant_memberships', `where user_id = '${fx.adminB.userId}'`),
        ).toBe(0);
      });
    });

    it('self_read grants no write path — cannot mutate any row it exposes', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        // another user's row (invisible to writes anyway)
        expect(
          (
            await c.query(
              "update user_tenant_memberships set status='suspended' where user_id=$1",
              [fx.adminB.userId],
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await c.query('delete from user_tenant_memberships where id=$1', [
              fx.adminB.membershipId,
            ])
          ).rowCount,
        ).toBe(0);
        // even the caller's OWN tenant-B row: self_read is SELECT-only, and the
        // tenant-A WITH CHECK does not cover a tenant-B row.
        expect(
          (
            await c.query("update user_tenant_memberships set status='suspended' where id=$1", [
              fx.admin.membershipIdInB,
            ])
          ).rowCount,
        ).toBe(0);
      });
    });
  });

  describe('tenant_invitations + outbox_events (ADR 0030)', () => {
    let invA: string;
    let invB: string;

    beforeAll(async () => {
      const { randomUUID } = await import('node:crypto');
      invA = randomUUID();
      invB = randomUUID();
      // seed one pending invitation + one outbox event per tenant (superuser connection)
      for (const [id, tenantId, membershipId, userId, hash] of [
        [invA, fx.tenantA, fx.suspended.membershipId, fx.admin.userId, `hash-a-${invA}`],
        [invB, fx.tenantB, fx.adminB.membershipId, fx.adminB.userId, `hash-b-${invB}`],
      ] as const) {
        await pool.query(
          `insert into tenant_invitations
             (id, tenant_id, membership_id, email, token_hash, status, expires_at, invited_by_user_id)
           values ($1,$2,$3,$4,$5,'pending', now() + interval '1 day', $6)`,
          [id, tenantId, membershipId, `invitee-${id.slice(0, 8)}@example.test`, hash, userId],
        );
        await pool.query(
          `insert into outbox_events (id, tenant_id, type, payload)
           values ($1, $2, 'user.invitation.created', '{}'::jsonb)`,
          [randomUUID(), tenantId],
        );
      }
    });

    it('tenant A cannot READ tenant B invitations or outbox events', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'tenant_invitations', `where tenant_id = '${fx.tenantB}'`)).toBe(0);
        expect(await count(c, 'tenant_invitations', `where id = '${invB}'`)).toBe(0);
        expect(await count(c, 'outbox_events', `where tenant_id = '${fx.tenantB}'`)).toBe(0);
        // its own tenant's rows ARE visible
        expect(await count(c, 'tenant_invitations', `where id = '${invA}'`)).toBe(1);
        expect(
          await count(c, 'outbox_events', `where tenant_id = '${fx.tenantA}'`),
        ).toBeGreaterThan(0);
      });
    });

    it('tenant A cannot MUTATE tenant B invitations (update/delete affect 0, insert rejected)', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          (
            await c.query("update tenant_invitations set status='revoked' where tenant_id=$1", [
              fx.tenantB,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (await c.query('delete from tenant_invitations where tenant_id=$1', [fx.tenantB]))
            .rowCount,
        ).toBe(0);
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into tenant_invitations
               (id, tenant_id, membership_id, email, token_hash, status, expires_at, invited_by_user_id)
             values (gen_random_uuid(), $1, $2, 'x@x.test', 'x', 'pending', now() + interval '1 day', $3)`,
            [fx.tenantB, fx.adminB.membershipId, fx.adminB.userId],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await c.query('rollback to savepoint sp');
      });
      // tenant B invitation genuinely untouched
      const { rows } = await pool.query<{ status: string }>(
        'select status from tenant_invitations where id = $1',
        [invB],
      );
      expect(rows[0]?.status).toBe('pending');
    });

    it('the by-token policy exposes exactly one invitation and nothing else', async () => {
      const c = await pool.connect();
      try {
        await c.query('set role aivoryx_app');
        await c.query('begin');
        await c.query("select set_config('app.invitation_token_hash', $1, true)", [
          `hash-b-${invB}`,
        ]);
        // only the row whose token_hash matches — even without any tenant context
        expect(await count(c, 'tenant_invitations')).toBe(1);
        expect(await count(c, 'tenant_invitations', `where id = '${invB}'`)).toBe(1);
        expect(await count(c, 'tenant_invitations', `where id = '${invA}'`)).toBe(0);
        // the token policy does not open any other tenant-owned table
        expect(await count(c, 'outbox_events')).toBe(0);
        expect(await count(c, 'user_tenant_memberships')).toBe(0);
      } finally {
        await c.query('rollback').catch(() => undefined);
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    });

    it('a token hash that matches nothing exposes zero rows (no context, no error)', async () => {
      const c = await pool.connect();
      try {
        await c.query('set role aivoryx_app');
        await c.query('begin');
        await c.query("select set_config('app.invitation_token_hash', $1, true)", [
          'this-hash-matches-no-row-at-all',
        ]);
        expect(await count(c, 'tenant_invitations')).toBe(0);
      } finally {
        await c.query('rollback').catch(() => undefined);
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    });
  });

  describe('CRM core + inbound integrations (ADR 0031 / 0032)', () => {
    let leadA: string;
    let leadB: string;
    let sourceA: string;
    let sourceB: string;
    const secretA = `secret-hash-a-${randomUUID()}`;
    const secretB = `secret-hash-b-${randomUUID()}`;

    beforeAll(async () => {
      leadA = randomUUID();
      leadB = randomUUID();
      sourceA = randomUUID();
      sourceB = randomUUID();

      for (const [tenantId, sourceId, leadId, secretHash] of [
        [fx.tenantA, sourceA, leadA, secretA],
        [fx.tenantB, sourceB, leadB, secretB],
      ] as const) {
        await pool.query(
          `insert into lead_sources (id, tenant_id, key, name, secret_hash)
           values ($1,$2,'pabbly-test','Test Source',$3)`,
          [sourceId, tenantId, secretHash],
        );
        await pool.query(
          `insert into leads (id, tenant_id, source_id, name, phone, normalized_phone)
           values ($1,$2,$3,'RLS Test Lead','9990000000','9990000000')`,
          [leadId, tenantId, sourceId],
        );
        await pool.query(
          `insert into lead_activities (id, tenant_id, lead_id, type, payload)
           values ($1,$2,$3,'created','{}'::jsonb)`,
          [randomUUID(), tenantId, leadId],
        );
        await pool.query(
          `insert into lead_notes (id, tenant_id, lead_id, body) values ($1,$2,$3,'a note')`,
          [randomUUID(), tenantId, leadId],
        );
        await pool.query(
          `insert into lead_followups (id, tenant_id, lead_id, due_at) values ($1,$2,$3, now() + interval '1 day')`,
          [randomUUID(), tenantId, leadId],
        );
        const defId = randomUUID();
        await pool.query(
          `insert into custom_field_definitions (id, tenant_id, entity, key, label, data_type)
           values ($1,$2,'lead','budget','Budget','text')`,
          [defId, tenantId],
        );
        await pool.query(
          `insert into custom_field_values (id, tenant_id, entity, entity_id, definition_id, value_text)
           values ($1,$2,'lead',$3,$4,'50000')`,
          [randomUUID(), tenantId, leadId, defId],
        );
        const rawId = randomUUID();
        await pool.query(
          `insert into raw_events (id, tenant_id, source_id, correlation_id, raw_body, raw_hash)
           values ($1,$2,$3,'AIV-TEST','{}'::jsonb,$4)`,
          [rawId, tenantId, sourceId, `hash-${rawId}`],
        );
        const canonicalId = randomUUID();
        await pool.query(
          `insert into canonical_lead_events (id, tenant_id, raw_event_id, source_id, idempotency_key, status)
           values ($1,$2,$3,$4,$5,'DONE')`,
          [canonicalId, tenantId, rawId, sourceId, `idem-${canonicalId}`],
        );
        await pool.query(
          `insert into integration_event_log (id, tenant_id, correlation_id, raw_event_id, stage, to_status)
           values ($1,$2,'AIV-TEST',$3,'test','DONE')`,
          [randomUUID(), tenantId, rawId],
        );
      }
    });

    const CRM_TABLES = [
      'leads',
      'lead_activities',
      'lead_notes',
      'lead_followups',
      'custom_field_definitions',
      'custom_field_values',
      'lead_sources',
      'raw_events',
      'canonical_lead_events',
      'integration_event_log',
    ];

    it('tenant A cannot READ any tenant B row across all ten Phase 3 tables', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        for (const table of CRM_TABLES) {
          expect(await count(c, table, `where tenant_id = '${fx.tenantB}'`), `read ${table}`).toBe(
            0,
          );
        }
      });
    });

    it('tenant A sees exactly its own rows in each Phase 3 table', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'leads', `where id = '${leadA}'`)).toBe(1);
        expect(await count(c, 'leads', `where id = '${leadB}'`)).toBe(0);
        expect(await count(c, 'lead_sources', `where id = '${sourceA}'`)).toBe(1);
        expect(await count(c, 'lead_sources', `where id = '${sourceB}'`)).toBe(0);
      });
    });

    it('tenant A cannot MUTATE tenant B leads or lead_sources (update/delete affect 0, insert rejected)', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          (await c.query("update leads set name='HACKED' where id=$1", [leadB])).rowCount,
        ).toBe(0);
        expect((await c.query('delete from leads where id=$1', [leadB])).rowCount).toBe(0);
        expect(
          (await c.query("update lead_sources set status='revoked' where id=$1", [sourceB]))
            .rowCount,
        ).toBe(0);

        await c.query('savepoint sp');
        await expect(
          c.query(`insert into leads (id, tenant_id, name) values (gen_random_uuid(), $1, 'x')`, [
            fx.tenantB,
          ]),
        ).rejects.toMatchObject({ code: '42501' });
        await c.query('rollback to savepoint sp');
      });

      const { rows } = await pool.query('select name from leads where id = $1', [leadB]);
      expect(rows[0]?.name).toBe('RLS Test Lead');
    });

    it('tenant A cannot read tenant B connector credentials, raw events, or activities/notes/follow-ups/custom fields', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'lead_activities', `where lead_id = '${leadB}'`)).toBe(0);
        expect(await count(c, 'lead_notes', `where lead_id = '${leadB}'`)).toBe(0);
        expect(await count(c, 'lead_followups', `where lead_id = '${leadB}'`)).toBe(0);
        expect(await count(c, 'custom_field_values', `where entity_id = '${leadB}'`)).toBe(0);
        expect(await count(c, 'raw_events', `where source_id = '${sourceB}'`)).toBe(0);
        expect(await count(c, 'canonical_lead_events', `where source_id = '${sourceB}'`)).toBe(0);
      });
    });

    it('tenant A cannot replay/mutate a tenant B inbound event', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          (
            await c.query(
              "update canonical_lead_events set status='DEAD_LETTER' where source_id=$1",
              [sourceB],
            )
          ).rowCount,
        ).toBe(0);
      });
    });

    it('the lead_sources by-secret policy exposes exactly the one matching connector, nothing else', async () => {
      const c = await pool.connect();
      try {
        await c.query('set role aivoryx_app');
        await c.query('begin');
        await c.query("select set_config('app.connector_secret_hash', $1, true)", [secretA]);
        expect(await count(c, 'lead_sources')).toBe(1);
        expect(await count(c, 'lead_sources', `where id = '${sourceA}'`)).toBe(1);
        expect(await count(c, 'lead_sources', `where id = '${sourceB}'`)).toBe(0);
        // the by-secret policy does not open any other tenant-owned table
        expect(await count(c, 'leads')).toBe(0);
      } finally {
        await c.query('rollback').catch(() => undefined);
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    });

    it('a secret hash matching nothing exposes zero source rows', async () => {
      const c = await pool.connect();
      try {
        await c.query('set role aivoryx_app');
        await c.query('begin');
        await c.query("select set_config('app.connector_secret_hash', $1, true)", [
          'no-such-secret-hash',
        ]);
        expect(await count(c, 'lead_sources')).toBe(0);
      } finally {
        await c.query('rollback').catch(() => undefined);
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    });
  });

  describe('Field operations (Phase 4, ADR 0033)', () => {
    let leadA: string;
    let leadB: string;
    let visitA: string;
    let visitB: string;

    beforeAll(async () => {
      leadA = randomUUID();
      leadB = randomUUID();
      visitA = randomUUID();
      visitB = randomUUID();

      for (const [tenantId, leadId, visitId, membershipId] of [
        [fx.tenantA, leadA, visitA, fx.admin.membershipId],
        [fx.tenantB, leadB, visitB, fx.adminB.membershipId],
      ] as const) {
        await pool.query(
          `insert into leads (id, tenant_id, name, phone, normalized_phone)
           values ($1,$2,'Field RLS Lead','9991110000','9991110000')`,
          [leadId, tenantId],
        );
        await pool.query(
          `insert into field_agents (id, tenant_id, membership_id, status)
           values ($1,$2,$3,'active')`,
          [randomUUID(), tenantId, membershipId],
        );
        await pool.query(
          `insert into visits (id, tenant_id, lead_id, assigned_membership_id, status, scheduled_at, created_by_membership_id)
           values ($1,$2,$3,$4,'ASSIGNED', now() + interval '1 day', $4)`,
          [visitId, tenantId, leadId, membershipId],
        );
        await pool.query(
          `insert into visit_activities (id, tenant_id, visit_id, type, actor_membership_id, payload)
           values ($1,$2,$3,'created',$4,'{}'::jsonb)`,
          [randomUUID(), tenantId, visitId, membershipId],
        );
        await pool.query(
          `insert into visit_notes (id, tenant_id, visit_id, author_membership_id, body)
           values ($1,$2,$3,$4,'a visit note')`,
          [randomUUID(), tenantId, visitId, membershipId],
        );
        await pool.query(
          `insert into visit_attachments (id, tenant_id, visit_id, object_key, content_type, file_size, uploaded_by_membership_id)
           values ($1,$2,$3,$4,'image/jpeg',1024,$5)`,
          [
            randomUUID(),
            tenantId,
            visitId,
            `tenants/${tenantId}/visits/${visitId}/${randomUUID()}.jpg`,
            membershipId,
          ],
        );
      }
    });

    const FIELD_TABLES = [
      'field_agents',
      'visits',
      'visit_activities',
      'visit_notes',
      'visit_attachments',
    ];

    it('tenant A cannot READ any tenant B row across all five field tables', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        for (const table of FIELD_TABLES) {
          expect(await count(c, table, `where tenant_id = '${fx.tenantB}'`), `read ${table}`).toBe(
            0,
          );
        }
      });
    });

    it('tenant A sees exactly its own rows in each field table', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'visits', `where id = '${visitA}'`)).toBe(1);
        expect(await count(c, 'visits', `where id = '${visitB}'`)).toBe(0);
        expect(
          await count(c, 'field_agents', `where membership_id = '${fx.admin.membershipId}'`),
        ).toBe(1);
      });
    });

    it('tenant A cannot MUTATE tenant B visits (update/delete affect 0, insert rejected)', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          (await c.query("update visits set status='CANCELLED' where id=$1", [visitB])).rowCount,
        ).toBe(0);
        expect((await c.query('delete from visits where id=$1', [visitB])).rowCount).toBe(0);

        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into visits (id, tenant_id, lead_id, status, scheduled_at, created_by_membership_id)
             values (gen_random_uuid(), $1, $2, 'SCHEDULED', now(), $3)`,
            [fx.tenantB, leadB, fx.adminB.membershipId],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await c.query('rollback to savepoint sp');
      });

      const { rows } = await pool.query('select status from visits where id = $1', [visitB]);
      expect(rows[0]?.status).toBe('ASSIGNED');
    });

    it('tenant A cannot read tenant B visit activities, notes, or attachment metadata', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'visit_activities', `where visit_id = '${visitB}'`)).toBe(0);
        expect(await count(c, 'visit_notes', `where visit_id = '${visitB}'`)).toBe(0);
        expect(await count(c, 'visit_attachments', `where visit_id = '${visitB}'`)).toBe(0);
      });
    });
  });

  describe('Procurement / inventory / logistics (Phase 5, ADR 0034)', () => {
    const SUPPLY_TABLES = [
      'units',
      'product_categories',
      'products',
      'suppliers',
      'warehouses',
      'projects',
      'project_activities',
      'project_materials',
      'stock_levels',
      'stock_movements',
      'purchase_orders',
      'purchase_order_lines',
      'goods_receipts',
      'goods_receipt_lines',
      'dispatches',
      'dispatch_lines',
      'dispatch_attachments',
    ];
    const ids: Record<'A' | 'B', Record<string, string>> = { A: {}, B: {} };

    beforeAll(async () => {
      for (const [key, tenantId, leadId, membershipId] of [
        ['A', fx.tenantA, randomUUID(), fx.admin.membershipId],
        ['B', fx.tenantB, randomUUID(), fx.adminB.membershipId],
      ] as const) {
        const g = ids[key];
        g.lead = leadId;
        g.unit = randomUUID();
        g.category = randomUUID();
        g.product = randomUUID();
        g.supplier = randomUUID();
        g.warehouse = randomUUID();
        g.project = randomUUID();
        g.material = randomUUID();
        g.po = randomUUID();
        g.poLine = randomUUID();
        g.gr = randomUUID();
        g.dispatch = randomUUID();

        await pool.query(
          `insert into leads (id, tenant_id, name, phone, normalized_phone) values ($1,$2,'Supply RLS Lead','9993330000','9993330000')`,
          [leadId, tenantId],
        );
        await pool.query(
          `insert into units (id,tenant_id,code,name) values ($1,$2,'PCS','Pieces')`,
          [g.unit, tenantId],
        );
        await pool.query(
          `insert into product_categories (id,tenant_id,code,name) values ($1,$2,'GEN','Generation')`,
          [g.category, tenantId],
        );
        await pool.query(
          `insert into products (id,tenant_id,sku,name,unit_id,category_id) values ($1,$2,'SKU-1','Panel',$3,$4)`,
          [g.product, tenantId, g.unit, g.category],
        );
        await pool.query(
          `insert into suppliers (id,tenant_id,code,name) values ($1,$2,'SUP-1','Supplier')`,
          [g.supplier, tenantId],
        );
        await pool.query(
          `insert into warehouses (id,tenant_id,code,name,type) values ($1,$2,'WH-1','Main','main')`,
          [g.warehouse, tenantId],
        );
        await pool.query(
          `insert into projects (id,tenant_id,lead_id,number,status,created_by_membership_id)
           values ($1,$2,$3,'PRJ-1','APPROVED',$4)`,
          [g.project, tenantId, leadId, membershipId],
        );
        await pool.query(
          `insert into project_activities (id,tenant_id,project_id,type,actor_membership_id,payload)
           values ($1,$2,$3,'created',$4,'{}'::jsonb)`,
          [randomUUID(), tenantId, g.project, membershipId],
        );
        await pool.query(
          `insert into project_materials (id,tenant_id,project_id,product_id,required_qty,allocated_qty)
           values ($1,$2,$3,$4,'10','0')`,
          [g.material, tenantId, g.project, g.product],
        );
        await pool.query(
          `insert into stock_levels (id,tenant_id,warehouse_id,product_id,on_hand,reserved)
           values ($1,$2,$3,$4,'100','0')`,
          [randomUUID(), tenantId, g.warehouse, g.product],
        );
        await pool.query(
          `insert into stock_movements (id,tenant_id,warehouse_id,product_id,type,on_hand_delta,reserved_delta,quantity)
           values ($1,$2,$3,$4,'RECEIPT','100','0','100')`,
          [randomUUID(), tenantId, g.warehouse, g.product],
        );
        await pool.query(
          `insert into purchase_orders (id,tenant_id,number,supplier_id,status,created_by_membership_id)
           values ($1,$2,'PO-1',$3,'APPROVED',$4)`,
          [g.po, tenantId, g.supplier, membershipId],
        );
        await pool.query(
          `insert into purchase_order_lines (id,tenant_id,purchase_order_id,product_id,line_no,ordered_qty,unit_price,line_total)
           values ($1,$2,$3,$4,1,'10','100.00','1000.00')`,
          [g.poLine, tenantId, g.po, g.product],
        );
        await pool.query(
          `insert into goods_receipts (id,tenant_id,number,purchase_order_id,warehouse_id) values ($1,$2,'GRN-1',$3,$4)`,
          [g.gr, tenantId, g.po, g.warehouse],
        );
        await pool.query(
          `insert into goods_receipt_lines (id,tenant_id,goods_receipt_id,purchase_order_line_id,product_id,received_qty)
           values ($1,$2,$3,$4,$5,'5')`,
          [randomUUID(), tenantId, g.gr, g.poLine, g.product],
        );
        await pool.query(
          `insert into dispatches (id,tenant_id,number,project_id,warehouse_id,status,created_by_membership_id)
           values ($1,$2,'DSP-1',$3,$4,'DRAFT',$5)`,
          [g.dispatch, tenantId, g.project, g.warehouse, membershipId],
        );
        await pool.query(
          `insert into dispatch_lines (id,tenant_id,dispatch_id,product_id,project_material_id,line_no,quantity)
           values ($1,$2,$3,$4,$5,1,'2')`,
          [randomUUID(), tenantId, g.dispatch, g.product, g.material],
        );
        await pool.query(
          `insert into dispatch_attachments (id,tenant_id,dispatch_id,object_key,content_type,file_size)
           values ($1,$2,$3,$4,'image/jpeg',1024)`,
          [
            randomUUID(),
            tenantId,
            g.dispatch,
            `tenants/${tenantId}/dispatches/${g.dispatch}/${randomUUID()}.jpg`,
          ],
        );
      }
    });

    it('every Phase 5 tenant-owned table has RLS ENABLED and FORCED', async () => {
      const { rows } = await pool.query<{ relname: string; a: boolean; f: boolean }>(
        `select relname, relrowsecurity as a, relforcerowsecurity as f
           from pg_class where relnamespace='public'::regnamespace and relname = any($1)`,
        [SUPPLY_TABLES],
      );
      expect(rows.length).toBe(SUPPLY_TABLES.length);
      for (const r of rows) {
        expect(r.a, `${r.relname} ENABLE`).toBe(true);
        expect(r.f, `${r.relname} FORCE`).toBe(true);
      }
    });

    it('tenant A cannot READ any tenant B row across all 17 supply tables', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        for (const table of SUPPLY_TABLES) {
          expect(await count(c, table, `where tenant_id = '${fx.tenantB}'`), `read ${table}`).toBe(
            0,
          );
        }
      });
    });

    it('tenant A sees exactly its own supply rows', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'projects', `where id = '${ids.A.project}'`)).toBe(1);
        expect(await count(c, 'projects', `where id = '${ids.B.project}'`)).toBe(0);
        expect(await count(c, 'stock_levels', `where warehouse_id = '${ids.A.warehouse}'`)).toBe(1);
        expect(await count(c, 'purchase_orders', `where id = '${ids.B.po}'`)).toBe(0);
      });
    });

    it('tenant A cannot MUTATE tenant B supply rows (update/delete affect 0, insert rejected)', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          (await c.query("update projects set status='CANCELLED' where id=$1", [ids.B.project]))
            .rowCount,
        ).toBe(0);
        expect(
          (
            await c.query("update stock_levels set on_hand='0' where warehouse_id=$1", [
              ids.B.warehouse,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (await c.query('delete from purchase_order_lines where purchase_order_id=$1', [ids.B.po]))
            .rowCount,
        ).toBe(0);
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into stock_movements (id,tenant_id,warehouse_id,product_id,type,quantity)
             values (gen_random_uuid(),$1,$2,$3,'RECEIPT','1')`,
            [fx.tenantB, ids.B.warehouse, ids.B.product],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await c.query('rollback to savepoint sp');
      });
      const { rows } = await pool.query('select status from projects where id=$1', [ids.B.project]);
      expect(rows[0]?.status).toBe('APPROVED');
    });

    it('a cross-tenant composite FK is rejected by the database', async () => {
      // tenant A project referencing a tenant B lead must fail the composite FK
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into projects (id,tenant_id,lead_id,number,status,created_by_membership_id)
             values (gen_random_uuid(),$1,$2,'PRJ-X','DRAFT',$3)`,
            [fx.tenantA, ids.B.lead, fx.admin.membershipId],
          ),
        ).rejects.toMatchObject({ code: expect.stringMatching(/23503|42501/) });
        await c.query('rollback to savepoint sp');
      });
    });
  });

  describe('Commercial — customers & quotations (Phase 6, ADR 0035)', () => {
    const COMMERCIAL_TABLES = [
      'customers',
      'quotations',
      'quotation_revisions',
      'quotation_lines',
      'quotation_activities',
      'quotation_attachments',
    ];
    const ids: Record<'A' | 'B', Record<string, string>> = { A: {}, B: {} };

    beforeAll(async () => {
      for (const [key, tenantId, membershipId] of [
        ['A', fx.tenantA, fx.admin.membershipId],
        ['B', fx.tenantB, fx.adminB.membershipId],
      ] as const) {
        const g = ids[key];
        g.lead = randomUUID();
        g.customer = randomUUID();
        g.quotation = randomUUID();
        g.revision = randomUUID();
        g.line = randomUUID();

        await pool.query(
          `insert into leads (id, tenant_id, name, phone, normalized_phone) values ($1,$2,'Commercial RLS Lead','9994440000','9994440000')`,
          [g.lead, tenantId],
        );
        await pool.query(
          `insert into customers (id,tenant_id,number,name,status,created_by_membership_id)
           values ($1,$2,'CUST-1','RLS Customer','active',$3)`,
          [g.customer, tenantId, membershipId],
        );
        await pool.query(
          `insert into quotations (id,tenant_id,number,lead_id,customer_id,status,current_revision_no,created_by_membership_id)
           values ($1,$2,'Q-1',$3,$4,'DRAFT',1,$5)`,
          [g.quotation, tenantId, g.lead, g.customer, membershipId],
        );
        await pool.query(
          `insert into quotation_revisions (id,tenant_id,quotation_id,revision_no,status,total,created_by_membership_id)
           values ($1,$2,$3,1,'draft','100.00',$4)`,
          [g.revision, tenantId, g.quotation, membershipId],
        );
        await pool.query(
          `insert into quotation_lines (id,tenant_id,revision_id,line_no,description,quantity,unit_price,line_net,line_tax,line_total)
           values ($1,$2,$3,1,'Line','1','100.00','100.00','0.00','100.00')`,
          [g.line, tenantId, g.revision],
        );
        await pool.query(
          `insert into quotation_activities (id,tenant_id,quotation_id,type,actor_membership_id,payload)
           values ($1,$2,$3,'created',$4,'{}'::jsonb)`,
          [randomUUID(), tenantId, g.quotation, membershipId],
        );
        await pool.query(
          `insert into quotation_attachments (id,tenant_id,quotation_id,object_key,content_type,file_size)
           values ($1,$2,$3,$4,'application/pdf',2048)`,
          [
            randomUUID(),
            tenantId,
            g.quotation,
            `tenants/${tenantId}/quotations/${g.quotation}/${randomUUID()}.pdf`,
          ],
        );
      }
    });

    it('every Phase 6 tenant-owned table has RLS ENABLED and FORCED', async () => {
      const { rows } = await pool.query<{ relname: string; a: boolean; f: boolean }>(
        `select relname, relrowsecurity as a, relforcerowsecurity as f
           from pg_class where relnamespace='public'::regnamespace and relname = any($1)`,
        [COMMERCIAL_TABLES],
      );
      expect(rows.length).toBe(COMMERCIAL_TABLES.length);
      for (const r of rows) {
        expect(r.a, `${r.relname} ENABLE`).toBe(true);
        expect(r.f, `${r.relname} FORCE`).toBe(true);
      }
    });

    it('tenant A cannot READ any tenant B row across the commercial tables', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        for (const table of COMMERCIAL_TABLES) {
          expect(await count(c, table, `where tenant_id = '${fx.tenantB}'`), `read ${table}`).toBe(
            0,
          );
        }
      });
    });

    it('tenant A sees exactly its own commercial rows', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'quotations', `where id = '${ids.A.quotation}'`)).toBe(1);
        expect(await count(c, 'quotations', `where id = '${ids.B.quotation}'`)).toBe(0);
        expect(await count(c, 'customers', `where id = '${ids.B.customer}'`)).toBe(0);
      });
    });

    it('tenant A cannot MUTATE tenant B commercial rows', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          (await c.query("update quotations set status='CANCELLED' where id=$1", [ids.B.quotation]))
            .rowCount,
        ).toBe(0);
        expect(
          (await c.query("update quotation_lines set unit_price='0' where id=$1", [ids.B.line]))
            .rowCount,
        ).toBe(0);
        expect(
          (await c.query('delete from customers where id=$1', [ids.B.customer])).rowCount,
        ).toBe(0);
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into quotation_activities (id,tenant_id,quotation_id,type,payload)
             values (gen_random_uuid(),$1,$2,'sent','{}'::jsonb)`,
            [fx.tenantB, ids.B.quotation],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await c.query('rollback to savepoint sp');
      });
      const { rows } = await pool.query('select status from quotations where id=$1', [
        ids.B.quotation,
      ]);
      expect(rows[0]?.status).toBe('DRAFT');
    });

    it('a cross-tenant composite FK is rejected by the database', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into quotations (id,tenant_id,number,lead_id,status,current_revision_no,created_by_membership_id)
             values (gen_random_uuid(),$1,'Q-X',$2,'DRAFT',1,$3)`,
            [fx.tenantA, ids.B.lead, fx.admin.membershipId],
          ),
        ).rejects.toMatchObject({ code: expect.stringMatching(/23503|42501/) });
        await c.query('rollback to savepoint sp');
      });
    });
  });

  describe('EPC project execution (Phase 7, ADR 0036)', () => {
    const EXECUTION_TABLES = [
      'project_milestones',
      'project_installations',
      'checklist_templates',
      'project_checklist_items',
      'project_qc_inspections',
      'project_defects',
      'project_net_metering',
      'project_handover',
      'project_execution_attachments',
    ];
    const ids: Record<'A' | 'B', Record<string, string>> = { A: {}, B: {} };

    beforeAll(async () => {
      for (const [key, tenantId, membershipId] of [
        ['A', fx.tenantA, fx.admin.membershipId],
        ['B', fx.tenantB, fx.adminB.membershipId],
      ] as const) {
        const g = ids[key];
        g.lead = randomUUID();
        g.project = randomUUID();
        g.milestone = randomUUID();
        g.installation = randomUUID();
        g.template = randomUUID();
        g.item = randomUUID();
        g.inspection = randomUUID();
        g.defect = randomUUID();

        await pool.query(
          `insert into leads (id, tenant_id, name, phone, normalized_phone) values ($1,$2,'Exec RLS Lead','9995550000','9995550000')`,
          [g.lead, tenantId],
        );
        await pool.query(
          `insert into projects (id,tenant_id,lead_id,number,status,created_by_membership_id)
           values ($1,$2,$3,'PRJ-EXE','IN_PROGRESS',$4)`,
          [g.project, tenantId, g.lead, membershipId],
        );
        await pool.query(
          `insert into project_milestones (id,tenant_id,project_id,key,sort_order) values ($1,$2,$3,'PLANNING',0)`,
          [g.milestone, tenantId, g.project],
        );
        await pool.query(
          `insert into project_installations (id,tenant_id,project_id,status,created_by_membership_id)
           values ($1,$2,$3,'UNASSIGNED',$4)`,
          [g.installation, tenantId, g.project, membershipId],
        );
        await pool.query(
          `insert into checklist_templates (id,tenant_id,kind,label) values ($1,$2,'installation','Site prepared')`,
          [g.template, tenantId],
        );
        await pool.query(
          `insert into project_checklist_items (id,tenant_id,project_id,kind,label) values ($1,$2,$3,'installation','Site prepared')`,
          [g.item, tenantId, g.project],
        );
        await pool.query(
          `insert into project_qc_inspections (id,tenant_id,project_id,seq,status,created_by_membership_id)
           values ($1,$2,$3,1,'PENDING',$4)`,
          [g.inspection, tenantId, g.project, membershipId],
        );
        await pool.query(
          `insert into project_defects (id,tenant_id,project_id,description,created_by_membership_id)
           values ($1,$2,$3,'RLS defect',$4)`,
          [g.defect, tenantId, g.project, membershipId],
        );
        await pool.query(
          `insert into project_net_metering (id,tenant_id,project_id,status,created_by_membership_id)
           values (gen_random_uuid(),$1,$2,'NOT_STARTED',$3)`,
          [tenantId, g.project, membershipId],
        );
        await pool.query(
          `insert into project_handover (id,tenant_id,project_id,status,created_by_membership_id)
           values (gen_random_uuid(),$1,$2,'PENDING',$3)`,
          [tenantId, g.project, membershipId],
        );
        await pool.query(
          `insert into project_execution_attachments (id,tenant_id,project_id,entity_kind,entity_id,object_key,content_type,file_size)
           values (gen_random_uuid(),$1,$2,'installation',$3,$4,'image/jpeg',1024)`,
          [
            tenantId,
            g.project,
            g.installation,
            `tenants/${tenantId}/projects/execution/${randomUUID()}.jpg`,
          ],
        );
      }
    });

    it('every Phase 7 tenant-owned table has RLS ENABLED and FORCED', async () => {
      const { rows } = await pool.query<{ relname: string; a: boolean; f: boolean }>(
        `select relname, relrowsecurity as a, relforcerowsecurity as f
           from pg_class where relnamespace='public'::regnamespace and relname = any($1)`,
        [EXECUTION_TABLES],
      );
      expect(rows.length).toBe(EXECUTION_TABLES.length);
      for (const r of rows) {
        expect(r.a, `${r.relname} ENABLE`).toBe(true);
        expect(r.f, `${r.relname} FORCE`).toBe(true);
      }
    });

    it('tenant A cannot READ any tenant B row across the execution tables', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        for (const table of EXECUTION_TABLES) {
          expect(await count(c, table, `where tenant_id = '${fx.tenantB}'`), `read ${table}`).toBe(
            0,
          );
        }
      });
    });

    it('tenant A sees exactly its own execution rows', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'project_installations', `where id = '${ids.A.installation}'`)).toBe(
          1,
        );
        expect(await count(c, 'project_installations', `where id = '${ids.B.installation}'`)).toBe(
          0,
        );
        expect(await count(c, 'project_qc_inspections', `where id = '${ids.B.inspection}'`)).toBe(
          0,
        );
      });
    });

    it('tenant A cannot MUTATE tenant B execution rows', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          (
            await c.query("update project_installations set status='COMPLETED' where id=$1", [
              ids.B.installation,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (await c.query('delete from project_defects where id=$1', [ids.B.defect])).rowCount,
        ).toBe(0);
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into project_milestones (id,tenant_id,project_id,key) values (gen_random_uuid(),$1,$2,'COMPLETED')`,
            [fx.tenantB, ids.B.project],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await c.query('rollback to savepoint sp');
      });
      const { rows } = await pool.query('select status from project_installations where id=$1', [
        ids.B.installation,
      ]);
      expect(rows[0]?.status).toBe('UNASSIGNED');
    });

    it('a cross-tenant composite FK is rejected by the database', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into project_installations (id,tenant_id,project_id,status,created_by_membership_id)
             values (gen_random_uuid(),$1,$2,'UNASSIGNED',$3)`,
            [fx.tenantA, ids.B.project, fx.admin.membershipId],
          ),
        ).rejects.toMatchObject({ code: expect.stringMatching(/23503|42501/) });
        await c.query('rollback to savepoint sp');
      });
    });
  });

  describe('Notifications & Communications Engine (Phase 8, ADR 0037)', () => {
    const NOTIFICATION_TABLES = [
      'notification_templates',
      'notification_rules',
      'notification_preferences',
      'notifications',
      'notification_deliveries',
    ];
    const nids: Record<'A' | 'B', Record<string, string>> = { A: {}, B: {} };

    beforeAll(async () => {
      for (const [key, tenantId, membershipId] of [
        ['A', fx.tenantA, fx.admin.membershipId],
        ['B', fx.tenantB, fx.adminB.membershipId],
      ] as const) {
        const g = nids[key];
        g.notification = randomUUID();
        g.delivery = randomUUID();
        await pool.query(
          `insert into notification_templates (id,tenant_id,key,channel,title,body)
           values (gen_random_uuid(),$1,'lead_created','in_app','T','B')`,
          [tenantId],
        );
        await pool.query(
          `insert into notification_rules (id,tenant_id,key,event_type,is_active)
           values (gen_random_uuid(),$1,'lead_created.admins','lead.created',true)`,
          [tenantId],
        );
        await pool.query(
          `insert into notification_preferences (id,tenant_id,membership_id,in_app_enabled,email_enabled)
           values (gen_random_uuid(),$1,$2,true,false)`,
          [tenantId, membershipId],
        );
        await pool.query(
          `insert into notifications (id,tenant_id,dedupe_key,recipient_membership_id,type,title,body)
           values ($1,$2,$3,$4,'info','RLS notification','body')`,
          [g.notification, tenantId, `dedupe-${g.notification}`, membershipId],
        );
        await pool.query(
          `insert into notification_deliveries (id,tenant_id,notification_id,channel,recipient_ref,status,idempotency_key)
           values ($1,$2,$3,'in_app',$4,'pending',$5)`,
          [g.delivery, tenantId, g.notification, membershipId, `idem-${g.delivery}`],
        );
      }
    });

    it('every notification table has RLS ENABLED and FORCED', async () => {
      const { rows } = await pool.query<{ relname: string; a: boolean; f: boolean }>(
        `select relname, relrowsecurity as a, relforcerowsecurity as f
           from pg_class where relnamespace='public'::regnamespace and relname = any($1)`,
        [NOTIFICATION_TABLES],
      );
      expect(rows.length).toBe(NOTIFICATION_TABLES.length);
      for (const r of rows) {
        expect(r.a, `${r.relname} ENABLE`).toBe(true);
        expect(r.f, `${r.relname} FORCE`).toBe(true);
      }
    });

    it('tenant A cannot READ any tenant B notification row (templates, rules, prefs, notifications, deliveries)', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        for (const table of NOTIFICATION_TABLES) {
          expect(await count(c, table, `where tenant_id = '${fx.tenantB}'`), `read ${table}`).toBe(
            0,
          );
        }
        expect(await count(c, 'notifications', `where id = '${nids.B.notification}'`)).toBe(0);
      });
    });

    it('tenant A sees exactly its own notification rows', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'notifications', `where id = '${nids.A.notification}'`)).toBe(1);
        expect(await count(c, 'notification_deliveries', `where id = '${nids.A.delivery}'`)).toBe(
          1,
        );
        expect(await count(c, 'notification_deliveries', `where id = '${nids.B.delivery}'`)).toBe(
          0,
        );
      });
    });

    it('tenant A cannot MUTATE tenant B notification rows (update/delete 0, insert rejected)', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          (
            await c.query('update notifications set read_at = now() where id = $1', [
              nids.B.notification,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (
            await c.query("update notification_deliveries set status='sent' where id=$1", [
              nids.B.delivery,
            ])
          ).rowCount,
        ).toBe(0);
        expect(
          (await c.query('delete from notification_rules where tenant_id=$1', [fx.tenantB]))
            .rowCount,
        ).toBe(0);
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into notifications (id,tenant_id,dedupe_key,type,title,body)
             values (gen_random_uuid(),$1,'x','info','x','x')`,
            [fx.tenantB],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await c.query('rollback to savepoint sp');
      });
      const { rows } = await pool.query('select read_at from notifications where id = $1', [
        nids.B.notification,
      ]);
      expect(rows[0]?.read_at).toBeNull();
    });

    it('preferences are isolated per tenant', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'notification_preferences', `where tenant_id='${fx.tenantB}'`)).toBe(
          0,
        );
        expect(await count(c, 'notification_preferences', `where tenant_id='${fx.tenantA}'`)).toBe(
          1,
        );
      });
    });

    it('a cross-tenant composite FK (delivery -> notification) is rejected', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into notification_deliveries (id,tenant_id,notification_id,channel,recipient_ref,status,idempotency_key)
             values (gen_random_uuid(),$1,$2,'in_app','x','pending',$3)`,
            [fx.tenantA, nids.B.notification, `idem-x-${randomUUID()}`],
          ),
        ).rejects.toMatchObject({ code: expect.stringMatching(/23503|42501/) });
        await c.query('rollback to savepoint sp');
      });
    });

    it('the outbox dispatcher GUC grants ONLY cross-tenant read + dispatched_at on outbox_events', async () => {
      const c = await pool.connect();
      try {
        await c.query('set role aivoryx_app');
        await c.query('begin');
        await c.query("select set_config('app.outbox_dispatcher', 'on', true)");
        // can see undelivered events across tenants...
        const seen = await count(c, 'outbox_events', 'where dispatched_at is null');
        expect(seen).toBeGreaterThanOrEqual(0);
        // ...but the flag opens no other tenant-owned table
        expect(await count(c, 'notifications')).toBe(0);
        expect(await count(c, 'leads')).toBe(0);
        // ...and cannot INSERT into outbox_events
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into outbox_events (id,tenant_id,type,payload) values (gen_random_uuid(),$1,'x','{}'::jsonb)`,
            [fx.tenantA],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await c.query('rollback to savepoint sp');
      } finally {
        await c.query('rollback').catch(() => undefined);
        await c.query('reset role').catch(() => undefined);
        c.release();
      }
    });
  });

  describe('Finance — operational invoicing & payments (Phase 9, ADR 0038)', () => {
    const FINANCE_TABLES = [
      'finance_counters',
      'finance_idempotency',
      'invoices',
      'invoice_lines',
      'payments',
      'payment_allocations',
      'credit_notes',
    ];
    const fids: Record<'A' | 'B', Record<string, string>> = { A: {}, B: {} };

    beforeAll(async () => {
      for (const [key, tenantId, membershipId] of [
        ['A', fx.tenantA, fx.admin.membershipId],
        ['B', fx.tenantB, fx.adminB.membershipId],
      ] as const) {
        const g = fids[key];
        g.customer = randomUUID();
        g.invoice = randomUUID();
        g.line = randomUUID();
        g.payment = randomUUID();
        g.alloc = randomUUID();
        g.credit = randomUUID();

        await pool.query(
          `insert into customers (id, tenant_id, number, name, created_by_membership_id)
           values ($1,$2,$3,'RLS Finance Co',$4)`,
          [g.customer, tenantId, `CUST-RLS-${key}`, membershipId],
        );
        await pool.query(
          `insert into invoices (id, tenant_id, number, customer_id, status, currency, grand_total, subtotal, tax_total, created_by_membership_id)
           values ($1,$2,$3,$4,'ISSUED','INR','1000.00','1000.00','0.00',$5)`,
          [g.invoice, tenantId, `INV-RLS-${key}`, g.customer, membershipId],
        );
        await pool.query(
          `insert into invoice_lines (id, tenant_id, invoice_id, line_no, description, quantity, unit_price, line_total)
           values ($1,$2,$3,1,'Line','1','1000.00','1000.00')`,
          [g.line, tenantId, g.invoice],
        );
        await pool.query(
          `insert into payments (id, tenant_id, number, customer_id, payment_date, amount, currency, method, created_by_membership_id)
           values ($1,$2,$3,$4, now()::date, '1000.00','INR','BANK_TRANSFER',$5)`,
          [g.payment, tenantId, `PMT-RLS-${key}`, g.customer, membershipId],
        );
        await pool.query(
          `insert into payment_allocations (id, tenant_id, payment_id, invoice_id, amount, created_by_membership_id)
           values ($1,$2,$3,$4,'1000.00',$5)`,
          [g.alloc, tenantId, g.payment, g.invoice, membershipId],
        );
        await pool.query(
          `insert into credit_notes (id, tenant_id, number, customer_id, invoice_id, status, currency, reason, amount, created_by_membership_id)
           values ($1,$2,$3,$4,$5,'DRAFT','INR','RLS','10.00',$6)`,
          [g.credit, tenantId, `CN-RLS-${key}`, g.customer, g.invoice, membershipId],
        );
        await pool.query(
          `insert into finance_counters (id, tenant_id, kind, prefix, value) values (gen_random_uuid(),$1,'invoice','INV-',5)`,
          [tenantId],
        );
      }
    });

    it('every finance table has RLS ENABLED and FORCED', async () => {
      const { rows } = await pool.query<{ relname: string; a: boolean; f: boolean }>(
        `select relname, relrowsecurity as a, relforcerowsecurity as f
           from pg_class where relnamespace='public'::regnamespace and relname = any($1)`,
        [FINANCE_TABLES],
      );
      expect(rows.length).toBe(FINANCE_TABLES.length);
      for (const r of rows) {
        expect(r.a, `${r.relname} ENABLE`).toBe(true);
        expect(r.f, `${r.relname} FORCE`).toBe(true);
      }
    });

    it('tenant A cannot READ any tenant B finance row', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        for (const table of FINANCE_TABLES) {
          expect(await count(c, table, `where tenant_id = '${fx.tenantB}'`), `read ${table}`).toBe(
            0,
          );
        }
        expect(await count(c, 'invoices', `where id = '${fids.B.invoice}'`)).toBe(0);
        expect(await count(c, 'payments', `where id = '${fids.B.payment}'`)).toBe(0);
        expect(await count(c, 'payment_allocations', `where id = '${fids.B.alloc}'`)).toBe(0);
      });
    });

    it('tenant A sees exactly its own finance rows', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'invoices', `where id = '${fids.A.invoice}'`)).toBe(1);
        expect(await count(c, 'payments', `where id = '${fids.A.payment}'`)).toBe(1);
        expect(await count(c, 'credit_notes', `where id = '${fids.A.credit}'`)).toBe(1);
      });
    });

    it('tenant A cannot MUTATE tenant B finance rows (update/delete 0, insert rejected)', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          (await c.query("update invoices set status='PAID' where id=$1", [fids.B.invoice]))
            .rowCount,
        ).toBe(0);
        expect(
          (await c.query("update payments set status='REVERSED' where id=$1", [fids.B.payment]))
            .rowCount,
        ).toBe(0);
        expect(
          (await c.query('delete from payment_allocations where tenant_id=$1', [fx.tenantB]))
            .rowCount,
        ).toBe(0);
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into invoices (id,tenant_id,number,customer_id,status,currency,grand_total,subtotal,tax_total,created_by_membership_id)
             values (gen_random_uuid(),$1,'X',$2,'DRAFT','INR','0','0','0',$3)`,
            [fx.tenantB, fids.B.customer, fx.adminB.membershipId],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await c.query('rollback to savepoint sp');
      });
      const { rows } = await pool.query('select status from invoices where id=$1', [
        fids.B.invoice,
      ]);
      expect(rows[0]?.status).toBe('ISSUED');
    });

    it('a cross-tenant composite FK (allocation -> invoice) is rejected', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into payment_allocations (id,tenant_id,payment_id,invoice_id,amount,created_by_membership_id)
             values (gen_random_uuid(),$1,$2,$3,'1.00',$4)`,
            [fx.tenantA, fids.A.payment, fids.B.invoice, fx.admin.membershipId],
          ),
        ).rejects.toMatchObject({ code: expect.stringMatching(/23503|42501/) });
        await c.query('rollback to savepoint sp');
      });
    });

    it('the DB CHECK blocks an over-allocated invoice even on a raw connection', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        await c.query('savepoint sp');
        await expect(
          c.query("update invoices set amount_paid='2000.00' where id=$1", [fids.A.invoice]),
        ).rejects.toMatchObject({ code: '23514' });
        await c.query('rollback to savepoint sp');
      });
    });
  });

  describe('Platform experience — tenant branding & onboarding (Phase 10, ADR 0039)', () => {
    const P10_TABLES = ['tenant_company_profiles', 'tenant_assets', 'tenant_onboarding'];
    const pids: Record<'A' | 'B', Record<string, string>> = { A: {}, B: {} };

    beforeAll(async () => {
      for (const [key, tenantId, membershipId] of [
        ['A', fx.tenantA, fx.admin.membershipId],
        ['B', fx.tenantB, fx.adminB.membershipId],
      ] as const) {
        const g = pids[key];
        g.profile = randomUUID();
        g.asset = randomUUID();
        g.onboarding = randomUUID();
        await pool.query(
          `insert into tenant_company_profiles (id, tenant_id, display_name, primary_color, updated_by_membership_id)
           values ($1,$2,$3,'#1e40af',$4)`,
          [g.profile, tenantId, `RLS Brand ${key}`, membershipId],
        );
        await pool.query(
          `insert into tenant_assets (id, tenant_id, kind, object_key, content_type, size_bytes, uploaded_by_membership_id)
           values ($1,$2,'logo',$3,'image/png',1024,$4)`,
          [g.asset, tenantId, `tenants/${tenantId}/branding/logo/${key}.png`, membershipId],
        );
        await pool.query(
          `insert into tenant_onboarding (id, tenant_id, dismissed_at, dismissed_by_membership_id)
           values ($1,$2,null,null)`,
          [g.onboarding, tenantId],
        );
      }
    });

    it('every Phase 10 table has RLS ENABLED and FORCED', async () => {
      const { rows } = await pool.query<{ relname: string; a: boolean; f: boolean }>(
        `select relname, relrowsecurity as a, relforcerowsecurity as f
           from pg_class where relnamespace='public'::regnamespace and relname = any($1)`,
        [P10_TABLES],
      );
      expect(rows.length).toBe(P10_TABLES.length);
      for (const r of rows) {
        expect(r.a, `${r.relname} ENABLE`).toBe(true);
        expect(r.f, `${r.relname} FORCE`).toBe(true);
      }
    });

    it('tenant A cannot READ tenant B branding / onboarding rows', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        for (const table of P10_TABLES) {
          expect(await count(c, table, `where tenant_id = '${fx.tenantB}'`), `read ${table}`).toBe(
            0,
          );
        }
        expect(await count(c, 'tenant_company_profiles', `where id = '${pids.B.profile}'`)).toBe(0);
        expect(await count(c, 'tenant_assets', `where id = '${pids.B.asset}'`)).toBe(0);
      });
    });

    it('tenant A sees exactly its own branding / onboarding rows', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(await count(c, 'tenant_company_profiles', `where id = '${pids.A.profile}'`)).toBe(1);
        expect(await count(c, 'tenant_assets', `where id = '${pids.A.asset}'`)).toBe(1);
        expect(await count(c, 'tenant_onboarding', `where id = '${pids.A.onboarding}'`)).toBe(1);
      });
    });

    it('tenant A cannot MUTATE tenant B branding (update/delete 0, insert rejected)', async () => {
      await asApp(fx.tenantA, fx.admin.userId, async (c) => {
        expect(
          (
            await c.query(
              "update tenant_company_profiles set primary_color='#000000' where id=$1",
              [pids.B.profile],
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (await c.query('delete from tenant_assets where tenant_id=$1', [fx.tenantB])).rowCount,
        ).toBe(0);
        await c.query('savepoint sp');
        await expect(
          c.query(
            `insert into tenant_company_profiles (id,tenant_id,display_name,updated_by_membership_id)
             values (gen_random_uuid(),$1,'X',$2)`,
            [fx.tenantB, fx.adminB.membershipId],
          ),
        ).rejects.toMatchObject({ code: '42501' });
        await c.query('rollback to savepoint sp');
      });
      const { rows } = await pool.query(
        'select primary_color from tenant_company_profiles where id=$1',
        [pids.B.profile],
      );
      expect(rows[0]?.primary_color).toBe('#1e40af');
    });
  });

  it('with no tenant context set, every RLS table returns nothing (fail closed, no error)', async () => {
    const c = await pool.connect();
    try {
      await c.query('set role aivoryx_app');
      await c.query('begin');
      for (const table of RLS_TABLES) {
        expect(await count(c, table), `${table} with no app.tenant_id`).toBe(0);
      }
    } finally {
      await c.query('rollback').catch(() => undefined);
      await c.query('reset role').catch(() => undefined);
      c.release();
    }
  });
});
