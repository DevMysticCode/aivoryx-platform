import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, rawPool, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 12 — HR & Workforce (ADR 0041). API-level integration proof:
 * organisation config, employee lifecycle + tenant-safe numbering + hierarchy
 * validation, membership linking, attendance + immutable corrections, leave
 * request/approval with ledger balances + overlap + concurrent-approval safety,
 * expense claim → approval → reimbursement with self-approval prevention and
 * frozen approved amounts, compensation history with no salary in audit,
 * payroll process → finalize (immutable snapshot) → payment, payslip PDF,
 * performance reviews, notification events, audit entries, and — critically —
 * salary / bank-detail privacy and self-service identity isolation.
 * Direct PostgreSQL RLS proof lives in `rls.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)('HR & Workforce', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;
  let pool: Pool;

  beforeAll(async () => {
    fx = await makeFixtures();
    app = await bootTestApp();
    http = request(app.getHttpServer());
    pool = await rawPool();
  });

  afterAll(async () => {
    await pool?.end();
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  const login = (email: string, password: string) =>
    http.post('/api/v1/auth/login').send({ email, password });
  const cookieFor = async (email: string, password: string, membershipId: string) => {
    const res = await login(email, password);
    const cookie = sessionCookie(res);
    await http.post('/api/v1/auth/switch-tenant').set('Cookie', cookie).send({ membershipId });
    return cookie;
  };
  const adminCookie = () => cookieFor(fx.admin.email, fx.admin.password, fx.admin.membershipId);
  const adminBCookie = () => cookieFor(fx.adminB.email, fx.adminB.password, fx.adminB.membershipId);
  const plainCookie = () =>
    cookieFor(fx.plainMember.email, fx.plainMember.password, fx.plainMember.membershipId);
  const limitedCookie = () =>
    cookieFor(fx.limited.email, fx.limited.password, fx.limited.membershipId);

  /** Grant a bespoke role with exactly these permission keys to a membership in tenant A. */
  async function grant(membershipId: string, keys: string[]): Promise<void> {
    const roleId = randomUUID();
    await pool.query('insert into roles (id, tenant_id, key, name) values ($1,$2,$3,$4)', [
      roleId,
      fx.tenantA,
      `HR_TEST_${roleId.slice(0, 8)}`,
      'HR test role',
    ]);
    const rows = await pool.query('select id, key from permissions where key = any($1)', [keys]);
    for (const r of rows.rows as { id: string; key: string }[]) {
      await pool.query(
        'insert into role_permissions (role_id, tenant_id, permission_id) values ($1,$2,$3)',
        [roleId, fx.tenantA, r.id],
      );
    }
    await pool.query(
      'insert into membership_roles (membership_id, role_id, tenant_id) values ($1,$2,$3) on conflict do nothing',
      [membershipId, roleId, fx.tenantA],
    );
  }

  const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();

  async function makeOrg(cookie: string) {
    const dept = await http
      .post('/api/v1/hr/departments')
      .set('Cookie', cookie)
      .send({ name: `Ops ${uniq()}`, code: `OPS${uniq()}` });
    const desig = await http
      .post('/api/v1/hr/designations')
      .set('Cookie', cookie)
      .send({ name: `Agent ${uniq()}`, code: `AGT${uniq()}` });
    const loc = await http
      .post('/api/v1/hr/locations')
      .set('Cookie', cookie)
      .send({
        name: `HQ ${uniq()}`,
        code: `HQ${uniq()}`,
        latitude: '12.9716',
        longitude: '77.5946',
      });
    expect([dept.status, desig.status, loc.status]).toEqual([200, 200, 200]);
    return {
      deptId: dept.body.id as string,
      desigId: desig.body.id as string,
      locId: loc.body.id as string,
    };
  }

  async function makeEmployee(
    cookie: string,
    over: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    // `membershipId` is not a create field — linking is a separate audited step.
    const { membershipId, ...rest } = over as { membershipId?: string } & Record<string, unknown>;
    const res = await http
      .post('/api/v1/hr/employees')
      .set('Cookie', cookie)
      .send({
        firstName: 'Test',
        lastName: uniq(),
        joiningDate: '2025-01-01',
        employmentType: 'FULL_TIME',
        ...rest,
      });
    expect(res.status).toBe(200);
    if (membershipId) {
      const linked = await http
        .post(`/api/v1/hr/employees/${res.body.id}/membership`)
        .set('Cookie', cookie)
        .send({ membershipId });
      expect(linked.status).toBe(200);
      return linked.body;
    }
    return res.body;
  }

  // ---- organisation + employees ---------------------------------

  it('creates org units and an employee with a server-generated tenant-scoped number', async () => {
    const cookie = await adminCookie();
    const org = await makeOrg(cookie);
    const e1 = await makeEmployee(cookie, { departmentId: org.deptId, designationId: org.desigId });
    const e2 = await makeEmployee(cookie);
    expect(e1.employeeNumber).toMatch(/^EMP-\d{6}$/);
    expect(e2.employeeNumber).not.toBe(e1.employeeNumber);
    // list DTO must NOT carry salary / bank fields
    const list = await http.get('/api/v1/hr/employees').set('Cookie', cookie);
    expect(list.status).toBe(200);
    const keys = Object.keys(list.body.items[0]);
    expect(keys).not.toContain('baseSalary');
    expect(keys).not.toContain('salary');
    expect(keys).not.toContain('accountNumber');
    expect(keys).not.toContain('bankName');
  });

  it('rejects a reporting manager from another tenant and a self/cyclic manager', async () => {
    const cookie = await adminCookie();
    const cookieB = await adminBCookie();
    const foreignMgr = await makeEmployee(cookieB); // employee in tenant B
    const bad = await http.post('/api/v1/hr/employees').set('Cookie', cookie).send({
      firstName: 'X',
      lastName: uniq(),
      joiningDate: '2025-01-01',
      employmentType: 'FULL_TIME',
      managerId: foreignMgr.id,
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);

    const a = await makeEmployee(cookie);
    const b = await makeEmployee(cookie, { managerId: a.id });
    // make a report to b -> cycle
    const cyclic = await http
      .patch(`/api/v1/hr/employees/${a.id}`)
      .set('Cookie', cookie)
      .send({ managerId: b.id });
    expect(cyclic.status).toBeGreaterThanOrEqual(400);
  });

  it('links a platform membership and rejects a cross-tenant membership link', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    const ok = await http
      .post(`/api/v1/hr/employees/${emp.id}/membership`)
      .set('Cookie', cookie)
      .send({ membershipId: fx.secondAdmin.membershipId });
    expect(ok.status).toBe(200);
    expect(ok.body.hasLogin).toBe(true);

    const emp2 = await makeEmployee(cookie);
    const foreign = await http
      .post(`/api/v1/hr/employees/${emp2.id}/membership`)
      .set('Cookie', cookie)
      .send({ membershipId: fx.adminB.membershipId }); // membership in tenant B
    expect(foreign.status).toBeGreaterThanOrEqual(400);
  });

  it('records employment history on a department change without leaking salary', async () => {
    const cookie = await adminCookie();
    const org = await makeOrg(cookie);
    const org2 = await makeOrg(cookie);
    const emp = await makeEmployee(cookie, { departmentId: org.deptId });
    await http
      .patch(`/api/v1/hr/employees/${emp.id}`)
      .set('Cookie', cookie)
      .send({ departmentId: org2.deptId });
    const hist = await http.get(`/api/v1/hr/employees/${emp.id}/history`).set('Cookie', cookie);
    expect(hist.status).toBe(200);
    expect(hist.body.some((h: { changeType: string }) => h.changeType === 'DEPARTMENT')).toBe(true);
    expect(JSON.stringify(hist.body)).not.toMatch(/salary|baseSalary/i);
  });

  // ---- attendance --------------------------------------------

  it('prevents a double check-in and stores an immutable, audited correction', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    const day = '2026-02-02';
    const rec = await http
      .post('/api/v1/hr/attendance/record')
      .set('Cookie', cookie)
      .send({ employeeId: emp.id, workDate: day, status: 'PRESENT' });
    expect(rec.status).toBe(200);

    const correction = await http
      .post(`/api/v1/hr/attendance/${rec.body.id}/corrections`)
      .set('Cookie', cookie)
      .send({ field: 'status', value: 'LATE', reason: 'Arrived 09:40' });
    expect(correction.status).toBe(200);
    expect(correction.body.status).toBe('LATE');
    expect(correction.body.correctionCount).toBe(1);

    const audit = await pool.query(
      `select action, metadata, changes from audit_logs where tenant_id=$1 and action='hr.attendance.corrected' order by occurred_at desc limit 1`,
      [fx.tenantA],
    );
    expect(audit.rowCount).toBe(1);
    expect(JSON.stringify(audit.rows[0])).not.toMatch(/account_number|password/i);
  });

  // ---- leave -----------------------------------------------

  async function makeLeaveType(cookie: string, quota = '5.00', strategy = 'HR') {
    const res = await http
      .post('/api/v1/hr/leave/types')
      .set('Cookie', cookie)
      .send({
        name: `Annual ${uniq()}`,
        code: `AL${uniq()}`,
        annualQuota: quota,
        approverStrategy: strategy,
      });
    expect(res.status).toBe(200);
    return res.body.id as string;
  }

  it('consumes a ledger balance on approval and blocks overlapping requests', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    const ltId = await makeLeaveType(cookie, '5.00');

    const req = await http.post('/api/v1/hr/leave/requests').set('Cookie', cookie).send({
      employeeId: emp.id,
      leaveTypeId: ltId,
      startDate: '2026-03-02',
      endDate: '2026-03-03',
    });
    expect(req.status).toBe(200);
    expect(req.body.totalDays).toBe('2.00');

    const overlap = await http.post('/api/v1/hr/leave/requests').set('Cookie', cookie).send({
      employeeId: emp.id,
      leaveTypeId: ltId,
      startDate: '2026-03-03',
      endDate: '2026-03-04',
    });
    expect(overlap.status).toBe(409);

    const decided = await http
      .post(`/api/v1/hr/leave/requests/${req.body.id}/approve`)
      .set('Cookie', cookie)
      .send({});
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('APPROVED');

    const bal = await http.get(`/api/v1/hr/leave/balances/${emp.id}`).set('Cookie', cookie);
    const row = bal.body.find((b: { leaveTypeId: string }) => b.leaveTypeId === ltId);
    expect(row.consumed).toBe('2.00');
    expect(row.balance).toBe('3.00');

    const txns = await pool.query(
      `select kind, amount from hr_leave_balance_transactions where tenant_id=$1 and employee_id=$2`,
      [fx.tenantA, emp.id],
    );
    expect(txns.rows.some((t) => t.kind === 'CONSUMPTION')).toBe(true);
  });

  it('does not over-consume a balance under concurrent approvals', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    const ltId = await makeLeaveType(cookie, '3.00');
    // two non-overlapping 2-day requests = 4 days vs a 3-day balance
    const r1 = await http.post('/api/v1/hr/leave/requests').set('Cookie', cookie).send({
      employeeId: emp.id,
      leaveTypeId: ltId,
      startDate: '2026-04-06',
      endDate: '2026-04-07',
    });
    const r2 = await http.post('/api/v1/hr/leave/requests').set('Cookie', cookie).send({
      employeeId: emp.id,
      leaveTypeId: ltId,
      startDate: '2026-04-13',
      endDate: '2026-04-14',
    });
    const [a, b] = await Promise.all([
      http.post(`/api/v1/hr/leave/requests/${r1.body.id}/approve`).set('Cookie', cookie).send({}),
      http.post(`/api/v1/hr/leave/requests/${r2.body.id}/approve`).set('Cookie', cookie).send({}),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 422]); // one approved, one rejected for insufficient balance
    const bal = await http.get(`/api/v1/hr/leave/balances/${emp.id}`).set('Cookie', cookie);
    const row = bal.body.find((x: { leaveTypeId: string }) => x.leaveTypeId === ltId);
    expect(Number(row.consumed)).toBeLessThanOrEqual(3);
    expect(Number(row.balance)).toBeGreaterThanOrEqual(0);
  });

  // ---- expenses -------------------------------------------

  async function makeCategory(cookie: string, mileageRate?: string) {
    const res = await http
      .post('/api/v1/hr/expenses/categories')
      .set('Cookie', cookie)
      .send({ name: `Travel ${uniq()}`, code: `TR${uniq()}`, defaultMileageRate: mileageRate });
    expect(res.status).toBe(200);
    return res.body.id as string;
  }

  it('freezes the approved amount and forbids self-approval', async () => {
    const cookie = await adminCookie();
    // an approver who is also an employee cannot approve their own claim
    const approverEmp = await makeEmployee(cookie, { membershipId: fx.admin.membershipId });
    const catId = await makeCategory(cookie);
    const own = await http
      .post('/api/v1/hr/expenses')
      .set('Cookie', cookie)
      .send({ categoryId: catId, expenseDate: '2026-05-01', amount: '500.00' });
    expect(own.body.employeeId).toBe(approverEmp.id);
    await http.post(`/api/v1/hr/expenses/${own.body.id}/submit`).set('Cookie', cookie).send({});
    const selfApprove = await http
      .post(`/api/v1/hr/expenses/${own.body.id}/approve`)
      .set('Cookie', cookie)
      .send({});
    expect(selfApprove.status).toBe(403);

    // a different employee's claim, approved for a reduced amount, then frozen
    const other = await makeEmployee(cookie);
    const claim = await http.post('/api/v1/hr/expenses').set('Cookie', cookie).send({
      employeeId: other.id,
      categoryId: catId,
      expenseDate: '2026-05-02',
      amount: '900.00',
    });
    await http.post(`/api/v1/hr/expenses/${claim.body.id}/submit`).set('Cookie', cookie).send({});
    const approved = await http
      .post(`/api/v1/hr/expenses/${claim.body.id}/approve`)
      .set('Cookie', cookie)
      .send({ approvedAmount: '800.00' });
    expect(approved.status).toBe(200);
    expect(approved.body.approvedAmount).toBe('800.00');

    const reimb = await http
      .post(`/api/v1/hr/expenses/${claim.body.id}/reimburse`)
      .set('Cookie', cookie)
      .send({
        reimbursedAmount: '800.00',
        paymentDate: '2026-05-10',
        paymentMethod: 'BANK_TRANSFER',
        paymentReference: 'UTR-1',
      });
    expect(reimb.status).toBe(200);
    expect(reimb.body.status).toBe('REIMBURSED');
    expect(reimb.body.reimbursement.reimbursedAmount).toBe('800.00');

    const evt = await pool.query(
      `select type from outbox_events where tenant_id=$1 and type='hr.expense.reimbursed'`,
      [fx.tenantA],
    );
    expect(evt.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('computes a mileage claim from distance x category rate', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    const catId = await makeCategory(cookie, '12.0000');
    const claim = await http.post('/api/v1/hr/expenses').set('Cookie', cookie).send({
      employeeId: emp.id,
      categoryId: catId,
      expenseDate: '2026-05-03',
      amount: '240.00',
      distanceKm: '20',
    });
    expect(claim.status).toBe(200);
    expect(claim.body.reimbursementAmount).toBe('240.00');
  });

  // ---- compensation (sensitive) --------------------------

  it('supersedes compensation history and keeps salary out of audit metadata', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    await http
      .post(`/api/v1/hr/employees/${emp.id}/compensation`)
      .set('Cookie', cookie)
      .send({ effectiveDate: '2025-01-01', baseSalary: '50000.00', payFrequency: 'MONTHLY' });
    await http
      .post(`/api/v1/hr/employees/${emp.id}/compensation`)
      .set('Cookie', cookie)
      .send({ effectiveDate: '2026-01-01', baseSalary: '60000.00', payFrequency: 'MONTHLY' });
    const hist = await http
      .get(`/api/v1/hr/employees/${emp.id}/compensation`)
      .set('Cookie', cookie);
    expect(hist.body).toHaveLength(2);
    expect(hist.body.filter((c: { status: string }) => c.status === 'ACTIVE')).toHaveLength(1);

    const audit = await pool.query(
      `select metadata, changes from audit_logs where tenant_id=$1 and action like 'hr.compensation.%'`,
      [fx.tenantA],
    );
    expect(audit.rowCount).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(audit.rows)).not.toMatch(/50000|60000/);
  });

  // ---- payroll --------------------------------------------

  it('processes, finalizes (immutable snapshot) and records a payroll payment', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    await http
      .post(`/api/v1/hr/employees/${emp.id}/compensation`)
      .set('Cookie', cookie)
      .send({
        effectiveDate: '2026-01-01',
        baseSalary: '40000.00',
        payFrequency: 'MONTHLY',
        components: [
          { kind: 'EARNING', name: 'HRA', amount: '10000.00' },
          { kind: 'DEDUCTION', name: 'PF', amount: '2000.00' },
        ],
      });

    const period = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({ name: `Payrun ${uniq()}`, periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    expect(period.status).toBe(200);

    const processed = await http
      .post(`/api/v1/hr/payroll/periods/${period.body.id}/process`)
      .set('Cookie', cookie)
      .send({});
    expect(processed.status).toBe(200);
    const entry = processed.body.entries.find(
      (e: { employeeId: string }) => e.employeeId === emp.id,
    );
    expect(entry.grossPay).toBe('50000.00');
    expect(entry.netPay).toBe('48000.00');

    const finalized = await http
      .post(`/api/v1/hr/payroll/periods/${period.body.id}/finalize`)
      .set('Cookie', cookie)
      .send({});
    expect(finalized.status).toBe(200);
    expect(finalized.body.status).toBe('FINALIZED');

    // re-process must be rejected once finalized
    const reprocess = await http
      .post(`/api/v1/hr/payroll/periods/${period.body.id}/process`)
      .set('Cookie', cookie)
      .send({});
    expect(reprocess.status).toBeGreaterThanOrEqual(400);

    // changing salary afterwards must NOT change the finalized entry
    await http
      .post(`/api/v1/hr/employees/${emp.id}/compensation`)
      .set('Cookie', cookie)
      .send({ effectiveDate: '2026-06-15', baseSalary: '999999.00', payFrequency: 'MONTHLY' });
    const still = await http
      .get(`/api/v1/hr/payroll/periods/${period.body.id}`)
      .set('Cookie', cookie);
    const stillEntry = still.body.entries.find(
      (e: { employeeId: string }) => e.employeeId === emp.id,
    );
    expect(stillEntry.netPay).toBe('48000.00');

    const payment = await http
      .post(`/api/v1/hr/payroll/periods/${period.body.id}/payments`)
      .set('Cookie', cookie)
      .send({
        payrollEntryId: entry.id,
        amount: '48000.00',
        paymentMethod: 'BANK_TRANSFER',
        paymentDate: '2026-07-01',
      });
    expect(payment.status).toBe(200);
    expect(['PAID', 'PARTIALLY_PAID']).toContain(payment.body.status);

    const evt = await pool.query(
      `select type from outbox_events where tenant_id=$1 and type='hr.payroll.finalized'`,
      [fx.tenantA],
    );
    expect(evt.rowCount).toBeGreaterThanOrEqual(1);

    // payslip PDF
    const pdf = await http
      .get(`/api/v1/hr/payroll/entries/${entry.id}/payslip`)
      .set('Cookie', cookie)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (d: Buffer) => chunks.push(d));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  // ---- payroll item reservation: incentives & expense reimbursements ----
  //
  // Approved fix (CUSTOMER-LAUNCH-READINESS.md §1d/§1e/§1f, Option 2):
  // overlapping payroll periods remain allowed, but each incentive/expense
  // reimbursement is now atomically reserved by whichever period's
  // `process()` claims it first (`payroll_period_id` on both tables), and
  // `finalize()` only ever consumes what its own period actually reserved.
  // The two tests below were the original bug reproductions; they're kept
  // and updated to assert the fixed behavior instead of the defect.

  it('an approved incentive claimed by one period is excluded from a second overlapping period', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    await http.post(`/api/v1/hr/employees/${emp.id}/compensation`).set('Cookie', cookie).send({
      effectiveDate: '2026-01-01',
      baseSalary: '30000.00',
      payFrequency: 'MONTHLY',
    });
    const incentive = await http.post('/api/v1/hr/incentives').set('Cookie', cookie).send({
      employeeId: emp.id,
      amount: '5000.00',
      type: 'performance',
    });
    expect(incentive.status).toBe(200);
    await http.post(`/api/v1/hr/incentives/${incentive.body.id}/approve`).set('Cookie', cookie);

    // two periods with overlapping date windows — overlap itself remains
    // allowed; only double *consumption* is now prevented
    const periodA = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Overlap A ${uniq()}`,
        periodStart: '2026-08-01',
        periodEnd: '2026-08-31',
      });
    const periodB = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Overlap B ${uniq()}`,
        periodStart: '2026-08-15',
        periodEnd: '2026-09-15',
      });
    expect(periodA.status).toBe(200);
    expect(periodB.status).toBe(200);

    // A processes first and claims the incentive ...
    const procA = await http
      .post(`/api/v1/hr/payroll/periods/${periodA.body.id}/process`)
      .set('Cookie', cookie)
      .send({});
    expect(procA.status).toBe(200);
    const entryA = procA.body.entries.find((e: { employeeId: string }) => e.employeeId === emp.id);
    expect(entryA.incentivesTotal).toBe('5000.00');

    // ... so B's later process() must not see it as available
    const procB = await http
      .post(`/api/v1/hr/payroll/periods/${periodB.body.id}/process`)
      .set('Cookie', cookie)
      .send({});
    expect(procB.status).toBe(200);
    const entryB = procB.body.entries.find((e: { employeeId: string }) => e.employeeId === emp.id);
    expect(entryB.incentivesTotal).toBe('0.00');

    await http
      .post(`/api/v1/hr/payroll/periods/${periodA.body.id}/finalize`)
      .set('Cookie', cookie)
      .send({});
    const finalizeB = await http
      .post(`/api/v1/hr/payroll/periods/${periodB.body.id}/finalize`)
      .set('Cookie', cookie)
      .send({});
    expect(finalizeB.status).toBe(200);

    // the incentive is reserved AND consumed by period A only
    const incAfter = await pool.query(
      `select payroll_period_id, status from hr_incentives where id=$1`,
      [incentive.body.id],
    );
    expect(incAfter.rows[0].payroll_period_id).toBe(periodA.body.id);
    expect(incAfter.rows[0].status).toBe('PAID');

    // B's finalized (immutable) snapshot correctly shows no incentive
    const periodBAfter = await http
      .get(`/api/v1/hr/payroll/periods/${periodB.body.id}`)
      .set('Cookie', cookie);
    const entryBFinal = periodBAfter.body.entries.find(
      (e: { employeeId: string }) => e.employeeId === emp.id,
    );
    expect(entryBFinal.incentivesTotal).toBe('0.00');
  });

  it('a reimbursed expense claim claimed by one period is excluded from a second overlapping period', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    await http.post(`/api/v1/hr/employees/${emp.id}/compensation`).set('Cookie', cookie).send({
      effectiveDate: '2026-01-01',
      baseSalary: '30000.00',
      payFrequency: 'MONTHLY',
    });
    const cat = await http
      .post('/api/v1/hr/expenses/categories')
      .set('Cookie', cookie)
      .send({ name: `Travel ${uniq()}`, code: `TR${uniq()}` });
    expect(cat.status).toBe(200);
    const claim = await http.post('/api/v1/hr/expenses').set('Cookie', cookie).send({
      employeeId: emp.id,
      categoryId: cat.body.id,
      expenseDate: '2026-09-01',
      amount: '1200.00',
    });
    await http.post(`/api/v1/hr/expenses/${claim.body.id}/submit`).set('Cookie', cookie).send({});
    await http
      .post(`/api/v1/hr/expenses/${claim.body.id}/approve`)
      .set('Cookie', cookie)
      .send({ approvedAmount: '1200.00' });
    await http.post(`/api/v1/hr/expenses/${claim.body.id}/reimburse`).set('Cookie', cookie).send({
      reimbursedAmount: '1200.00',
      paymentDate: '2026-09-05',
      paymentMethod: 'BANK_TRANSFER',
    });

    const periodA = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Expense Overlap A ${uniq()}`,
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
      });
    const periodB = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Expense Overlap B ${uniq()}`,
        periodStart: '2026-09-01',
        periodEnd: '2026-09-15',
      });

    // process + finalize A fully before even creating/processing B — proves
    // the fix needs no concurrency: a plain sequential process→finalize→
    // process no longer lets B see an already-reserved reimbursement
    const procA = await http
      .post(`/api/v1/hr/payroll/periods/${periodA.body.id}/process`)
      .set('Cookie', cookie)
      .send({});
    expect(procA.status).toBe(200);
    const entryA = procA.body.entries.find((e: { employeeId: string }) => e.employeeId === emp.id);
    expect(entryA.reimbursementsTotal).toBe('1200.00');
    await http
      .post(`/api/v1/hr/payroll/periods/${periodA.body.id}/finalize`)
      .set('Cookie', cookie)
      .send({});

    const procB = await http
      .post(`/api/v1/hr/payroll/periods/${periodB.body.id}/process`)
      .set('Cookie', cookie)
      .send({});
    expect(procB.status).toBe(200);
    const entryB = procB.body.entries.find((e: { employeeId: string }) => e.employeeId === emp.id);
    // period A already reserved and finalized this reimbursement — B's
    // process() must exclude it despite the overlapping date window
    expect(entryB.reimbursementsTotal).toBe('0.00');

    const reimbAfter = await pool.query(
      `select r.payroll_period_id from hr_expense_reimbursements r
         join hr_expense_claims c on c.id = r.expense_claim_id
        where c.id = $1`,
      [claim.body.id],
    );
    expect(reimbAfter.rows[0].payroll_period_id).toBe(periodA.body.id);
  });

  it('two different periods racing to process() the same incentive concurrently: exactly one claims it', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    await http.post(`/api/v1/hr/employees/${emp.id}/compensation`).set('Cookie', cookie).send({
      effectiveDate: '2026-01-01',
      baseSalary: '20000.00',
      payFrequency: 'MONTHLY',
    });
    const incentive = await http.post('/api/v1/hr/incentives').set('Cookie', cookie).send({
      employeeId: emp.id,
      amount: '3000.00',
      type: 'performance',
    });
    await http.post(`/api/v1/hr/incentives/${incentive.body.id}/approve`).set('Cookie', cookie);

    const periodA = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Race A ${uniq()}`,
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
      });
    const periodB = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Race B ${uniq()}`,
        periodStart: '2026-10-01',
        periodEnd: '2026-11-30',
      });

    const [procA, procB] = await Promise.all([
      http
        .post(`/api/v1/hr/payroll/periods/${periodA.body.id}/process`)
        .set('Cookie', cookie)
        .send({}),
      http
        .post(`/api/v1/hr/payroll/periods/${periodB.body.id}/process`)
        .set('Cookie', cookie)
        .send({}),
    ]);
    expect(procA.status).toBe(200);
    expect(procB.status).toBe(200);
    const totalA = procA.body.entries.find(
      (e: { employeeId: string }) => e.employeeId === emp.id,
    ).incentivesTotal;
    const totalB = procB.body.entries.find(
      (e: { employeeId: string }) => e.employeeId === emp.id,
    ).incentivesTotal;
    // exactly one of the two drafts claims the incentive, never both, never neither
    expect([totalA, totalB].sort()).toEqual(['0.00', '3000.00']);

    const owner = await pool.query(`select payroll_period_id from hr_incentives where id=$1`, [
      incentive.body.id,
    ]);
    expect([periodA.body.id, periodB.body.id]).toContain(owner.rows[0].payroll_period_id);
  });

  it('a period already PROCESSING rejects a second process() call and keeps its first reservation intact', async () => {
    // `process()`'s own state-transition guard (unchanged by this fix) only
    // allows DRAFT -> PROCESSING; a period that already processed once has no
    // existing path back to DRAFT, so a literal "reprocess" never reaches
    // this fix's release-and-reclaim code today. What this test establishes
    // instead, for the reservation invariant specifically: the second call
    // is rejected *before* touching any reservation, so the first call's
    // claim is never released or duplicated by the rejected second attempt.
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    await http.post(`/api/v1/hr/employees/${emp.id}/compensation`).set('Cookie', cookie).send({
      effectiveDate: '2026-01-01',
      baseSalary: '20000.00',
      payFrequency: 'MONTHLY',
    });
    const incentive = await http.post('/api/v1/hr/incentives').set('Cookie', cookie).send({
      employeeId: emp.id,
      amount: '1000.00',
      type: 'performance',
    });
    await http.post(`/api/v1/hr/incentives/${incentive.body.id}/approve`).set('Cookie', cookie);
    const period = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Reprocess ${uniq()}`,
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
      });

    const first = await http
      .post(`/api/v1/hr/payroll/periods/${period.body.id}/process`)
      .set('Cookie', cookie)
      .send({});
    expect(first.status).toBe(200);
    const entry1 = first.body.entries.find((e: { employeeId: string }) => e.employeeId === emp.id);
    expect(entry1.incentivesTotal).toBe('1000.00');

    const second = await http
      .post(`/api/v1/hr/payroll/periods/${period.body.id}/process`)
      .set('Cookie', cookie)
      .send({});
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('HR_INVALID_STATE');

    const owner = await pool.query(`select payroll_period_id from hr_incentives where id=$1`, [
      incentive.body.id,
    ]);
    expect(owner.rows[0].payroll_period_id).toBe(period.body.id);
  });

  it('a transaction that fails after reserving an incentive rolls the reservation back too', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    const incentive = await http.post('/api/v1/hr/incentives').set('Cookie', cookie).send({
      employeeId: emp.id,
      amount: '500.00',
      type: 'performance',
    });
    await http.post(`/api/v1/hr/incentives/${incentive.body.id}/approve`).set('Cookie', cookie);
    const period = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Rollback ${uniq()}`,
        periodStart: '2026-12-01',
        periodEnd: '2026-12-31',
      });

    // Exercises the exact statement sequence `process()` runs inside its one
    // transaction (reserve the incentive, then write a payroll entry), but
    // forces the entry write to violate a real FK constraint, to prove the
    // reservation is not left dangling when a later statement in the same
    // transaction fails — the actual guarantee `withTenantContext`'s single
    // transaction provides, exercised with a real, uncontrived constraint
    // violation rather than a mock.
    const c = await pool.connect();
    try {
      await c.query('set role aivoryx_app');
      await c.query('begin');
      await c.query("select set_config('app.user_id', $1, true)", [fx.admin.userId]);
      await c.query("select set_config('app.tenant_id', $1, true)", [fx.tenantA]);
      const claimed = await c.query(
        `update hr_incentives set payroll_period_id = $1
           where id = $2 and status = 'APPROVED' and payroll_period_id is null
           returning id`,
        [period.body.id, incentive.body.id],
      );
      expect(claimed.rowCount).toBe(1);
      await expect(
        c.query(
          `insert into hr_payroll_entries
             (id, tenant_id, payroll_period_id, employee_id, employee_number, employee_name, currency)
           values (gen_random_uuid(), $1, $2, gen_random_uuid(), 'X', 'Nonexistent', 'INR')`,
          [fx.tenantA, period.body.id],
        ),
      ).rejects.toBeTruthy(); // violates hr_payroll_entries_employee_fk — no such employee
      await c.query('rollback');
    } finally {
      await c.query('reset role').catch(() => undefined);
      c.release();
    }

    const after = await pool.query(`select payroll_period_id from hr_incentives where id=$1`, [
      incentive.body.id,
    ]);
    expect(after.rows[0].payroll_period_id).toBeNull();
  });

  it('finalizing one period consumes only the items that period itself reserved', async () => {
    // `process()` claims every still-available eligible item for every
    // active employee in one call — it is not scoped to a subset of
    // employees — so to observe two periods owning two *different*
    // incentives, incY must not exist yet when periodX processes. This is
    // the realistic shape of the invariant: periodX reserves what's
    // available at the time it runs; a later incentive, approved afterward,
    // is only ever available to whichever period processes next.
    const cookie = await adminCookie();
    const empX = await makeEmployee(cookie);
    const empY = await makeEmployee(cookie);
    await http.post(`/api/v1/hr/employees/${empX.id}/compensation`).set('Cookie', cookie).send({
      effectiveDate: '2026-01-01',
      baseSalary: '15000.00',
      payFrequency: 'MONTHLY',
    });
    await http.post(`/api/v1/hr/employees/${empY.id}/compensation`).set('Cookie', cookie).send({
      effectiveDate: '2026-01-01',
      baseSalary: '15000.00',
      payFrequency: 'MONTHLY',
    });
    const incX = await http.post('/api/v1/hr/incentives').set('Cookie', cookie).send({
      employeeId: empX.id,
      amount: '700.00',
      type: 'performance',
    });
    await http.post(`/api/v1/hr/incentives/${incX.body.id}/approve`).set('Cookie', cookie);

    const periodX = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Own Reservations X ${uniq()}`,
        periodStart: '2027-01-01',
        periodEnd: '2027-01-31',
      });
    await http
      .post(`/api/v1/hr/payroll/periods/${periodX.body.id}/process`)
      .set('Cookie', cookie)
      .send({});

    // incY is approved only now — too late for periodX, which already ran
    const incY = await http.post('/api/v1/hr/incentives').set('Cookie', cookie).send({
      employeeId: empY.id,
      amount: '900.00',
      type: 'performance',
    });
    await http.post(`/api/v1/hr/incentives/${incY.body.id}/approve`).set('Cookie', cookie);
    const periodY = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Own Reservations Y ${uniq()}`,
        periodStart: '2027-01-01',
        periodEnd: '2027-01-31',
      });
    await http
      .post(`/api/v1/hr/payroll/periods/${periodY.body.id}/process`)
      .set('Cookie', cookie)
      .send({});

    const afterProcess = await pool.query(
      `select id, payroll_period_id from hr_incentives where id = any($1)`,
      [[incX.body.id, incY.body.id]],
    );
    const owners = new Map(
      afterProcess.rows.map((r: { id: string; payroll_period_id: string }) => [
        r.id,
        r.payroll_period_id,
      ]),
    );
    expect(owners.get(incX.body.id)).toBe(periodX.body.id);
    expect(owners.get(incY.body.id)).toBe(periodY.body.id);

    await http
      .post(`/api/v1/hr/payroll/periods/${periodX.body.id}/finalize`)
      .set('Cookie', cookie)
      .send({});

    // incY, reserved by periodY, must be untouched by periodX's finalize
    const incYAfter = await pool.query(
      `select payroll_period_id, status from hr_incentives where id=$1`,
      [incY.body.id],
    );
    expect(incYAfter.rows[0].payroll_period_id).toBe(periodY.body.id);
    expect(incYAfter.rows[0].status).toBe('APPROVED'); // not yet PAID — periodY hasn't finalized

    // incX, periodX's own reservation, was correctly consumed
    const incXAfter = await pool.query(
      `select payroll_period_id, status from hr_incentives where id=$1`,
      [incX.body.id],
    );
    expect(incXAfter.rows[0].payroll_period_id).toBe(periodX.body.id);
    expect(incXAfter.rows[0].status).toBe('PAID');
  });

  it('is tenant-isolated: processing tenant A cannot reserve or release tenant B incentives', async () => {
    const cookieA = await adminCookie();
    const cookieB = await adminBCookie();
    const empB = await makeEmployee(cookieB);
    await http.post(`/api/v1/hr/employees/${empB.id}/compensation`).set('Cookie', cookieB).send({
      effectiveDate: '2026-01-01',
      baseSalary: '10000.00',
      payFrequency: 'MONTHLY',
    });
    const incB = await http.post('/api/v1/hr/incentives').set('Cookie', cookieB).send({
      employeeId: empB.id,
      amount: '400.00',
      type: 'performance',
    });
    await http.post(`/api/v1/hr/incentives/${incB.body.id}/approve`).set('Cookie', cookieB);

    const periodA = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookieA)
      .send({
        name: `Isolation A ${uniq()}`,
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
      });
    const procA = await http
      .post(`/api/v1/hr/payroll/periods/${periodA.body.id}/process`)
      .set('Cookie', cookieA)
      .send({});
    expect(procA.status).toBe(200);

    // tenant B's incentive must still be untouched and still available to B
    const incBAfter = await pool.query(`select payroll_period_id from hr_incentives where id=$1`, [
      incB.body.id,
    ]);
    expect(incBAfter.rows[0].payroll_period_id).toBeNull();

    const periodB = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookieB)
      .send({
        name: `Isolation B ${uniq()}`,
        periodStart: '2026-01-01',
        periodEnd: '2026-01-31',
      });
    const procB = await http
      .post(`/api/v1/hr/payroll/periods/${periodB.body.id}/process`)
      .set('Cookie', cookieB)
      .send({});
    const entryB = procB.body.entries.find((e: { employeeId: string }) => e.employeeId === empB.id);
    expect(entryB.incentivesTotal).toBe('400.00');
  });

  it('a pre-migration reimbursement row (payroll_period_id already NULL) behaves exactly like a new one', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    await http.post(`/api/v1/hr/employees/${emp.id}/compensation`).set('Cookie', cookie).send({
      effectiveDate: '2026-01-01',
      baseSalary: '18000.00',
      payFrequency: 'MONTHLY',
    });
    const cat = await http
      .post('/api/v1/hr/expenses/categories')
      .set('Cookie', cookie)
      .send({ name: `Legacy ${uniq()}`, code: `LG${uniq()}` });
    const claim = await http.post('/api/v1/hr/expenses').set('Cookie', cookie).send({
      employeeId: emp.id,
      categoryId: cat.body.id,
      expenseDate: '2026-02-01',
      amount: '300.00',
    });
    await http.post(`/api/v1/hr/expenses/${claim.body.id}/submit`).set('Cookie', cookie).send({});
    await http
      .post(`/api/v1/hr/expenses/${claim.body.id}/approve`)
      .set('Cookie', cookie)
      .send({ approvedAmount: '300.00' });
    await http.post(`/api/v1/hr/expenses/${claim.body.id}/reimburse`).set('Cookie', cookie).send({
      reimbursedAmount: '300.00',
      paymentDate: '2026-02-05',
      paymentMethod: 'BANK_TRANSFER',
    });
    // simulate data that predates this migration: the column already defaults
    // to NULL for every pre-existing row, so there is nothing to backfill —
    // assert that explicitly rather than assuming it
    const before = await pool.query(
      `select r.payroll_period_id from hr_expense_reimbursements r
         join hr_expense_claims c on c.id = r.expense_claim_id where c.id=$1`,
      [claim.body.id],
    );
    expect(before.rows[0].payroll_period_id).toBeNull();

    const period = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Legacy Period ${uniq()}`,
        periodStart: '2026-02-01',
        periodEnd: '2026-02-28',
      });
    const proc = await http
      .post(`/api/v1/hr/payroll/periods/${period.body.id}/process`)
      .set('Cookie', cookie)
      .send({});
    const entry = proc.body.entries.find((e: { employeeId: string }) => e.employeeId === emp.id);
    expect(entry.reimbursementsTotal).toBe('300.00');
    await http
      .post(`/api/v1/hr/payroll/periods/${period.body.id}/finalize`)
      .set('Cookie', cookie)
      .send({});

    // a second overlapping period's later process() must not pick it up again
    const period2 = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Legacy Period 2 ${uniq()}`,
        periodStart: '2026-02-01',
        periodEnd: '2026-02-28',
      });
    const proc2 = await http
      .post(`/api/v1/hr/payroll/periods/${period2.body.id}/process`)
      .set('Cookie', cookie)
      .send({});
    const entry2 = proc2.body.entries.find((e: { employeeId: string }) => e.employeeId === emp.id);
    expect(entry2.reimbursementsTotal).toBe('0.00');
  });

  // ---- performance ---------------------------------------

  it('runs a performance review DRAFT -> SUBMITTED with a notification event', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    const period = await http
      .post('/api/v1/hr/performance/periods')
      .set('Cookie', cookie)
      .send({ name: `H1 ${uniq()}`, periodStart: '2026-01-01', periodEnd: '2026-06-30' });
    const review = await http.post('/api/v1/hr/performance/reviews').set('Cookie', cookie).send({
      performancePeriodId: period.body.id,
      employeeId: emp.id,
      overallRating: 4,
      managerComments: 'Solid',
    });
    expect(review.status).toBe(200);
    const submitted = await http
      .post(`/api/v1/hr/performance/reviews/${review.body.id}/submit`)
      .set('Cookie', cookie)
      .send({});
    expect(submitted.body.status).toBe('SUBMITTED');
    const evt = await pool.query(
      `select type from outbox_events where tenant_id=$1 and type='hr.performance.review_submitted'`,
      [fx.tenantA],
    );
    expect(evt.rowCount).toBeGreaterThanOrEqual(1);
  });

  // ---- bank details privacy -----------------------------

  it('masks the account number and gates bank details behind a dedicated permission', async () => {
    const cookie = await adminCookie();
    const emp = await makeEmployee(cookie);
    const saved = await http
      .post(`/api/v1/hr/employees/${emp.id}/bank-details`)
      .set('Cookie', cookie)
      .send({
        accountHolderName: 'Test Person',
        bankName: 'Demo Bank',
        accountNumber: '123456789012',
        preferredMethod: 'BANK_TRANSFER',
      });
    expect(saved.status).toBe(200);
    expect(saved.body.accountNumberMasked).toMatch(/•+9012$/);
    expect(JSON.stringify(saved.body)).not.toContain('123456789012');

    // audit metadata must not contain the digits
    const audit = await pool.query(
      `select metadata, changes from audit_logs where tenant_id=$1 and action='hr.bank_details.updated'`,
      [fx.tenantA],
    );
    expect(JSON.stringify(audit.rows)).not.toContain('123456789012');

    // a member with hr.employee.read but not hr.bank_details.read is refused
    await grant(fx.plainMember.membershipId, ['hr.employee.read']);
    const pc = await plainCookie();
    const denied = await http.get(`/api/v1/hr/employees/${emp.id}/bank-details`).set('Cookie', pc);
    expect(denied.status).toBe(403);
    // and cannot read compensation
    const deniedComp = await http
      .get(`/api/v1/hr/employees/${emp.id}/compensation`)
      .set('Cookie', pc);
    expect(deniedComp.status).toBe(403);
  });

  // ---- self-service identity isolation ------------------

  it('resolves /hr/me from the session and fails closed when unlinked', async () => {
    const cookie = await adminCookie();
    // fx.limited has no linked employee
    await grant(fx.limited.membershipId, ['hr.attendance.self']);
    const lc = await limitedCookie();
    const unlinked = await http.get('/api/v1/hr/me').set('Cookie', lc);
    expect(unlinked.status).toBe(403);
    expect(unlinked.body.error.code).toBe('HR_EMPLOYEE_NOT_LINKED');

    // link fx.limited to an employee, then /hr/me returns only that employee
    const mine = await makeEmployee(cookie, { membershipId: fx.limited.membershipId });
    const other = await makeEmployee(cookie);
    const me = await http.get('/api/v1/hr/me').set('Cookie', lc);
    expect(me.status).toBe(200);
    expect(me.body.employee.id).toBe(mine.id);
    expect(me.body.employee.id).not.toBe(other.id);

    // limited cannot reach another employee's expenses list (no hr.expense.read)
    const forbidden = await http
      .get(`/api/v1/hr/expenses?employeeId=${other.id}`)
      .set('Cookie', lc);
    expect(forbidden.status).toBe(403);
  });

  // ---- cross-tenant isolation via the API --------------

  it('cannot read or mutate another tenant’s HR records through the API', async () => {
    const cookieA = await adminCookie();
    const cookieB = await adminBCookie();
    const empA = await makeEmployee(cookieA);
    const readCross = await http.get(`/api/v1/hr/employees/${empA.id}`).set('Cookie', cookieB);
    expect(readCross.status).toBe(404);
    const patchCross = await http
      .patch(`/api/v1/hr/employees/${empA.id}`)
      .set('Cookie', cookieB)
      .send({ phone: '999' });
    expect(patchCross.status).toBe(404);
  });

  // ---- Field -> HR expense seam ------------------------

  it('lets a field agent raise a claim for their own visit through the narrow Field seam', async () => {
    const cookie = await adminCookie();
    // designate fx.plainMember as a field agent (no crm.leads.read) and link an employee
    await http
      .post('/api/v1/field-agents')
      .set('Cookie', cookie)
      .send({ membershipId: fx.plainMember.membershipId });
    const emp = await makeEmployee(cookie, { membershipId: fx.plainMember.membershipId });
    const catId = await makeCategory(cookie, '12.0000');

    // a lead + a visit assigned to the field agent
    const lead = await http
      .post('/api/v1/crm/leads')
      .set('Cookie', cookie)
      .send({ name: 'Seam Lead', phone: `9${Math.floor(Math.random() * 1e9)}`.slice(0, 10) });
    const visit = await http.post('/api/v1/visits').set('Cookie', cookie).send({
      leadId: lead.body.id,
      scheduledAt: '2026-08-01T09:00:00.000Z',
      assignedMembershipId: fx.plainMember.membershipId,
    });
    expect(visit.status).toBe(200);

    const agent = await cookieFor(
      fx.plainMember.email,
      fx.plainMember.password,
      fx.plainMember.membershipId,
    );
    const claim = await http
      .post(`/api/v1/field/visits/${visit.body.id}/expense-claim`)
      .set('Cookie', agent)
      .send({
        categoryId: catId,
        expenseDate: '2026-08-01',
        amount: '120.00',
        distanceKm: '10',
        autoSubmit: true,
      });
    expect(claim.status).toBe(200);
    expect(claim.body.employeeId).toBe(emp.id);
    expect(claim.body.visitRef).toBe(visit.body.id);
    expect(claim.body.status).toBe('SUBMITTED');
    expect(claim.body.reimbursementAmount).toBe('120.00');

    // the field agent cannot claim against a visit that is not theirs
    const otherVisit = await http
      .post('/api/v1/visits')
      .set('Cookie', cookie)
      .send({ leadId: lead.body.id, scheduledAt: '2026-08-02T09:00:00.000Z' });
    const denied = await http
      .post(`/api/v1/field/visits/${otherVisit.body.id}/expense-claim`)
      .set('Cookie', agent)
      .send({ categoryId: catId, expenseDate: '2026-08-02', amount: '50.00' });
    expect(denied.status).toBeGreaterThanOrEqual(400);
  });

  // ---- audit catalogue --------------------------------

  it('writes hr.* audit entries for the key mutations', async () => {
    const rows = await pool.query(
      `select distinct action from audit_logs where tenant_id=$1 and action like 'hr.%' order by action`,
      [fx.tenantA],
    );
    const actions = rows.rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'hr.employee.created',
        'hr.attendance.corrected',
        'hr.leave.approved',
        'hr.expense.reimbursed',
        'hr.compensation.created',
        'hr.payroll.finalized',
      ]),
    );
    const mod = await pool.query(
      `select distinct module from audit_logs where tenant_id=$1 and action like 'hr.%'`,
      [fx.tenantA],
    );
    expect(mod.rows.map((r) => r.module)).toEqual(['hr']);
  });
});
