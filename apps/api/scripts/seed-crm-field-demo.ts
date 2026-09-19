/**
 * Phase 18 — CRM ↔ Field ↔ Commercial demo seed. Additive and idempotent: it only
 * decorates the existing clans-demo leads/quotations (from `seed:commercial-demo`
 * and `seed:field-demo`) and is safe to rerun. Requires those seeds first.
 *
 *   Usage: `pnpm --filter @aivoryx/api run seed:crm-field-demo`
 *
 * Demonstrates, for a workspace with CRM + Field + Commercial (+ Execution):
 *   lead → qualified → completed site visit with outcome → quotation referencing it → project
 *
 *  - "Quotation Demo — Rao": QUALIFIED; COMPLETED visit, outcome SUITABLE; the demo
 *    quotation Q-QB-DEMO-1 is prepared FROM that visit.
 *  - "Quotation Demo — Kunal": COMPLETED visit, outcome FOLLOW_UP_REQUIRED, with the
 *    CRM follow-up that completing it creates.
 *  - "Quotation Demo — Menon" already has a BOOKED quotation + project (commercial
 *    seed); it gets a completed visit so the whole chain is navigable.
 *
 * Other module combinations need no data: the southbridge-demo workspace (CRM +
 * Supply) shows CRM with no Field/Commercial UI; northwind-demo has every module.
 */
import { createDb, newUuidV7 } from '@aivoryx/db';

const MARK = 'demo:p18';

async function main(): Promise<void> {
  const handle = createDb({ poolMax: 2 });
  const c = await handle.pool.connect();
  try {
    const tenantId = (
      await c.query<{ id: string }>(`select id from tenants where slug='clans-demo'`)
    ).rows[0]?.id;
    if (!tenantId) throw new Error('clans-demo not found — run the earlier demo seeds first');

    const member = async (email: string) =>
      (
        await c.query<{ id: string }>(
          `select m.id from user_tenant_memberships m join users u on u.id=m.user_id
           where m.tenant_id=$1 and u.email=$2`,
          [tenantId, email],
        )
      ).rows[0]?.id;
    const adminId = await member('admin@clans-demo.test');
    const agentId = await member('agent@clans-demo.test');
    if (!adminId || !agentId) throw new Error('demo admin/agent missing — run seed:field-demo');

    const lead = async (name: string) =>
      (
        await c.query<{ id: string; status: string }>(
          `select id, status from leads where tenant_id=$1 and name=$2`,
          [tenantId, name],
        )
      ).rows[0];
    const rao = await lead('Quotation Demo — Rao');
    const kunal = await lead('Quotation Demo — Kunal');
    const menon = await lead('Quotation Demo — Menon');
    if (!rao || !kunal || !menon) throw new Error('demo leads missing — run seed:commercial-demo');

    await c.query('begin');
    await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    await c.query(`select set_config('app.user_id', $1, true)`, [adminId]);

    const log: string[] = [];

    /** A COMPLETED visit for the lead, once (keyed by our marker in the outcome note). */
    async function completedVisit(
      leadId: string,
      outcome: string,
      note: string,
      daysAgo: number,
    ): Promise<string> {
      const existing = await c.query<{ id: string }>(
        `select id from visits where tenant_id=$1 and lead_id=$2 and outcome_note like $3`,
        [tenantId, leadId, `%(${MARK})`],
      );
      if (existing.rows[0]) return existing.rows[0].id;
      const id = newUuidV7();
      const at = new Date(Date.now() - daysAgo * 86_400_000);
      const out = new Date(at.getTime() + 90 * 60_000);
      await c.query(
        `insert into visits
           (id, tenant_id, lead_id, assigned_membership_id, status, scheduled_at,
            check_in_at, check_out_at, survey_completed_at, outcome, outcome_note,
            created_by_membership_id)
         values ($1,$2,$3,$4,'COMPLETED',$5,$5,$6,$6,$7::visit_outcome,$8,$9)`,
        [id, tenantId, leadId, agentId, at, out, outcome, `${note} (${MARK})`, adminId],
      );
      for (const [type, when, payload] of [
        ['visit_scheduled', at, { visitId: id }],
        ['visit_completed', out, { visitId: id, outcome }],
      ] as const) {
        await c.query(
          `insert into lead_activities (id, tenant_id, lead_id, type, actor_membership_id, payload, created_at)
           values ($1,$2,$3,$4::lead_activity_type,$5,$6,$7)`,
          [newUuidV7(), tenantId, leadId, type, agentId, JSON.stringify(payload), when],
        );
      }
      log.push(`visit (${outcome}) for lead ${leadId.slice(0, 8)}`);
      return id;
    }

    // Rao: qualified, suitable site, quotation prepared from the visit
    if (rao.status !== 'QUALIFIED' && rao.status !== 'CONVERTED') {
      await c.query(`update leads set status='QUALIFIED', updated_at=now() where id=$1`, [rao.id]);
      log.push('lead Rao → QUALIFIED');
    }
    const raoVisit = await completedVisit(
      rao.id,
      'SUITABLE',
      'South-facing roof, clear of shade — ready for a quotation',
      6,
    );
    await c.query(
      `update quotations set visit_id=$1 where tenant_id=$2 and number='Q-QB-DEMO-1' and visit_id is null`,
      [raoVisit, tenantId],
    );

    // Kunal: follow-up required, with the CRM follow-up completion creates
    const kunalVisit = await completedVisit(
      kunal.id,
      'FOLLOW_UP_REQUIRED',
      'Owner wants to confirm the roof lease before proceeding',
      3,
    );
    const hasFollowup = await c.query(
      `select 1 from lead_followups where tenant_id=$1 and lead_id=$2 and note like $3`,
      [tenantId, kunal.id, `%(${MARK})`],
    );
    if (hasFollowup.rows.length === 0) {
      const fu = newUuidV7();
      await c.query(
        `insert into lead_followups (id, tenant_id, lead_id, assigned_membership_id, due_at, note)
         values ($1,$2,$3,$4,$5,$6)`,
        [
          fu,
          tenantId,
          kunal.id,
          adminId,
          new Date(Date.now() + 2 * 86_400_000),
          `Follow-up after site visit: roof lease (${MARK})`,
        ],
      );
      await c.query(
        `insert into lead_activities (id, tenant_id, lead_id, type, actor_membership_id, payload)
         values ($1,$2,$3,'followup_created',$4,$5)`,
        [
          newUuidV7(),
          tenantId,
          kunal.id,
          agentId,
          JSON.stringify({ followupId: fu, visitId: kunalVisit }),
        ],
      );
      log.push('follow-up for Kunal');
    }

    // Menon: already converted (booked quotation + project) — give it its site visit
    await completedVisit(
      menon.id,
      'SUITABLE',
      'Rooftop survey completed — proceeded to booking',
      20,
    );

    await c.query('commit');
    console.warn(
      log.length
        ? `[seed-crm-field-demo] added: ${log.join('; ')}`
        : '[seed-crm-field-demo] already up to date',
    );
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
