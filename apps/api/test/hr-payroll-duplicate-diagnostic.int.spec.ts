import type { Pool } from 'pg';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';

/**
 * Read-only historical duplicate-payment assessment (no fix, no data
 * mutation — see CUSTOMER-LAUNCH-READINESS.md §1g).
 *
 * `hr_payroll_entry_components` (and the frozen `snapshot` JSONB on
 * `hr_payroll_entries`) carry NO stable foreign key back to the
 * `hr_incentives` / `hr_expense_reimbursements` row they were computed
 * from — only `kind`/`source`/`name`/`amount`. This means any audit of
 * payroll periods finalized *before* this session's reservation fix can
 * only ever produce a heuristic match (same employee + same kind/source/
 * name/amount across two distinct finalized periods), never a certain one.
 * This file validates that heuristic's query against synthetic fixtures
 * representing exactly the ambiguity that exists in real historical data —
 * it does not and cannot "fix" or re-identify historical rows.
 */
describe.skipIf(!INTEGRATION_ENABLED)(
  'HR payroll — historical duplicate-inclusion diagnostic',
  () => {
    let fx: Fixtures;
    let pool: Pool;

    beforeAll(async () => {
      fx = await makeFixtures();
      pool = await rawPool();
    });

    afterAll(async () => {
      await pool?.end();
    });

    const uniq = () => Math.random().toString(36).slice(2, 8).toUpperCase();

    /**
     * The diagnostic itself: candidate groups of payroll-entry components
     * that share (employee, kind, source, name, amount) across 2+ distinct
     * FINALIZED-or-later periods for one tenant, with payment evidence for
     * each contributing entry. Read-only — no writes.
     */
    async function findSuspectedDuplicateInclusions(tenantId: string) {
      const { rows: groups } = await pool.query(
        `select
         pe.employee_id,
         pec.kind,
         pec.source,
         pec.name,
         pec.amount,
         array_agg(distinct pe.payroll_period_id) as period_ids,
         array_agg(distinct pe.id) as entry_ids,
         count(distinct pe.payroll_period_id) as distinct_periods
       from hr_payroll_entry_components pec
       join hr_payroll_entries pe
         on pe.id = pec.payroll_entry_id and pe.tenant_id = pec.tenant_id
       join hr_payroll_periods pp
         on pp.id = pe.payroll_period_id and pp.tenant_id = pe.tenant_id
       where pec.tenant_id = $1
         and pec.source in ('incentive', 'reimbursement')
         and pp.status in ('FINALIZED','PAYMENT_PROCESSING','PARTIALLY_PAID','PAID')
       group by pe.employee_id, pec.kind, pec.source, pec.name, pec.amount
       having count(distinct pe.payroll_period_id) > 1`,
        [tenantId],
      );

      const findings: {
        employeeId: string;
        source: string;
        name: string;
        amount: string;
        periodIds: string[];
        entryIds: string[];
        classification:
          | 'SUSPECTED_DUPLICATE_PAYMENT'
          | 'SUSPECTED_DUPLICATE_INCLUSION_PAYMENT_UNCONFIRMED';
      }[] = [];

      for (const g of groups) {
        const { rows: paymentRows } = await pool.query(
          `select payroll_entry_id, bool_or(status = 'PAID') as any_paid
           from hr_payroll_payments
          where tenant_id = $1 and payroll_entry_id = any($2)
          group by payroll_entry_id`,
          [tenantId, g.entry_ids],
        );
        const paidByEntry = new Map(
          paymentRows.map((r: { payroll_entry_id: string; any_paid: boolean }) => [
            r.payroll_entry_id,
            r.any_paid,
          ]),
        );
        const allEntriesPaid = (g.entry_ids as string[]).every(
          (id) => paidByEntry.get(id) === true,
        );
        findings.push({
          employeeId: g.employee_id,
          source: g.source,
          name: g.name,
          amount: g.amount,
          periodIds: g.period_ids,
          entryIds: g.entry_ids,
          classification: allEntriesPaid
            ? 'SUSPECTED_DUPLICATE_PAYMENT'
            : 'SUSPECTED_DUPLICATE_INCLUSION_PAYMENT_UNCONFIRMED',
        });
      }
      return findings;
    }

    /** Minimal raw-SQL scaffolding to simulate historical (pre-fix) finalized
     *  payroll state — bypassing the now-fixed service, which would no
     *  longer allow this corrupted state to be created going forward. */
    async function makeEmployeeRaw(tenantId: string): Promise<string> {
      const id = (await pool.query('select gen_random_uuid() as id')).rows[0].id as string;
      await pool.query(
        `insert into hr_employees (id, tenant_id, employee_number, first_name, last_name, display_name, joining_date, employment_type, status)
       values ($1,$2,$3,'Test',$4,$5,'2025-01-01','FULL_TIME','ACTIVE')`,
        [id, tenantId, `E${uniq()}`, uniq(), `Test ${uniq()}`],
      );
      return id;
    }

    async function makePeriodRaw(tenantId: string, status: string): Promise<string> {
      const id = (await pool.query('select gen_random_uuid() as id')).rows[0].id as string;
      await pool.query(
        `insert into hr_payroll_periods (id, tenant_id, name, period_start, period_end, status)
       values ($1,$2,$3,'2025-06-01','2025-06-30',$4)`,
        [id, tenantId, `Diag ${uniq()}`, status],
      );
      return id;
    }

    async function makeEntryRaw(
      tenantId: string,
      periodId: string,
      employeeId: string,
      netPay: string,
    ): Promise<string> {
      const id = (await pool.query('select gen_random_uuid() as id')).rows[0].id as string;
      await pool.query(
        `insert into hr_payroll_entries
         (id, tenant_id, payroll_period_id, employee_id, employee_number, employee_name, net_pay, payment_status)
       values ($1,$2,$3,$4,'X','Test',$5,'PENDING')`,
        [id, tenantId, periodId, employeeId, netPay],
      );
      return id;
    }

    async function addComponentRaw(
      tenantId: string,
      entryId: string,
      kind: 'INCENTIVE' | 'REIMBURSEMENT',
      source: 'incentive' | 'reimbursement',
      name: string,
      amount: string,
    ): Promise<void> {
      await pool.query(
        `insert into hr_payroll_entry_components (id, tenant_id, payroll_entry_id, kind, name, amount, source)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [tenantId, entryId, kind, name, amount, source],
      );
    }

    async function addPaymentRaw(tenantId: string, entryId: string, amount: string): Promise<void> {
      await pool.query(
        `insert into hr_payroll_payments (id, tenant_id, payroll_entry_id, amount, payment_date, status)
       values (gen_random_uuid(), $1, $2, $3, '2025-07-01', 'PAID')`,
        [tenantId, entryId, amount],
      );
    }

    it('scenario A: item included in two finalized periods, paid under only one -> flagged, payment unconfirmed', async () => {
      const emp = await makeEmployeeRaw(fx.tenantA);
      const periodA = await makePeriodRaw(fx.tenantA, 'FINALIZED');
      const periodB = await makePeriodRaw(fx.tenantA, 'FINALIZED');
      const entryA = await makeEntryRaw(fx.tenantA, periodA, emp, '5700.00');
      const entryB = await makeEntryRaw(fx.tenantA, periodB, emp, '5700.00');
      await addComponentRaw(fx.tenantA, entryA, 'INCENTIVE', 'incentive', 'performance', '700.00');
      await addComponentRaw(fx.tenantA, entryB, 'INCENTIVE', 'incentive', 'performance', '700.00');
      await addPaymentRaw(fx.tenantA, entryA, '5700.00'); // only A was actually paid

      const findings = await findSuspectedDuplicateInclusions(fx.tenantA);
      const match = findings.find((f) => f.employeeId === emp && f.amount === '700.00');
      expect(match).toBeTruthy();
      expect(match!.periodIds.sort()).toEqual([periodA, periodB].sort());
      expect(match!.classification).toBe('SUSPECTED_DUPLICATE_INCLUSION_PAYMENT_UNCONFIRMED');
    });

    it('scenario B: item included AND paid under both periods -> flagged as the stronger classification', async () => {
      const emp = await makeEmployeeRaw(fx.tenantA);
      const periodA = await makePeriodRaw(fx.tenantA, 'FINALIZED');
      const periodB = await makePeriodRaw(fx.tenantA, 'PAID');
      const entryA = await makeEntryRaw(fx.tenantA, periodA, emp, '4900.00');
      const entryB = await makeEntryRaw(fx.tenantA, periodB, emp, '4900.00');
      await addComponentRaw(
        fx.tenantA,
        entryA,
        'REIMBURSEMENT',
        'reimbursement',
        'Reimbursement',
        '900.00',
      );
      await addComponentRaw(
        fx.tenantA,
        entryB,
        'REIMBURSEMENT',
        'reimbursement',
        'Reimbursement',
        '900.00',
      );
      await addPaymentRaw(fx.tenantA, entryA, '4900.00');
      await addPaymentRaw(fx.tenantA, entryB, '4900.00'); // both actually paid

      const findings = await findSuspectedDuplicateInclusions(fx.tenantA);
      const match = findings.find(
        (f) => f.employeeId === emp && f.amount === '900.00' && f.source === 'reimbursement',
      );
      expect(match).toBeTruthy();
      expect(match!.classification).toBe('SUSPECTED_DUPLICATE_PAYMENT');
    });

    it('scenario C: a legitimate, separate item with the same amount in two periods must still only be reported as a heuristic match, never a false "confirmed" label', async () => {
      // same employee, same amount, same free-text name, two DIFFERENT real
      // incentives, in two genuinely non-overlapping legitimate periods — the
      // diagnostic has no way to tell this apart from scenario A/B, which is
      // exactly the limitation this investigation must state plainly rather
      // than paper over
      const emp = await makeEmployeeRaw(fx.tenantA);
      const periodJan = await makePeriodRaw(fx.tenantA, 'FINALIZED');
      const periodFeb = await makePeriodRaw(fx.tenantA, 'FINALIZED');
      const entryJan = await makeEntryRaw(fx.tenantA, periodJan, emp, '5500.00');
      const entryFeb = await makeEntryRaw(fx.tenantA, periodFeb, emp, '5500.00');
      await addComponentRaw(fx.tenantA, entryJan, 'INCENTIVE', 'incentive', 'referral', '500.00');
      await addComponentRaw(fx.tenantA, entryFeb, 'INCENTIVE', 'incentive', 'referral', '500.00');
      await addPaymentRaw(fx.tenantA, entryJan, '5500.00');
      await addPaymentRaw(fx.tenantA, entryFeb, '5500.00');

      const findings = await findSuspectedDuplicateInclusions(fx.tenantA);
      const match = findings.find(
        (f) => f.employeeId === emp && f.amount === '500.00' && f.name === 'referral',
      );
      // the diagnostic correctly surfaces this as a *suspected* match (it
      // cannot do otherwise without a stable id) — never silently dropped,
      // and never escalated beyond "suspected"
      expect(match).toBeTruthy();
      expect(match!.classification).toBe('SUSPECTED_DUPLICATE_PAYMENT');
    });

    it('scenario D: duplicate inclusion with incomplete historical payment evidence (no payment rows at all) is still flagged, correctly unescalated', async () => {
      const emp = await makeEmployeeRaw(fx.tenantA);
      const periodA = await makePeriodRaw(fx.tenantA, 'FINALIZED');
      const periodB = await makePeriodRaw(fx.tenantA, 'FINALIZED');
      const entryA = await makeEntryRaw(fx.tenantA, periodA, emp, '3400.00');
      const entryB = await makeEntryRaw(fx.tenantA, periodB, emp, '3400.00');
      await addComponentRaw(fx.tenantA, entryA, 'INCENTIVE', 'incentive', 'spot-bonus', '400.00');
      await addComponentRaw(fx.tenantA, entryB, 'INCENTIVE', 'incentive', 'spot-bonus', '400.00');
      // no payment rows recorded for either entry at all

      const findings = await findSuspectedDuplicateInclusions(fx.tenantA);
      const match = findings.find(
        (f) => f.employeeId === emp && f.amount === '400.00' && f.name === 'spot-bonus',
      );
      expect(match).toBeTruthy();
      expect(match!.classification).toBe('SUSPECTED_DUPLICATE_INCLUSION_PAYMENT_UNCONFIRMED');
    });

    it('scenario E: a legacy reimbursement row with a NULL reservation marker, included in only one finalized period, is never flagged', async () => {
      const emp = await makeEmployeeRaw(fx.tenantA);
      // a real hr_expense_claims/hr_expense_reimbursements pair, left exactly
      // as every row that predates migration 0030 is: payroll_period_id NULL,
      // because the column — and any consumption tracking at all for
      // expenses — did not exist when this row was reimbursed
      const catId = (await pool.query('select gen_random_uuid() as id')).rows[0].id as string;
      await pool.query(
        `insert into hr_expense_categories (id, tenant_id, name, code) values ($1,$2,$3,$4)`,
        [catId, fx.tenantA, `Legacy ${uniq()}`, `LG${uniq()}`],
      );
      const claimId = (await pool.query('select gen_random_uuid() as id')).rows[0].id as string;
      await pool.query(
        `insert into hr_expense_claims
         (id, tenant_id, claim_number, employee_id, category_id, claim_date, expense_date, amount, status)
       values ($1,$2,$3,$4,$5,'2025-05-01','2025-05-01','200.00','REIMBURSED')`,
        [claimId, fx.tenantA, `CL${uniq()}`, emp, catId],
      );
      await pool.query(
        `insert into hr_expense_reimbursements
         (id, tenant_id, expense_claim_id, reimbursed_amount, payment_date, status, payroll_period_id)
       values (gen_random_uuid(), $1, $2, '200.00', '2025-05-10', 'PAID', null)`,
        [fx.tenantA, claimId],
      );
      const legacyMarker = await pool.query(
        `select payroll_period_id from hr_expense_reimbursements where expense_claim_id = $1`,
        [claimId],
      );
      expect(legacyMarker.rows[0].payroll_period_id).toBeNull();

      const period = await makePeriodRaw(fx.tenantA, 'FINALIZED');
      const entry = await makeEntryRaw(fx.tenantA, period, emp, '2200.00');
      await addComponentRaw(
        fx.tenantA,
        entry,
        'REIMBURSEMENT',
        'reimbursement',
        'Reimbursement',
        '200.00',
      );
      await addPaymentRaw(fx.tenantA, entry, '2200.00');

      const findings = await findSuspectedDuplicateInclusions(fx.tenantA);
      const match = findings.find((f) => f.employeeId === emp && f.amount === '200.00');
      expect(match).toBeUndefined(); // appears in exactly one finalized period — not a candidate
    });

    it('tenant isolation: a tenant-B duplicate-looking pair never surfaces when auditing tenant A', async () => {
      const empB = await makeEmployeeRaw(fx.tenantB);
      const periodB1 = await makePeriodRaw(fx.tenantB, 'FINALIZED');
      const periodB2 = await makePeriodRaw(fx.tenantB, 'FINALIZED');
      const entryB1 = await makeEntryRaw(fx.tenantB, periodB1, empB, '1100.00');
      const entryB2 = await makeEntryRaw(fx.tenantB, periodB2, empB, '1100.00');
      await addComponentRaw(
        fx.tenantB,
        entryB1,
        'INCENTIVE',
        'incentive',
        'cross-tenant',
        '100.00',
      );
      await addComponentRaw(
        fx.tenantB,
        entryB2,
        'INCENTIVE',
        'incentive',
        'cross-tenant',
        '100.00',
      );

      const findingsA = await findSuspectedDuplicateInclusions(fx.tenantA);
      expect(findingsA.find((f) => f.employeeId === empB)).toBeUndefined();
      const findingsB = await findSuspectedDuplicateInclusions(fx.tenantB);
      expect(findingsB.find((f) => f.employeeId === empB && f.amount === '100.00')).toBeTruthy();
    });
  },
);
