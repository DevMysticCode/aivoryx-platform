import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * HR & Workforce golden path (Phase 12, ADR 0041).
 *
 * Executes end-to-end against a running web app + API + PostgreSQL + Redis with
 * the demo seeds loaded and the API started with `EMAIL_PROVIDER=fake`:
 *
 *   RUN_HR_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 E2E_API_BASE_URL=http://localhost:4000 \
 *   pnpm --filter @aivoryx/web test:e2e hr.spec.ts
 *
 * Like `audit.spec.ts` and the verification half of `finance.spec.ts`, the
 * multi-entity workflow runs through the live API `request` context (fast and
 * deterministic) while the browser renders and asserts the principal HR
 * screens. Every request hits the same running API + database + Redis the UI
 * uses.
 *
 * Steps 1-28 of the brief's golden path: 1 sign in · 2 HR dashboard ·
 * 3 department · 4 designation · 5 location · 6 schedule · 7 employee ·
 * 8 manager · 9 reporting line · 10 org hierarchy · 11 link membership ·
 * 12 lifecycle + schedule on the employee · 13 record attendance (+ correction)
 * · 14 leave type · 15 leave request · 16 approve · 17 verify balance
 * consumption · 18 expense category · 19 expense claim · 20 attach receipt ·
 * 21 approve expense · 22 record reimbursement · 23 configure compensation ·
 * 24 payroll period · 25 process · 26 finalize (immutable snapshot) ·
 * 27 record payment + view payslip PDF · 28 performance goal + review + submit.
 * Then: Audit Log carries hr.* events · notification endpoint healthy ·
 *       a field agent cannot read another employee's compensation / bank ·
 *       a field agent raises a claim through the Field → HR seam ·
 *       the principal HR screens render with the created data.
 */
const ENABLED = process.env.RUN_HR_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000';
const AGENT_EMAIL = process.env.E2E_AGENT_EMAIL ?? 'agent@clans-demo.test';
const AGENT_PASSWORD = process.env.E2E_AGENT_PASSWORD ?? 'Demo-Passw0rd!';

interface Session {
  cookie: string;
  membershipId: string;
}

async function apiLogin(
  request: APIRequestContext,
  email: string,
  password: string,
): Promise<Session> {
  const res = await request.post(`${API_BASE}/api/v1/auth/login`, { data: { email, password } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  const raw = res.headers()['set-cookie'] ?? '';
  const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]!;
  const membershipId = (await res.json()).memberships?.[0]?.id as string;
  await request.post(`${API_BASE}/api/v1/auth/switch-tenant`, {
    headers: { cookie },
    data: { membershipId },
  });
  return { cookie, membershipId };
}

test.describe('HR & Workforce golden path', () => {
  test.skip(!ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD, 'set RUN_HR_E2E=1 + E2E_ADMIN_*');
  test.setTimeout(180_000);

  test('org → employee → attendance → leave → expense → payroll → payslip → performance', async ({
    page,
    request,
  }) => {
    const s = Date.now().toString().slice(-7);
    const admin = await apiLogin(request, ADMIN_EMAIL, ADMIN_PASSWORD);
    const agent = await apiLogin(request, AGENT_EMAIL, AGENT_PASSWORD);
    const H = { cookie: admin.cookie, 'content-type': 'application/json' };
    const AH = { cookie: agent.cookie, 'content-type': 'application/json' };

    const post = (path: string, data: unknown, headers = H) =>
      request.post(`${API_BASE}/api/v1${path}`, { headers, data });
    const get = (path: string, headers = H) =>
      request.get(`${API_BASE}/api/v1${path}`, { headers });
    const ok = async (rp: ReturnType<typeof post>, label: string) => {
      const r = await rp;
      expect(r.status(), `${label} → ${r.status()} ${await r.text()}`).toBe(200);
      return r.json();
    };

    // 1. sign in (browser)
    await page.goto('/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    // 2. HR dashboard renders (browser)
    await page.goto('/hr');
    await expect(page.getByRole('heading', { name: 'HR & Workforce' })).toBeVisible();
    await expect(page.getByText('Present today')).toBeVisible();

    // 3-6. organisation config
    const dept = await ok(
      post('/hr/departments', { name: `E2E Dept ${s}`, code: `ED${s}` }),
      'department',
    );
    const desig = await ok(
      post('/hr/designations', { name: `E2E Role ${s}`, code: `ER${s}` }),
      'designation',
    );
    const loc = await ok(
      post('/hr/locations', {
        name: `E2E HQ ${s}`,
        code: `EH${s}`,
        latitude: '12.9716',
        longitude: '77.5946',
      }),
      'location',
    );
    const sched = await ok(
      post('/hr/schedules', {
        name: `E2E Shift ${s}`,
        startTime: '09:00',
        endTime: '18:00',
        graceMinutes: 10,
        locationId: loc.id,
      }),
      'schedule',
    );

    // 7-9. employee + manager + reporting line
    const manager = await ok(
      post('/hr/employees', {
        firstName: 'Mgr',
        lastName: `E2E${s}`,
        joiningDate: '2025-01-01',
        employmentType: 'FULL_TIME',
        departmentId: dept.id,
        designationId: desig.id,
      }),
      'manager',
    );
    expect(manager.employeeNumber).toMatch(/^EMP-\d{6}$/);
    const employee = await ok(
      post('/hr/employees', {
        firstName: 'Rep',
        lastName: `E2E${s}`,
        workEmail: `rep-${s}@e2e.test`,
        joiningDate: '2025-02-01',
        employmentType: 'FULL_TIME',
        departmentId: dept.id,
        designationId: desig.id,
        workLocationId: loc.id,
        managerId: manager.id,
      }),
      'employee',
    );

    // 10. org hierarchy shows the reporting line
    const chart = await ok(get('/hr/organization/chart'), 'org chart');
    const node = chart.nodes.find((n: { employeeId: string }) => n.employeeId === employee.id);
    expect(node.managerId).toBe(manager.id);

    // 11. link a platform membership — link the manager to the admin's own
    // membership (it may already be linked to the seed's EMP-000001), and
    // separately prove the pre-seeded agent link resolves self-service. The
    // link endpoint rejects a membership already bound to another employee.
    const relink = await post(`/hr/employees/${manager.id}/membership`, {
      membershipId: admin.membershipId,
    });
    expect([200, 422], 'membership link: applied or already-bound').toContain(relink.status());
    const agentMe = await ok(get('/hr/me', AH), 'agent /hr/me');
    expect(agentMe.employee.employeeNumber).toMatch(/^EMP-\d{6}$/); // seed-linked agent resolves
    const agentEmployeeId: string = agentMe.employee.id;

    // 12. lifecycle transition + schedule on the employee
    await ok(
      post(`/hr/employees/${employee.id}/status`, { status: 'ON_LEAVE', reason: 'e2e' }),
      'status→ON_LEAVE',
    );
    await ok(
      post(`/hr/employees/${employee.id}/status`, { status: 'ACTIVE', reason: 'back' }),
      'status→ACTIVE',
    );
    const patched = await request.patch(`${API_BASE}/api/v1/hr/employees/${employee.id}`, {
      headers: H,
      data: { scheduleId: sched.id },
    });
    expect(patched.status(), 'assign schedule').toBe(200);

    // 13. record attendance + an immutable correction
    const att = await ok(
      post('/hr/attendance/record', {
        employeeId: employee.id,
        workDate: '2026-09-01',
        status: 'PRESENT',
      }),
      'attendance record',
    );
    const corrected = await ok(
      post(`/hr/attendance/${att.id}/corrections`, {
        field: 'status',
        value: 'LATE',
        reason: 'arrived 09:15',
      }),
      'attendance correction',
    );
    expect(corrected.status).toBe('LATE');
    expect(corrected.correctionCount).toBe(1);

    // 14-17. leave type → request → approve → balance consumed
    const lt = await ok(
      post('/hr/leave/types', {
        name: `E2E Annual ${s}`,
        code: `EA${s}`,
        annualQuota: '10',
        approverStrategy: 'HR',
      }),
      'leave type',
    );
    const leaveReq = await ok(
      post('/hr/leave/requests', {
        employeeId: employee.id,
        leaveTypeId: lt.id,
        startDate: '2026-10-05',
        endDate: '2026-10-06',
      }),
      'leave request',
    );
    expect(leaveReq.totalDays).toBe('2.00');
    const overlap = await post('/hr/leave/requests', {
      employeeId: employee.id,
      leaveTypeId: lt.id,
      startDate: '2026-10-06',
      endDate: '2026-10-07',
    });
    expect(overlap.status(), 'overlap rejected').toBe(409);
    const approved = await ok(
      post(`/hr/leave/requests/${leaveReq.id}/approve`, {}),
      'approve leave',
    );
    expect(approved.status).toBe('APPROVED');
    const balances = await ok(get(`/hr/leave/balances/${employee.id}`), 'leave balances');
    const b = balances.find((x: { leaveTypeId: string }) => x.leaveTypeId === lt.id);
    expect(b.consumed).toBe('2.00');
    expect(b.balance).toBe('8.00');

    // 18-22. expense category → claim → receipt → approve → reimburse
    const cat = await ok(
      post('/hr/expenses/categories', { name: `E2E Travel ${s}`, code: `ET${s}` }),
      'expense category',
    );
    const claim = await ok(
      post('/hr/expenses', {
        employeeId: employee.id,
        categoryId: cat.id,
        expenseDate: '2026-09-02',
        amount: '900.00',
        description: `E2E claim ${s}`,
      }),
      'expense claim',
    );
    const receipt = await request.post(`${API_BASE}/api/v1/hr/expenses/${claim.id}/receipt`, {
      headers: { cookie: admin.cookie },
      multipart: {
        file: { name: 'receipt.txt', mimeType: 'text/plain', buffer: Buffer.from(`receipt ${s}`) },
      },
    });
    expect(receipt.status(), 'attach receipt').toBe(200);
    expect((await receipt.json()).hasReceipt).toBe(true);
    await ok(post(`/hr/expenses/${claim.id}/submit`, {}), 'submit claim');
    const decided = await ok(
      post(`/hr/expenses/${claim.id}/approve`, { approvedAmount: '800.00' }),
      'approve claim',
    );
    expect(decided.approvedAmount).toBe('800.00');
    const reimbursed = await ok(
      post(`/hr/expenses/${claim.id}/reimburse`, {
        reimbursedAmount: '800.00',
        paymentDate: '2026-09-10',
        paymentMethod: 'BANK_TRANSFER',
        paymentReference: `UTR-E2E-${s}`,
      }),
      'reimburse claim',
    );
    expect(reimbursed.status).toBe('REIMBURSED');

    // 23. configure compensation
    await ok(
      post(`/hr/employees/${employee.id}/compensation`, {
        effectiveDate: '2026-01-01',
        baseSalary: '40000.00',
        payFrequency: 'MONTHLY',
        components: [
          { kind: 'EARNING', name: 'HRA', amount: '10000.00' },
          { kind: 'DEDUCTION', name: 'PF', amount: '2000.00' },
        ],
      }),
      'compensation',
    );

    // 24-27. payroll period → process → finalize → payment → payslip
    const period = await ok(
      post('/hr/payroll/periods', {
        name: `E2E Payrun ${s}`,
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
      }),
      'payroll period',
    );
    const processed = await ok(
      post(`/hr/payroll/periods/${period.id}/process`, {}),
      'process payroll',
    );
    const entry = processed.entries.find(
      (e: { employeeId: string }) => e.employeeId === employee.id,
    );
    // Base 40000 + HRA 10000 + the reimbursed 800 expense in the window
    //   = gross 50800; − PF 2000 = net 48800.
    expect(entry.grossPay).toBe('50800.00');
    expect(entry.reimbursementsTotal).toBe('800.00');
    expect(entry.netPay).toBe('48800.00');
    const finalized = await ok(
      post(`/hr/payroll/periods/${period.id}/finalize`, {}),
      'finalize payroll',
    );
    expect(finalized.status).toBe('FINALIZED');
    // a later salary change must NOT alter the finalized snapshot
    await ok(
      post(`/hr/employees/${employee.id}/compensation`, {
        effectiveDate: '2026-09-15',
        baseSalary: '999999.00',
        payFrequency: 'MONTHLY',
      }),
      'later salary bump',
    );
    const still = await ok(get(`/hr/payroll/periods/${period.id}`), 're-read finalized period');
    expect(
      still.entries.find((e: { employeeId: string }) => e.employeeId === employee.id).netPay,
    ).toBe('48800.00');
    const paid = await ok(
      post(`/hr/payroll/periods/${period.id}/payments`, {
        payrollEntryId: entry.id,
        amount: '48800.00',
        paymentMethod: 'BANK_TRANSFER',
        paymentDate: '2026-10-01',
        paymentReference: `PAYRUN-E2E-${s}`,
      }),
      'record payment',
    );
    expect(['PAID', 'PARTIALLY_PAID']).toContain(paid.status);
    const payslip = await get(`/hr/payroll/entries/${entry.id}/payslip`);
    expect(payslip.status(), 'payslip PDF').toBe(200);
    expect(payslip.headers()['content-type']).toContain('application/pdf');
    expect((await payslip.body()).subarray(0, 4).toString()).toBe('%PDF');

    // 28. performance goal + review + submit
    const perfPeriod = await ok(
      post('/hr/performance/periods', {
        name: `E2E H2 ${s}`,
        periodStart: '2026-07-01',
        periodEnd: '2026-12-31',
      }),
      'performance period',
    );
    await ok(post(`/hr/performance/periods/${perfPeriod.id}/open`, {}), 'open performance period');
    await ok(
      post('/hr/performance/goals', {
        performancePeriodId: perfPeriod.id,
        employeeId: employee.id,
        title: `E2E goal ${s}`,
        weight: 40,
      }),
      'performance goal',
    );
    const review = await ok(
      post('/hr/performance/reviews', {
        performancePeriodId: perfPeriod.id,
        employeeId: employee.id,
        overallRating: 4,
        managerComments: 'E2E solid',
      }),
      'performance review',
    );
    const submittedReview = await ok(
      post(`/hr/performance/reviews/${review.id}/submit`, {}),
      'submit review',
    );
    expect(submittedReview.status).toBe('SUBMITTED');

    // Audit Log carries hr.* events, with no salary figure in metadata
    const audit = await ok(get('/admin/audit?module=hr&pageSize=100'), 'audit log');
    const actions: string[] = audit.items.map((r: { action: string }) => r.action);
    for (const a of [
      'hr.employee.created',
      'hr.attendance.corrected',
      'hr.leave.approved',
      'hr.expense.reimbursed',
      'hr.compensation.created',
      'hr.payroll.finalized',
      'hr.performance.review_submitted',
    ]) {
      expect(actions, `audit has ${a}`).toContain(a);
    }
    expect(JSON.stringify(audit.items)).not.toMatch(/b40000b|b48800b|b50800b|999999/);

    // notification endpoint healthy (the configured HR events flow via the outbox)
    const notifs = await ok(get('/notifications?pageSize=50'), 'notifications');
    expect(Array.isArray(notifs.items)).toBe(true);

    // Employee A cannot read Employee B private HR data
    expect((await get(`/hr/employees/${employee.id}/compensation`, AH)).status()).toBe(403);
    expect((await get(`/hr/employees/${employee.id}/bank-details`, AH)).status()).toBe(403);
    const anon = await request.get(`${API_BASE}/api/v1/hr/employees/${employee.id}/compensation`);
    expect([401, 403]).toContain(anon.status());

    // Field → HR expense seam (field agent, own visit)
    const visits = await get('/visits', AH);
    const visitId = (await visits.json()).items?.[0]?.id as string | undefined;
    if (visitId) {
      const fieldClaim = await request.post(
        `${API_BASE}/api/v1/field/visits/${visitId}/expense-claim`,
        {
          headers: AH,
          data: {
            categoryId: cat.id,
            expenseDate: '2026-09-05',
            amount: '150.00',
            distanceKm: '10',
          },
        },
      );
      expect(fieldClaim.status(), 'field agent raises a claim through the seam').toBe(200);
      const fc = await fieldClaim.json();
      expect(fc.visitRef).toBe(visitId);
      expect(fc.status).toBe('SUBMITTED');
      expect(fc.employeeId).toBe(agentEmployeeId); // resolved server-side from the agent membership
    }

    // browser: the principal HR screens render with the created data
    await page.goto('/hr/employees');
    await expect(page.getByRole('link', { name: `Rep E2E${s}` })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('link', { name: `Rep E2E${s}` }).click();
    await page.waitForURL(/\/hr\/employees\/[0-9a-f-]+$/);
    await page.getByRole('button', { name: 'Compensation' }).click();
    await expect(page.getByText('40,000.00').first()).toBeVisible({ timeout: 15_000 });

    await page.goto('/hr/payroll');
    await expect(page.getByRole('link', { name: `E2E Payrun ${s}` })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('link', { name: `E2E Payrun ${s}` }).click();
    await page.waitForURL(/\/hr\/payroll\/[0-9a-f-]+$/);
    await expect(page.getByText('finalized').first()).toBeVisible();
    await expect(page.getByRole('cell', { name: new RegExp(`Rep E2E${s}`) })).toBeVisible();
  });
});
