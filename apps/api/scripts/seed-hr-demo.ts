/**
 * Phase 12 — HR & Workforce demo/seed data for the `clans-demo` tenant.
 *
 * Deterministic, generic and idempotent (a natural-key guard on
 * `hr_employees`). Content is synthetic and industry-neutral — NOT a real
 * organisation, no country-specific statutory fields. Production correctness
 * never depends on this script.
 *
 * Usage: `pnpm --filter @aivoryx/api run seed:hr-demo`
 * Requires `pnpm db:migrate` + `pnpm --filter @aivoryx/db db:seed`
 * (and `seed:field-demo` for the `agent@clans-demo.test` membership).
 *
 * Leaves, for `admin@clans-demo.test` / `agent@clans-demo.test` (both
 * `Demo-Passw0rd!`):
 *   - 4 departments, 5 designations, 2 work locations, 2 schedules
 *   - 7 employees in a 3-level reporting hierarchy incl. 2 field agents
 *     (one linked to the demo field-agent membership, one to the admin
 *     membership so `/hr/me` is populated for both logins)
 *   - ~2 weeks of attendance for 3 employees (present / late / absent / leave)
 *   - 3 leave types + policies (mixed approver strategies), opening balances,
 *     one APPROVED (with ledger consumption), one PENDING, one REJECTED request
 *   - 4 expense categories (incl. a mileage "Fuel" category), claims in DRAFT
 *     / SUBMITTED / APPROVED / REIMBURSED states plus a field fuel claim tied
 *     to the demo visit
 *   - compensation history (a SUPERSEDED + an ACTIVE profile) for 3 employees
 *   - one APPROVED incentive (unpaid) and one DRAFT incentive
 *   - one DRAFT payroll period (October 2026) and one FINALIZED period
 *     (September 2026) with frozen entry snapshots and payment records
 *     (one PAID, one PARTIALLY_PAID)
 *   - one OPEN performance period with goals and a SUBMITTED + a DRAFT review
 */
import { randomUUID } from 'node:crypto';
import { createDb, seedPermissions } from '@aivoryx/db';

const money = (n: number) => n.toFixed(2);
const iso = (d: Date) => d.toISOString();
const day = (d: Date) => d.toISOString().slice(0, 10);

/** A fixed "today" so the demo is reproducible regardless of run date. */
const TODAY = new Date('2026-09-06T09:00:00.000Z');
const YEAR = 2026;

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

async function main(): Promise<void> {
  const handle = createDb({ poolMax: 2 });
  const c = await handle.pool.connect();
  try {
    await seedPermissions(handle);

    const tenantId = (
      await c.query<{ id: string }>(`select id from tenants where slug='clans-demo'`)
    ).rows[0]?.id;
    if (!tenantId) throw new Error('run seed:supply-demo / seed:field-demo first');

    const adminMembershipId = (
      await c.query<{ id: string }>(
        `select m.id from user_tenant_memberships m join users u on u.id=m.user_id
         where m.tenant_id=$1 and u.email='admin@clans-demo.test'`,
        [tenantId],
      )
    ).rows[0]?.id;
    if (!adminMembershipId) throw new Error('admin membership missing — run seed:field-demo');

    const agentMembershipId =
      (
        await c.query<{ id: string }>(
          `select m.id from user_tenant_memberships m join users u on u.id=m.user_id
           where m.tenant_id=$1 and u.email='agent@clans-demo.test'`,
          [tenantId],
        )
      ).rows[0]?.id ?? null;

    const demoVisitId =
      (
        await c.query<{ id: string }>(
          `select id from visits where tenant_id=$1 order by created_at limit 1`,
          [tenantId],
        )
      ).rows[0]?.id ?? null;

    if (
      (await c.query(`select 1 from hr_employees where tenant_id=$1 limit 1`, [tenantId])).rows
        .length > 0
    ) {
      console.warn('[seed-hr-demo] HR rows already present — nothing to do');
      return;
    }

    await c.query('begin');
    await c.query(`select set_config('app.tenant_id', $1, true)`, [tenantId]);
    await c.query(`select set_config('app.user_id', $1, true)`, [adminMembershipId]);

    // ---- organisation -------------------------------------------------
    const dept = async (name: string, code: string) => {
      const id = randomUUID();
      await c.query(
        `insert into hr_departments (id, tenant_id, name, code, status) values ($1,$2,$3,$4,'ACTIVE')`,
        [id, tenantId, name, code],
      );
      return id;
    };
    const desig = async (name: string, code: string) => {
      const id = randomUUID();
      await c.query(
        `insert into hr_designations (id, tenant_id, name, code, status) values ($1,$2,$3,$4,'ACTIVE')`,
        [id, tenantId, name, code],
      );
      return id;
    };

    const dOps = await dept('Operations', 'OPS');
    const dSales = await dept('Sales', 'SALES');
    const dHr = await dept('People & Culture', 'PC');
    const dFin = await dept('Finance', 'FIN');

    const gDirector = await desig('Director', 'DIR');
    const gManager = await desig('Manager', 'MGR');
    const gSupervisor = await desig('Supervisor', 'SUP');
    const gFieldAgent = await desig('Field Agent', 'FA');
    const gAssociate = await desig('Associate', 'ASSOC');

    const locHq = randomUUID();
    await c.query(
      `insert into hr_work_locations
         (id, tenant_id, name, code, address_line, city, region, country, postal_code, latitude, longitude, status)
       values ($1,$2,'Head Office','HQ','1 Residency Road','Bengaluru','Karnataka','IN','560025','12.971600','77.594600','ACTIVE')`,
      [locHq, tenantId],
    );
    const locDepot = randomUUID();
    await c.query(
      `insert into hr_work_locations
         (id, tenant_id, name, code, address_line, city, region, country, postal_code, latitude, longitude, status)
       values ($1,$2,'North Depot','DEPOT-N','Plot 22, Peenya Industrial Area','Bengaluru','Karnataka','IN','560058','13.028500','77.520000','ACTIVE')`,
      [locDepot, tenantId],
    );

    const schOffice = randomUUID();
    await c.query(
      `insert into hr_work_schedules
         (id, tenant_id, name, start_time, end_time, working_days_mask, grace_minutes, location_id, status)
       values ($1,$2,'Office 9:30–18:00','09:30','18:00',31,15,$3,'ACTIVE')`,
      [schOffice, tenantId, locHq],
    );
    const schField = randomUUID();
    await c.query(
      `insert into hr_work_schedules
         (id, tenant_id, name, start_time, end_time, working_days_mask, grace_minutes, location_id, status)
       values ($1,$2,'Field 08:00–17:00','08:00','17:00',63,20,$3,'ACTIVE')`,
      [schField, tenantId, locDepot],
    );

    // ---- employees --------------------------------------------------
    let empSeq = 0;
    const mkEmp = async (opts: {
      first: string;
      last: string;
      deptId: string;
      desigId: string;
      locId: string;
      schedId: string;
      type: string;
      managerId: string | null;
      category?: 'field' | null;
      membershipId?: string | null;
      joining: string;
      status?: string;
    }) => {
      empSeq += 1;
      const id = randomUUID();
      const number = `EMP-${String(empSeq).padStart(6, '0')}`;
      const displayName = `${opts.first} ${opts.last}`;
      await c.query(
        `insert into hr_employees
           (id, tenant_id, employee_number, first_name, last_name, display_name, work_email,
            phone, joining_date, status, employment_type, department_id, designation_id,
            work_location_id, manager_id, schedule_id, category, membership_id, created_by_membership_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          id,
          tenantId,
          number,
          opts.first,
          opts.last,
          displayName,
          `${opts.first}.${opts.last}`.toLowerCase() + '@clans-demo.test',
          '98450' + String(10000 + empSeq),
          opts.joining,
          opts.status ?? 'ACTIVE',
          opts.type,
          opts.deptId,
          opts.desigId,
          opts.locId,
          opts.managerId,
          opts.schedId,
          opts.category ?? null,
          opts.membershipId ?? null,
          adminMembershipId,
        ],
      );
      return { id, number, displayName };
    };

    // level 1
    const hrDir = await mkEmp({
      first: 'Asha',
      last: 'Rao',
      deptId: dHr,
      desigId: gDirector,
      locId: locHq,
      schedId: schOffice,
      type: 'FULL_TIME',
      managerId: null,
      membershipId: adminMembershipId, // admin login -> /hr/me works
      joining: '2023-02-01',
    });
    // level 2
    const salesMgr = await mkEmp({
      first: 'Vikram',
      last: 'Singh',
      deptId: dSales,
      desigId: gManager,
      locId: locHq,
      schedId: schOffice,
      type: 'FULL_TIME',
      managerId: hrDir.id,
      joining: '2023-06-15',
    });
    const fieldSup = await mkEmp({
      first: 'Neha',
      last: 'Kulkarni',
      deptId: dOps,
      desigId: gSupervisor,
      locId: locDepot,
      schedId: schField,
      type: 'FULL_TIME',
      managerId: hrDir.id,
      joining: '2023-09-01',
    });
    // level 3
    const fieldAgent1 = await mkEmp({
      first: 'Ravi',
      last: 'Menon',
      deptId: dOps,
      desigId: gFieldAgent,
      locId: locDepot,
      schedId: schField,
      type: 'FULL_TIME',
      managerId: fieldSup.id,
      category: 'field',
      membershipId: agentMembershipId, // agent login -> field expense claim + /hr/me
      joining: '2024-01-10',
    });
    const fieldAgent2 = await mkEmp({
      first: 'Priya',
      last: 'Nair',
      deptId: dOps,
      desigId: gFieldAgent,
      locId: locDepot,
      schedId: schField,
      type: 'CONTRACT',
      managerId: fieldSup.id,
      category: 'field',
      joining: '2024-04-01',
    });
    const salesAssoc = await mkEmp({
      first: 'Iqbal',
      last: 'Ahmed',
      deptId: dSales,
      desigId: gAssociate,
      locId: locHq,
      schedId: schOffice,
      type: 'FULL_TIME',
      managerId: salesMgr.id,
      joining: '2024-07-22',
    });
    const finAssoc = await mkEmp({
      first: 'Meera',
      last: 'Iyer',
      deptId: dFin,
      desigId: gAssociate,
      locId: locHq,
      schedId: schOffice,
      type: 'FULL_TIME',
      managerId: hrDir.id,
      joining: '2024-09-05',
    });

    const allEmps = [hrDir, salesMgr, fieldSup, fieldAgent1, fieldAgent2, salesAssoc, finAssoc];

    // employment history — a designation change for the sales associate
    await c.query(
      `insert into hr_employment_history
         (id, tenant_id, employee_id, change_type, effective_date, from_value, to_value, reason, changed_by_membership_id)
       values ($1,$2,$3,'DESIGNATION','2025-07-01',$4,$5,'Annual review promotion',$6)`,
      [
        randomUUID(),
        tenantId,
        salesAssoc.id,
        JSON.stringify({ designationId: gAssociate }),
        JSON.stringify({ designationId: gAssociate }),
        adminMembershipId,
      ],
    );

    // bank details — sensitive; only two on file
    await c.query(
      `insert into hr_employee_bank_details
         (id, tenant_id, employee_id, account_holder_name, bank_name, account_number, branch, bank_identifier, swift_bic, preferred_method, updated_by_membership_id)
       values ($1,$2,$3,'Ravi Menon','State Bank of India','62194837201','Peenya','SBIN0007713','SBININBB','BANK_TRANSFER',$4)`,
      [randomUUID(), tenantId, fieldAgent1.id, adminMembershipId],
    );
    await c.query(
      `insert into hr_employee_bank_details
         (id, tenant_id, employee_id, account_holder_name, bank_name, account_number, branch, bank_identifier, swift_bic, preferred_method, updated_by_membership_id)
       values ($1,$2,$3,'Vikram Singh','HDFC Bank','50100244893712','MG Road','HDFC0000012','HDFCINBB','BANK_TRANSFER',$4)`,
      [randomUUID(), tenantId, salesMgr.id, adminMembershipId],
    );

    // ---- attendance (last ~12 calendar days) -----------------------
    const attFor = [fieldAgent1, fieldSup, salesAssoc];
    for (const emp of attFor) {
      for (let i = 12; i >= 0; i -= 1) {
        const d = addDays(TODAY, -i);
        const dow = d.getUTCDay(); // 0 Sun .. 6 Sat
        if (dow === 0 || (dow === 6 && emp !== fieldAgent1)) continue; // field agent works Sat
        let status = 'PRESENT';
        let checkIn: Date | null = new Date(d);
        checkIn.setUTCHours(
          emp === fieldAgent1 ? 8 : 9,
          emp === salesAssoc && i === 3 ? 55 : 25,
          0,
          0,
        );
        let checkOut: Date | null = new Date(d);
        checkOut.setUTCHours(emp === fieldAgent1 ? 17 : 18, 5, 0, 0);
        if (i === 3 && emp === salesAssoc) status = 'LATE';
        if (i === 6 && emp === fieldSup) {
          status = 'ABSENT';
          checkIn = null;
          checkOut = null;
        }
        if (i === 5 && emp === fieldAgent1) {
          status = 'ON_LEAVE';
          checkIn = null;
          checkOut = null;
        }
        await c.query(
          `insert into hr_attendance_records
             (id, tenant_id, employee_id, work_date, status, check_in_at, check_out_at, source, created_by_membership_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           on conflict do nothing`,
          [
            randomUUID(),
            tenantId,
            emp.id,
            day(d),
            status,
            checkIn ? iso(checkIn) : null,
            checkOut ? iso(checkOut) : null,
            emp === fieldAgent1 ? 'MOBILE' : 'WEB',
            adminMembershipId,
          ],
        );
      }
    }

    // guarantee some activity "today" (the seed's fixed TODAY) for the dashboard
    for (const emp of [fieldAgent1, salesAssoc]) {
      const ci = new Date(TODAY);
      ci.setUTCHours(emp === fieldAgent1 ? 8 : 9, 20, 0, 0);
      await c.query(
        `insert into hr_attendance_records
           (id, tenant_id, employee_id, work_date, status, check_in_at, source, created_by_membership_id)
         values ($1,$2,$3,$4,'PRESENT',$5,$6,$7)
         on conflict do nothing`,
        [
          randomUUID(),
          tenantId,
          emp.id,
          day(TODAY),
          iso(ci),
          emp === fieldAgent1 ? 'MOBILE' : 'WEB',
          adminMembershipId,
        ],
      );
    }

    // ---- leave types + policies + balances + requests --------------
    const leaveType = async (
      name: string,
      code: string,
      quota: number,
      strategy: string,
      opts?: { paid?: boolean; allowNeg?: boolean; designated?: string | null },
    ) => {
      const id = randomUUID();
      await c.query(
        `insert into hr_leave_types (id, tenant_id, name, code, is_paid, requires_approval, allow_negative_balance, status)
         values ($1,$2,$3,$4,$5,true,$6,'ACTIVE')`,
        [id, tenantId, name, code, opts?.paid ?? true, opts?.allowNeg ?? false],
      );
      await c.query(
        `insert into hr_leave_policies
           (id, tenant_id, leave_type_id, name, annual_quota, approver_strategy, designated_approver_membership_id, status)
         values ($1,$2,$3,$4,$5,$6,$7,'ACTIVE')`,
        [
          randomUUID(),
          tenantId,
          id,
          `${name} policy`,
          money(quota),
          strategy,
          opts?.designated ?? null,
        ],
      );
      return { id, quota };
    };

    const ltAnnual = await leaveType('Annual Leave', 'ANNUAL', 18, 'REPORTING_MANAGER');
    const ltSick = await leaveType('Sick Leave', 'SICK', 12, 'HR');
    const ltUnpaid = await leaveType('Unpaid Leave', 'UNPAID', 0, 'REPORTING_MANAGER', {
      paid: false,
      allowNeg: true,
    });

    // opening balances for everyone
    for (const emp of allEmps) {
      for (const lt of [ltAnnual, ltSick, ltUnpaid]) {
        await c.query(
          `insert into hr_leave_balances
             (id, tenant_id, employee_id, leave_type_id, year, opening, accrued, consumed, adjusted)
           values ($1,$2,$3,$4,$5,$6,'0.00','0.00','0.00')
           on conflict do nothing`,
          [randomUUID(), tenantId, emp.id, lt.id, YEAR, money(lt.quota)],
        );
      }
    }

    let lrSeq = 0;
    const leaveReq = async (opts: {
      emp: { id: string };
      leaveTypeId: string;
      start: string;
      end: string;
      days: number;
      status: string;
      approver: string | null;
      reason: string;
      decided?: boolean;
    }) => {
      lrSeq += 1;
      const id = randomUUID();
      await c.query(
        `insert into hr_leave_requests
           (id, tenant_id, request_number, employee_id, leave_type_id, start_date, end_date,
            is_half_day, total_days, reason, status, approver_membership_id, decided_by_membership_id,
            decided_at, decision_reason, created_by_membership_id)
         values ($1,$2,$3,$4,$5,$6,$7,false,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id,
          tenantId,
          `LR-${String(lrSeq).padStart(6, '0')}`,
          opts.emp.id,
          opts.leaveTypeId,
          opts.start,
          opts.end,
          money(opts.days),
          opts.reason,
          opts.status,
          opts.approver,
          opts.decided ? adminMembershipId : null,
          opts.decided ? iso(TODAY) : null,
          opts.decided ? (opts.status === 'APPROVED' ? 'Approved' : 'Not this cycle') : null,
          opts.emp.id === fieldAgent1.id && agentMembershipId
            ? agentMembershipId
            : adminMembershipId,
        ],
      );
      return id;
    };

    // APPROVED annual leave for the field agent — with ledger consumption
    const approvedLeaveDays = 1;
    const approvedLeaveId = await leaveReq({
      emp: fieldAgent1,
      leaveTypeId: ltAnnual.id,
      start: day(addDays(TODAY, -5)),
      end: day(addDays(TODAY, -5)),
      days: approvedLeaveDays,
      status: 'APPROVED',
      approver: null,
      reason: 'Family function',
      decided: true,
    });
    await c.query(
      `update hr_leave_balances set consumed = consumed + $1, updated_at = now()
       where tenant_id=$2 and employee_id=$3 and leave_type_id=$4 and year=$5`,
      [money(approvedLeaveDays), tenantId, fieldAgent1.id, ltAnnual.id, YEAR],
    );
    await c.query(
      `insert into hr_leave_balance_transactions
         (id, tenant_id, employee_id, leave_type_id, year, kind, amount, leave_request_id, reason, created_by_membership_id)
       values ($1,$2,$3,$4,$5,'CONSUMPTION',$6,$7,'Approved leave',$8)`,
      [
        randomUUID(),
        tenantId,
        fieldAgent1.id,
        ltAnnual.id,
        YEAR,
        money(-approvedLeaveDays),
        approvedLeaveId,
        adminMembershipId,
      ],
    );

    // PENDING sick leave for the sales associate
    await leaveReq({
      emp: salesAssoc,
      leaveTypeId: ltSick.id,
      start: day(addDays(TODAY, 3)),
      end: day(addDays(TODAY, 4)),
      days: 2,
      status: 'PENDING',
      approver: null,
      reason: 'Medical procedure',
    });

    // REJECTED annual leave for the finance associate
    await leaveReq({
      emp: finAssoc,
      leaveTypeId: ltAnnual.id,
      start: day(addDays(TODAY, 10)),
      end: day(addDays(TODAY, 14)),
      days: 5,
      status: 'REJECTED',
      approver: null,
      reason: 'Vacation',
      decided: true,
    });

    // ---- expense categories + claims ------------------------------
    const expCat = async (name: string, code: string, mileageRate?: number) => {
      const id = randomUUID();
      await c.query(
        `insert into hr_expense_categories
           (id, tenant_id, name, code, default_mileage_rate, requires_receipt, status)
         values ($1,$2,$3,$4,$5,$6,'ACTIVE')`,
        [
          id,
          tenantId,
          name,
          code,
          mileageRate != null ? money(mileageRate) : null,
          mileageRate == null,
        ],
      );
      return id;
    };
    const catTravel = await expCat('Travel', 'TRAVEL');
    const catFuel = await expCat('Fuel / Mileage', 'FUEL', 12);
    const catMeals = await expCat('Meals', 'MEALS');
    const catAccom = await expCat('Accommodation', 'ACCOM');

    let exSeq = 0;
    const claim = async (opts: {
      emp: { id: string };
      categoryId: string;
      date: string;
      amount: number;
      status: string;
      description: string;
      merchant?: string;
      distanceKm?: number;
      mileageRate?: number;
      visitRef?: string | null;
      approvedAmount?: number;
      creator?: string;
    }) => {
      exSeq += 1;
      const id = randomUUID();
      const isMileage = opts.distanceKm != null && opts.mileageRate != null;
      const reimbursement = isMileage ? opts.distanceKm! * opts.mileageRate! : opts.amount;
      // the `amount` column must be > 0; for a mileage claim the claimed amount
      // equals the computed distance × rate.
      const amount = opts.amount > 0 ? opts.amount : reimbursement;
      const submitted = opts.status !== 'DRAFT';
      const decided = ['APPROVED', 'REIMBURSEMENT_PENDING', 'REIMBURSED'].includes(opts.status);
      await c.query(
        `insert into hr_expense_claims
           (id, tenant_id, claim_number, employee_id, category_id, claim_date, expense_date, amount, currency,
            description, merchant, visit_ref, distance_km, mileage_rate, reimbursement_amount, approved_amount,
            status, submitted_at, approver_membership_id, decided_by_membership_id, decided_at, decision_reason,
            created_by_membership_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'INR',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [
          id,
          tenantId,
          `EXP-${String(exSeq).padStart(6, '0')}`,
          opts.emp.id,
          opts.categoryId,
          day(TODAY),
          opts.date,
          money(amount),
          opts.description,
          opts.merchant ?? null,
          opts.visitRef ?? null,
          opts.distanceKm != null ? money(opts.distanceKm) : null,
          opts.mileageRate != null ? money(opts.mileageRate) : null,
          money(reimbursement),
          decided ? money(opts.approvedAmount ?? reimbursement) : null,
          opts.status,
          submitted ? iso(addDays(TODAY, -2)) : null,
          decided ? adminMembershipId : null,
          decided ? adminMembershipId : null,
          decided ? iso(addDays(TODAY, -1)) : null,
          decided ? 'Approved' : null,
          opts.creator ?? adminMembershipId,
        ],
      );
      return { id, reimbursement };
    };

    // DRAFT meals claim (sales associate)
    await claim({
      emp: salesAssoc,
      categoryId: catMeals,
      date: day(addDays(TODAY, -3)),
      amount: 480,
      status: 'DRAFT',
      description: 'Client lunch',
      merchant: 'Truffles',
    });
    // SUBMITTED accommodation claim (sales manager)
    await claim({
      emp: salesMgr,
      categoryId: catAccom,
      date: day(addDays(TODAY, -6)),
      amount: 4200,
      status: 'SUBMITTED',
      description: 'Hotel — regional review',
      merchant: 'Ginger Hotels',
    });
    // APPROVED travel claim (field supervisor)
    await claim({
      emp: fieldSup,
      categoryId: catTravel,
      date: day(addDays(TODAY, -8)),
      amount: 1750,
      status: 'APPROVED',
      description: 'Inter-city bus + auto',
      merchant: 'KSRTC',
    });
    // REIMBURSED fuel/mileage claim (field agent 2) + reimbursement row
    const reimbursedClaim = await claim({
      emp: fieldAgent2,
      categoryId: catFuel,
      date: day(addDays(TODAY, -10)),
      amount: 0,
      status: 'REIMBURSED',
      description: 'Site visits — 40 km',
      distanceKm: 40,
      mileageRate: 12,
    });
    await c.query(
      `insert into hr_expense_reimbursements
         (id, tenant_id, expense_claim_id, reimbursed_amount, currency, payment_date, payment_method,
          payment_reference, transaction_ref, status, processed_by_membership_id)
       values ($1,$2,$3,$4,'INR',$5,'BANK_TRANSFER','REIMB-2026-09-001','UTR2026090100123','PAID',$6)`,
      [
        randomUUID(),
        tenantId,
        reimbursedClaim.id,
        money(reimbursedClaim.reimbursement),
        day(addDays(TODAY, -2)),
        adminMembershipId,
      ],
    );
    // SUBMITTED field fuel claim tied to the demo visit (field agent 1)
    await claim({
      emp: fieldAgent1,
      categoryId: catFuel,
      date: day(addDays(TODAY, -1)),
      amount: 0,
      status: 'SUBMITTED',
      description: 'Fuel for assigned visit',
      distanceKm: 18.5,
      mileageRate: 12,
      visitRef: demoVisitId,
      creator: agentMembershipId ?? adminMembershipId,
    });

    // ---- compensation history ------------------------------------
    const compFor = async (
      emp: { id: string },
      older: { date: string; base: number; comps: [string, string, number][] },
      current: { date: string; base: number; comps: [string, string, number][] },
    ) => {
      const mk = async (
        d: string,
        base: number,
        comps: [string, string, number][],
        status: string,
      ) => {
        const pid = randomUUID();
        await c.query(
          `insert into hr_compensation_profiles
             (id, tenant_id, employee_id, effective_date, pay_frequency, currency, base_salary, status, created_by_membership_id)
           values ($1,$2,$3,$4,'MONTHLY','INR',$5,$6,$7)`,
          [pid, tenantId, emp.id, d, money(base), status, adminMembershipId],
        );
        for (const [kind, name, amount] of comps) {
          await c.query(
            `insert into hr_compensation_components (id, tenant_id, compensation_profile_id, kind, name, amount)
             values ($1,$2,$3,$4,$5,$6)`,
            [randomUUID(), tenantId, pid, kind, name, money(amount)],
          );
        }
        return pid;
      };
      await mk(older.date, older.base, older.comps, 'SUPERSEDED');
      await mk(current.date, current.base, current.comps, 'ACTIVE');
      await c.query(
        `insert into hr_employment_history
           (id, tenant_id, employee_id, change_type, effective_date, from_value, to_value, reason, changed_by_membership_id)
         values ($1,$2,$3,'COMPENSATION',$4,$5,$6,'Annual revision',$7)`,
        [
          randomUUID(),
          tenantId,
          emp.id,
          current.date,
          JSON.stringify({ effectiveDate: older.date, payFrequency: 'MONTHLY' }),
          JSON.stringify({ effectiveDate: current.date, payFrequency: 'MONTHLY' }),
          adminMembershipId,
        ],
      );
    };

    await compFor(
      salesMgr,
      {
        date: '2024-04-01',
        base: 82000,
        comps: [
          ['EARNING', 'House Rent Allowance', 18000],
          ['DEDUCTION', 'Provident Fund', 4800],
        ],
      },
      {
        date: '2025-04-01',
        base: 90000,
        comps: [
          ['EARNING', 'House Rent Allowance', 20000],
          ['DEDUCTION', 'Provident Fund', 5000],
        ],
      },
    );
    await compFor(
      fieldSup,
      {
        date: '2024-04-01',
        base: 54000,
        comps: [
          ['EARNING', 'Field Allowance', 7000],
          ['DEDUCTION', 'Provident Fund', 2800],
        ],
      },
      {
        date: '2025-04-01',
        base: 60000,
        comps: [
          ['EARNING', 'Field Allowance', 8000],
          ['DEDUCTION', 'Provident Fund', 3000],
        ],
      },
    );
    await compFor(
      salesAssoc,
      { date: '2024-07-22', base: 38000, comps: [['EARNING', 'House Rent Allowance', 9000]] },
      {
        date: '2025-07-01',
        base: 44000,
        comps: [
          ['EARNING', 'House Rent Allowance', 11000],
          ['DEDUCTION', 'Provident Fund', 2200],
        ],
      },
    );
    // field agent 1 — single active profile so /hr/me shows compensation
    {
      const pid = randomUUID();
      await c.query(
        `insert into hr_compensation_profiles
           (id, tenant_id, employee_id, effective_date, pay_frequency, currency, base_salary, status, created_by_membership_id)
         values ($1,$2,$3,'2025-01-01','MONTHLY','INR','42000.00','ACTIVE',$4)`,
        [pid, tenantId, fieldAgent1.id, adminMembershipId],
      );
      await c.query(
        `insert into hr_compensation_components (id, tenant_id, compensation_profile_id, kind, name, amount)
         values ($1,$2,$3,'EARNING','Field Allowance','6000.00')`,
        [randomUUID(), tenantId, pid],
      );
    }

    // ---- incentives --------------------------------------------
    await c.query(
      `insert into hr_incentives
         (id, tenant_id, employee_id, amount, currency, type, reason, source_ref, status, approved_by_membership_id, approved_at, created_by_membership_id)
       values ($1,$2,$3,'5000.00','INR','Field performance','Q3 route completion','Q3-2026','APPROVED',$4,$5,$4)`,
      [randomUUID(), tenantId, fieldSup.id, adminMembershipId, iso(addDays(TODAY, -3))],
    );
    await c.query(
      `insert into hr_incentives
         (id, tenant_id, employee_id, amount, currency, type, reason, status, created_by_membership_id)
       values ($1,$2,$3,'3000.00','INR','Referral bonus','Referred a hire','DRAFT',$4)`,
      [randomUUID(), tenantId, salesAssoc.id, adminMembershipId],
    );

    // ---- payroll: one DRAFT + one FINALIZED --------------------
    const draftPeriodId = randomUUID();
    await c.query(
      `insert into hr_payroll_periods
         (id, tenant_id, name, period_start, period_end, pay_date, currency, status, created_by_membership_id)
       values ($1,$2,'October 2026','2026-10-01','2026-10-31','2026-11-01','INR','DRAFT',$3)`,
      [draftPeriodId, tenantId, adminMembershipId],
    );

    const finalPeriodId = randomUUID();
    await c.query(
      `insert into hr_payroll_periods
         (id, tenant_id, name, period_start, period_end, pay_date, currency, status, gross_total,
          deduction_total, incentive_total, reimbursement_total, net_total, finalized_at, finalized_by_membership_id, created_by_membership_id)
       values ($1,$2,'September 2026','2026-09-01','2026-09-30','2026-10-01','INR','PARTIALLY_PAID',
               '183000.00','8000.00','5000.00','0.00','175000.00',$3,$4,$4)`,
      [finalPeriodId, tenantId, iso(addDays(TODAY, -1)), adminMembershipId],
    );

    const frozenAt = iso(addDays(TODAY, -1));
    const mkEntry = async (
      emp: { id: string; number: string; displayName: string },
      e: {
        base: number;
        allow: number;
        incentive: number;
        deduction: number;
        components: [string, string, number, string][];
        paid: number;
        paymentStatus: string;
      },
    ) => {
      const gross = e.base + e.allow + e.incentive;
      const net = gross - e.deduction;
      const entryId = randomUUID();
      const snapshot = {
        frozenAt,
        components: e.components.map(([kind, name, amount, source]) => ({
          kind,
          name,
          amount: money(amount),
          source,
        })),
        totals: {
          baseEarnings: money(e.base),
          allowancesTotal: money(e.allow),
          incentivesTotal: money(e.incentive),
          reimbursementsTotal: '0.00',
          deductionsTotal: money(e.deduction),
          grossPay: money(gross),
          netPay: money(net),
        },
      };
      await c.query(
        `insert into hr_payroll_entries
           (id, tenant_id, payroll_period_id, employee_id, employee_number, employee_name, currency,
            base_earnings, allowances_total, incentives_total, reimbursements_total, deductions_total,
            gross_pay, net_pay, snapshot, payment_status, paid_amount)
         values ($1,$2,$3,$4,$5,$6,'INR',$7,$8,$9,'0.00',$10,$11,$12,$13,$14,$15)`,
        [
          entryId,
          tenantId,
          finalPeriodId,
          emp.id,
          emp.number,
          emp.displayName,
          money(e.base),
          money(e.allow),
          money(e.incentive),
          money(e.deduction),
          money(gross),
          money(net),
          JSON.stringify(snapshot),
          e.paymentStatus,
          money(e.paid),
        ],
      );
      for (const [kind, name, amount, source] of e.components) {
        await c.query(
          `insert into hr_payroll_entry_components (id, tenant_id, payroll_entry_id, kind, name, amount, source)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [randomUUID(), tenantId, entryId, kind, name, money(amount), source],
        );
      }
      if (e.paid > 0) {
        await c.query(
          `insert into hr_payroll_payments
             (id, tenant_id, payroll_entry_id, amount, payment_method, payment_date, payment_reference, transaction_ref, status, processed_by_membership_id)
           values ($1,$2,$3,$4,'BANK_TRANSFER',$5,$6,$7,'PAID',$8)`,
          [
            randomUUID(),
            tenantId,
            entryId,
            money(e.paid),
            day(addDays(TODAY, -1)),
            `PAYRUN-2026-09/${emp.number}`,
            `UTR20260930${emp.number.replace(/\D/g, '')}`,
            adminMembershipId,
          ],
        );
      }
      return entryId;
    };

    await mkEntry(salesMgr, {
      base: 90000,
      allow: 20000,
      incentive: 0,
      deduction: 5000,
      components: [
        ['EARNING', 'Base salary', 90000, 'compensation'],
        ['EARNING', 'House Rent Allowance', 20000, 'compensation'],
        ['DEDUCTION', 'Provident Fund', 5000, 'compensation'],
      ],
      paid: 105000,
      paymentStatus: 'PAID',
    });
    await mkEntry(fieldSup, {
      base: 60000,
      allow: 8000,
      incentive: 5000,
      deduction: 3000,
      components: [
        ['EARNING', 'Base salary', 60000, 'compensation'],
        ['EARNING', 'Field Allowance', 8000, 'compensation'],
        ['INCENTIVE', 'Field performance', 5000, 'incentive'],
        ['DEDUCTION', 'Provident Fund', 3000, 'compensation'],
      ],
      paid: 40000,
      paymentStatus: 'PARTIALLY_PAID',
    });

    // tie the consumed incentive to the finalized period
    await c.query(
      `update hr_incentives set status='PAID', payroll_period_id=$1, updated_at=now()
       where tenant_id=$2 and employee_id=$3 and type='Field performance'`,
      [finalPeriodId, tenantId, fieldSup.id],
    );

    // ---- performance -----------------------------------------
    const perfPeriodId = randomUUID();
    await c.query(
      `insert into hr_performance_periods (id, tenant_id, name, period_start, period_end, status, created_by_membership_id)
       values ($1,$2,'H2 2026','2026-07-01','2026-12-31','OPEN',$3)`,
      [perfPeriodId, tenantId, adminMembershipId],
    );
    for (const [emp, title, weight] of [
      [fieldAgent1, 'Complete 95% of assigned visits on schedule', 40] as const,
      [fieldAgent1, 'Zero safety incidents', 30] as const,
      [salesAssoc, 'Achieve quarterly quota', 50] as const,
    ]) {
      await c.query(
        `insert into hr_performance_goals (id, tenant_id, performance_period_id, employee_id, title, weight, status, created_by_membership_id)
         values ($1,$2,$3,$4,$5,$6,'OPEN',$7)`,
        [randomUUID(), tenantId, perfPeriodId, emp.id, title, weight, adminMembershipId],
      );
    }
    await c.query(
      `insert into hr_performance_reviews
         (id, tenant_id, performance_period_id, employee_id, reviewer_membership_id, overall_rating, manager_comments, status, submitted_at, created_by_membership_id)
       values ($1,$2,$3,$4,$5,4,'Strong, reliable field execution. Work on paperwork turnaround.','SUBMITTED',$6,$5)`,
      [
        randomUUID(),
        tenantId,
        perfPeriodId,
        fieldAgent1.id,
        adminMembershipId,
        iso(addDays(TODAY, -2)),
      ],
    );
    await c.query(
      `insert into hr_performance_reviews
         (id, tenant_id, performance_period_id, employee_id, reviewer_membership_id, manager_comments, status, created_by_membership_id)
       values ($1,$2,$3,$4,$5,'Draft — pending calibration.','DRAFT',$5)`,
      [randomUUID(), tenantId, perfPeriodId, salesAssoc.id, adminMembershipId],
    );

    // ---- counters (so API-side numbering continues past the seed) --
    for (const [kind, prefix, value] of [
      ['employee', 'EMP-', empSeq],
      ['leave_request', 'LR-', lrSeq],
      ['expense_claim', 'EXP-', exSeq],
    ] as const) {
      await c.query(
        `insert into hr_counters (id, tenant_id, kind, prefix, padding, value)
         values (gen_random_uuid(),$1,$2,$3,6,$4)
         on conflict (tenant_id, kind) do update set value = greatest(hr_counters.value, excluded.value)`,
        [tenantId, kind, prefix, value],
      );
    }

    await c.query('commit');

    console.warn('[seed-hr-demo] tenant: clans-demo');
    console.warn(
      '[seed-hr-demo] admin login: admin@clans-demo.test / Demo-Passw0rd! (linked to employee EMP-000001)',
    );
    console.warn(
      '[seed-hr-demo] field agent login: agent@clans-demo.test / Demo-Passw0rd! (linked to employee EMP-000004)',
    );
    console.warn(
      '[seed-hr-demo] 7 employees · attendance · 3 leave types + requests · 6 expense claims · compensation history · 1 draft + 1 finalized payroll · performance H2 2026',
    );
  } catch (err) {
    await c.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    c.release();
    await handle.close();
  }
}

main().catch((err: unknown) => {
  console.error('[seed-hr-demo] failed:', err);
  process.exit(1);
});
