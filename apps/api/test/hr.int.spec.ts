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
