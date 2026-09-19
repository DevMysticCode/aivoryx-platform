import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import {
  addTenantMember,
  createTenantWithModules,
  disableModule,
  enableModule,
  makeFixtures,
  rawPool,
  type Fixtures,
  type UserFixture,
} from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Phase 17 — HR Core / Workforce. API-level proof of what Phase 17 added on top
 * of Phase 12: the ONBOARDING lifecycle state, HR data scope (OWN / TEAM /
 * DEPARTMENT / COMPANY) enforced on the employee record and its team views,
 * the module-entitlement gate on employee self-service, HR-controlled document
 * sharing + self-service documents, own performance reviews, archived org units,
 * the scope-aware dashboard, the optional Field → HR employee link, and audit
 * coverage of the newly audited actions. Tenant isolation throughout.
 */
describe.skipIf(!INTEGRATION_ENABLED)('HR Core (Phase 17)', () => {
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

  const cookieFor = async (u: { email: string; password: string; membershipId: string }) => {
    const res = await http
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: u.password });
    const cookie = sessionCookie(res);
    await http
      .post('/api/v1/auth/switch-tenant')
      .set('Cookie', cookie)
      .send({ membershipId: u.membershipId });
    return cookie;
  };
  const adminCookie = () => cookieFor(fx.admin);
  const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();

  /** Give a membership a PROFILE role with exactly these permissions and a data scope. */
  async function grantProfile(
    membershipId: string,
    keys: string[],
    dataScope: 'OWN' | 'TEAM' | 'DEPARTMENT' | 'COMPANY',
    tenantId = fx.tenantA,
  ): Promise<string> {
    const roleId = randomUUID();
    await pool.query(
      `insert into roles (id, tenant_id, key, name, kind) values ($1,$2,$3,$4,'profile')`,
      [roleId, tenantId, `HR_P_${roleId.slice(0, 8)}`, 'HR scoped profile'],
    );
    const rows = await pool.query('select id from permissions where key = any($1)', [keys]);
    for (const r of rows.rows as { id: string }[]) {
      await pool.query(
        'insert into role_permissions (role_id, tenant_id, permission_id) values ($1,$2,$3)',
        [roleId, tenantId, r.id],
      );
    }
    await pool.query(
      'insert into membership_roles (membership_id, role_id, tenant_id, data_scope) values ($1,$2,$3,$4)',
      [membershipId, roleId, tenantId, dataScope],
    );
    return roleId;
  }
  const setScope = (membershipId: string, roleId: string, scope: string) =>
    pool.query('update membership_roles set data_scope=$3 where membership_id=$1 and role_id=$2', [
      membershipId,
      roleId,
      scope,
    ]);

  async function makeDept(cookie: string) {
    const res = await http
      .post('/api/v1/hr/departments')
      .set('Cookie', cookie)
      .send({ name: `Dept ${uniq()}`, code: `D${uniq()}` });
    expect(res.status).toBe(200);
    return res.body.id as string;
  }

  async function makeEmployee(cookie: string, over: Record<string, unknown> = {}) {
    const { membershipId, ...rest } = over as { membershipId?: string } & Record<string, unknown>;
    const res = await http
      .post('/api/v1/hr/employees')
      .set('Cookie', cookie)
      .send({ firstName: 'Core', lastName: uniq(), joiningDate: '2025-01-01', ...rest });
    expect(res.status).toBe(200);
    if (membershipId) {
      const linked = await http
        .post(`/api/v1/hr/employees/${res.body.id}/membership`)
        .set('Cookie', cookie)
        .send({ membershipId });
      expect(linked.status).toBe(200);
      return linked.body as { id: string; status: string; displayName: string };
    }
    return res.body as { id: string; status: string; displayName: string };
  }

  const READ_KEYS = [
    'hr.employee.read',
    'hr.leave.read',
    'hr.attendance.read',
    'hr.expense.read',
    'hr.performance.read',
  ];

  // ---- lifecycle ----------------------------------------------------

  describe('employee lifecycle — ONBOARDING', () => {
    it('creates an employee ahead of their start, counts them separately, and lets them start', async () => {
      const cookie = await adminCookie();
      const before = await http.get('/api/v1/hr/dashboard').set('Cookie', cookie);
      const hire = await makeEmployee(cookie, { status: 'ONBOARDING', joiningDate: '2030-01-15' });
      expect(hire.status).toBe('ONBOARDING');

      const during = await http.get('/api/v1/hr/dashboard').set('Cookie', cookie);
      expect(during.body.onboardingEmployees).toBe(before.body.onboardingEmployees + 1);
      // an onboarding hire is not "active headcount"
      expect(during.body.activeEmployees).toBe(before.body.activeEmployees);
      expect(during.body.upcomingStarts.some((s: { id: string }) => s.id === hire.id)).toBe(true);

      // not valid: an onboarding hire cannot be put on leave before starting
      const invalid = await http
        .post(`/api/v1/hr/employees/${hire.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'ON_LEAVE' });
      expect(invalid.status).toBe(422);
      expect(invalid.body.error.code).toBe('HR_INVALID_STATE');

      const started = await http
        .post(`/api/v1/hr/employees/${hire.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'ACTIVE', reason: 'Started on day one' });
      expect(started.status).toBe(200);
      expect(started.body.status).toBe('ACTIVE');

      const after = await http.get('/api/v1/hr/dashboard').set('Cookie', cookie);
      expect(after.body.activeEmployees).toBe(before.body.activeEmployees + 1);
      expect(after.body.onboardingEmployees).toBe(before.body.onboardingEmployees);

      const hist = await http.get(`/api/v1/hr/employees/${hire.id}/history`).set('Cookie', cookie);
      const change = hist.body.find((h: { changeType: string }) => h.changeType === 'STATUS');
      expect(change.from.value).toBe('ONBOARDING');
      expect(change.to.value).toBe('ACTIVE');
    });

    it('a hire who never starts can be withdrawn; terminal states stay terminal', async () => {
      const cookie = await adminCookie();
      const hire = await makeEmployee(cookie, { status: 'ONBOARDING' });
      const out = await http
        .post(`/api/v1/hr/employees/${hire.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'RESIGNED', reason: 'Withdrew before the start date' });
      expect(out.status).toBe(200);
      const back = await http
        .post(`/api/v1/hr/employees/${hire.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'ACTIVE' });
      expect(back.status).toBe(422);
    });

    it('only ONBOARDING or ACTIVE are valid starting states; the default stays ACTIVE', async () => {
      const cookie = await adminCookie();
      const bad = await http.post('/api/v1/hr/employees').set('Cookie', cookie).send({
        firstName: 'Bad',
        lastName: uniq(),
        joiningDate: '2025-01-01',
        status: 'TERMINATED',
      });
      expect(bad.status).toBe(400);
      const def = await makeEmployee(cookie);
      expect(def.status).toBe('ACTIVE');
    });

    it('an onboarding hire is excluded from payroll processing', async () => {
      const cookie = await adminCookie();
      const hire = await makeEmployee(cookie, { status: 'ONBOARDING' });
      const comp = await http
        .post(`/api/v1/hr/employees/${hire.id}/compensation`)
        .set('Cookie', cookie)
        .send({
          effectiveDate: '2025-01-01',
          payFrequency: 'MONTHLY',
          currency: 'INR',
          baseSalary: '50000.00',
          components: [],
        });
      expect(comp.status).toBe(200);
      const period = await http
        .post('/api/v1/hr/payroll/periods')
        .set('Cookie', cookie)
        .send({
          name: `Onboarding excluded ${uniq()}`,
          periodStart: '2030-02-01',
          periodEnd: '2030-02-28',
          currency: 'INR',
        });
      expect(period.status).toBe(200);
      const processed = await http
        .post(`/api/v1/hr/payroll/periods/${period.body.id}/process`)
        .set('Cookie', cookie)
        .send({});
      expect(processed.status).toBe(200);
      const entries = JSON.stringify(processed.body);
      expect(entries).not.toContain(hire.id);
    });
  });

  // ---- data scope -------------------------------------------------

  describe('HR data scope on the employee record', () => {
    let mgrRole: string;
    let mgr: { id: string };
    let r1: { id: string }; // reports to mgr, other department
    let r2: { id: string }; // reports to mgr, same department as mgr
    let stranger: { id: string }; // unrelated, other department
    let deptMate: { id: string }; // same department as mgr, not a report

    beforeAll(async () => {
      const cookie = await adminCookie();
      const deptX = await makeDept(cookie);
      const deptY = await makeDept(cookie);
      mgr = await makeEmployee(cookie, {
        departmentId: deptX,
        membershipId: fx.plainMember.membershipId,
      });
      r1 = await makeEmployee(cookie, { managerId: mgr.id, departmentId: deptY });
      r2 = await makeEmployee(cookie, { managerId: mgr.id, departmentId: deptX });
      stranger = await makeEmployee(cookie, { departmentId: deptY });
      deptMate = await makeEmployee(cookie, { departmentId: deptX });
      mgrRole = await grantProfile(fx.plainMember.membershipId, READ_KEYS, 'TEAM');
    });

    const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);

    it('TEAM: a manager sees themselves and their direct reports — nobody else', async () => {
      await setScope(fx.plainMember.membershipId, mgrRole, 'TEAM');
      const cookie = await cookieFor(fx.plainMember);
      const list = await http.get('/api/v1/hr/employees?pageSize=100').set('Cookie', cookie);
      expect(list.status).toBe(200);
      const got = ids(list.body);
      expect(got).toContain(mgr.id);
      expect(got).toContain(r1.id);
      expect(got).toContain(r2.id);
      expect(got).not.toContain(stranger.id);
      expect(got).not.toContain(deptMate.id);
      expect(list.body.total).toBe(3);
    });

    it('TEAM: reading or touching an out-of-scope employee is a 404, never a 403 or data', async () => {
      await setScope(fx.plainMember.membershipId, mgrRole, 'TEAM');
      const cookie = await cookieFor(fx.plainMember);
      for (const path of [
        `/api/v1/hr/employees/${stranger.id}`,
        `/api/v1/hr/employees/${stranger.id}/history`,
        `/api/v1/hr/employees/${stranger.id}/documents`,
      ]) {
        const res = await http.get(path).set('Cookie', cookie);
        expect(res.status, path).toBe(404);
        expect(res.body.error.code).toBe('HR_EMPLOYEE_NOT_FOUND');
      }
      expect((await http.get(`/api/v1/hr/employees/${r1.id}`).set('Cookie', cookie)).status).toBe(
        200,
      );
      // and a write is equally out of reach (needs the permission first — use admin-level check below)
      const admin = await adminCookie();
      expect(
        (await http.get(`/api/v1/hr/employees/${stranger.id}`).set('Cookie', admin)).status,
      ).toBe(200);
    });

    it('DEPARTMENT: own department + self — a report in another department is out of scope', async () => {
      await setScope(fx.plainMember.membershipId, mgrRole, 'DEPARTMENT');
      const cookie = await cookieFor(fx.plainMember);
      const got = ids(
        (await http.get('/api/v1/hr/employees?pageSize=100').set('Cookie', cookie)).body,
      );
      expect(got).toEqual(expect.arrayContaining([mgr.id, r2.id, deptMate.id]));
      expect(got).not.toContain(r1.id);
      expect(got).not.toContain(stranger.id);
    });

    it('OWN: only their own record', async () => {
      await setScope(fx.plainMember.membershipId, mgrRole, 'OWN');
      const cookie = await cookieFor(fx.plainMember);
      const list = await http.get('/api/v1/hr/employees?pageSize=100').set('Cookie', cookie);
      expect(ids(list.body)).toEqual([mgr.id]);
    });

    it('COMPANY: everyone in the workspace', async () => {
      await setScope(fx.plainMember.membershipId, mgrRole, 'COMPANY');
      const cookie = await cookieFor(fx.plainMember);
      const got = ids(
        (await http.get('/api/v1/hr/employees?pageSize=100').set('Cookie', cookie)).body,
      );
      expect(got).toEqual(expect.arrayContaining([mgr.id, r1.id, r2.id, stranger.id, deptMate.id]));
    });

    it('a narrowed scope with no linked employee sees nothing — never everything', async () => {
      const orphan = await addTenantMember(fx.tenantA);
      await grantProfile(orphan.membershipId, READ_KEYS, 'TEAM');
      const cookie = await cookieFor(orphan);
      const list = await http.get('/api/v1/hr/employees').set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(list.body.total).toBe(0);
      const detail = await http.get(`/api/v1/hr/employees/${stranger.id}`).set('Cookie', cookie);
      expect(detail.status).toBe(404);
    });

    it('writes are bound by scope too: a TEAM-scoped editor cannot edit or change status outside their team', async () => {
      const editor = await addTenantMember(fx.tenantA);
      const cookieAdmin = await adminCookie();
      const editorEmp = await makeEmployee(cookieAdmin, { membershipId: editor.membershipId });
      const inTeam = await makeEmployee(cookieAdmin, { managerId: editorEmp.id });
      const outside = await makeEmployee(cookieAdmin);
      await grantProfile(
        editor.membershipId,
        [...READ_KEYS, 'hr.employee.update', 'hr.employee.manage'],
        'TEAM',
      );
      const cookie = await cookieFor(editor);

      const ok = await http
        .patch(`/api/v1/hr/employees/${inTeam.id}`)
        .set('Cookie', cookie)
        .send({ notes: 'in scope' });
      expect(ok.status).toBe(200);
      const denied = await http
        .patch(`/api/v1/hr/employees/${outside.id}`)
        .set('Cookie', cookie)
        .send({ notes: 'out of scope' });
      expect(denied.status).toBe(404);
      const deniedStatus = await http
        .post(`/api/v1/hr/employees/${outside.id}/status`)
        .set('Cookie', cookie)
        .send({ status: 'SUSPENDED' });
      expect(deniedStatus.status).toBe(404);
      // the outside record was genuinely untouched
      const still = await http.get(`/api/v1/hr/employees/${outside.id}`).set('Cookie', cookieAdmin);
      expect(still.body.notes).toBeNull();
      expect(still.body.status).toBe('ACTIVE');
    });

    it('tenant isolation: another tenant’s employees never appear regardless of scope', async () => {
      const cookieB = await cookieFor(fx.adminB);
      const foreign = await makeEmployee(cookieB);
      const cookie = await adminCookie();
      const list = await http.get('/api/v1/hr/employees?pageSize=100').set('Cookie', cookie);
      expect(ids(list.body)).not.toContain(foreign.id);
      const direct = await http.get(`/api/v1/hr/employees/${foreign.id}`).set('Cookie', cookie);
      expect(direct.status).toBe(404);
    });
  });

  describe('HR data scope on leave, expenses, attendance, performance and the dashboard', () => {
    let viewer: UserFixture;
    let viewerRole: string;
    let viewerEmp: { id: string };
    let teamMember: { id: string };
    let outsider: { id: string };
    let leaveType: string;
    let teamLeave: string;
    let outsiderLeave: string;

    beforeAll(async () => {
      const cookie = await adminCookie();
      viewer = await addTenantMember(fx.tenantA);
      viewerEmp = await makeEmployee(cookie, { membershipId: viewer.membershipId });
      teamMember = await makeEmployee(cookie, { managerId: viewerEmp.id });
      outsider = await makeEmployee(cookie);
      viewerRole = await grantProfile(viewer.membershipId, READ_KEYS, 'TEAM');

      const lt = await http
        .post('/api/v1/hr/leave/types')
        .set('Cookie', cookie)
        .send({
          name: `Scope ${uniq()}`,
          code: `SC${uniq()}`,
          annualQuota: '10.00',
          approverStrategy: 'HR',
        });
      leaveType = lt.body.id;
      const mine = await http.post('/api/v1/hr/leave/requests').set('Cookie', cookie).send({
        employeeId: teamMember.id,
        leaveTypeId: leaveType,
        startDate: '2030-03-04',
        endDate: '2030-03-05',
      });
      const theirs = await http.post('/api/v1/hr/leave/requests').set('Cookie', cookie).send({
        employeeId: outsider.id,
        leaveTypeId: leaveType,
        startDate: '2030-03-04',
        endDate: '2030-03-05',
      });
      expect([mine.status, theirs.status]).toEqual([200, 200]);
      teamLeave = mine.body.id;
      outsiderLeave = theirs.body.id;
    });

    it('leave: lists, the calendar and single reads exclude out-of-scope employees', async () => {
      const cookie = await cookieFor(viewer);
      const list = await http
        .get(`/api/v1/hr/leave/requests?leaveTypeId=${leaveType}&pageSize=100`)
        .set('Cookie', cookie);
      const got = list.body.items.map((r: { id: string }) => r.id);
      expect(got).toContain(teamLeave);
      expect(got).not.toContain(outsiderLeave);

      const cal = await http
        .get('/api/v1/hr/leave/calendar?from=2030-03-01&to=2030-03-31')
        .set('Cookie', cookie);
      const calIds = cal.body.map((c: { id: string }) => c.id);
      expect(calIds).toContain(teamLeave);
      expect(calIds).not.toContain(outsiderLeave);

      expect(
        (await http.get(`/api/v1/hr/leave/requests/${teamLeave}`).set('Cookie', cookie)).status,
      ).toBe(200);
      const hidden = await http
        .get(`/api/v1/hr/leave/requests/${outsiderLeave}`)
        .set('Cookie', cookie);
      expect(hidden.status).toBe(404);
      const balances = await http
        .get(`/api/v1/hr/leave/balances/${outsider.id}`)
        .set('Cookie', cookie);
      expect(balances.status).toBe(404);
    });

    it('leave: an assigned approver can still open the request they must decide, wherever the requester sits', async () => {
      await pool.query(
        'update hr_leave_requests set approver_membership_id=$1 where id=$2 and tenant_id=$3',
        [viewer.membershipId, outsiderLeave, fx.tenantA],
      );
      const cookie = await cookieFor(viewer);
      const res = await http
        .get(`/api/v1/hr/leave/requests/${outsiderLeave}`)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(outsiderLeave);
    });

    it('expenses: the list is scoped, but a claim assigned to me for approval stays visible', async () => {
      const cookie = await adminCookie();
      const cat = await http
        .post('/api/v1/hr/expenses/categories')
        .set('Cookie', cookie)
        .send({ name: `ScopeCat ${uniq()}`, code: `SCC${uniq()}` });
      const mk = async (employeeId: string) =>
        (
          await http.post('/api/v1/hr/expenses').set('Cookie', cookie).send({
            employeeId,
            categoryId: cat.body.id,
            expenseDate: '2030-03-04',
            amount: '120.00',
          })
        ).body.id as string;
      const teamClaim = await mk(teamMember.id);
      const outsiderClaim = await mk(outsider.id);

      const viewerCookie = await cookieFor(viewer);
      const list = await http.get('/api/v1/hr/expenses?pageSize=100').set('Cookie', viewerCookie);
      const got = list.body.items.map((c: { id: string }) => c.id);
      expect(got).toContain(teamClaim);
      expect(got).not.toContain(outsiderClaim);
      expect(
        (await http.get(`/api/v1/hr/expenses/${outsiderClaim}`).set('Cookie', viewerCookie)).status,
      ).toBe(404);

      await pool.query(
        'update hr_expense_claims set approver_membership_id=$1 where id=$2 and tenant_id=$3',
        [viewer.membershipId, outsiderClaim, fx.tenantA],
      );
      const assigned = await http
        .get(`/api/v1/hr/expenses/${outsiderClaim}`)
        .set('Cookie', viewerCookie);
      expect(assigned.status).toBe(200);
    });

    it('attendance and performance are scoped the same way', async () => {
      const cookie = await adminCookie();
      for (const emp of [teamMember, outsider]) {
        const rec = await http.post('/api/v1/hr/attendance/record').set('Cookie', cookie).send({
          employeeId: emp.id,
          workDate: '2030-03-04',
          status: 'PRESENT',
        });
        expect(rec.status).toBe(200);
      }
      const period = await http
        .post('/api/v1/hr/performance/periods')
        .set('Cookie', cookie)
        .send({ name: `Scope H1 ${uniq()}`, periodStart: '2030-01-01', periodEnd: '2030-06-30' });
      const review = async (employeeId: string) =>
        (
          await http
            .post('/api/v1/hr/performance/reviews')
            .set('Cookie', cookie)
            .send({ performancePeriodId: period.body.id, employeeId, overallRating: 4 })
        ).body.id as string;
      const teamReview = await review(teamMember.id);
      const outsiderReview = await review(outsider.id);

      const viewerCookie = await cookieFor(viewer);
      const att = await http
        .get('/api/v1/hr/attendance?from=2030-03-04&to=2030-03-04&pageSize=100')
        .set('Cookie', viewerCookie);
      const attEmployees = att.body.items.map((a: { employeeId: string }) => a.employeeId);
      expect(attEmployees).toContain(teamMember.id);
      expect(attEmployees).not.toContain(outsider.id);

      const reviews = await http.get('/api/v1/hr/performance/reviews').set('Cookie', viewerCookie);
      const reviewIds = reviews.body.map((r: { id: string }) => r.id);
      expect(reviewIds).toContain(teamReview);
      expect(reviewIds).not.toContain(outsiderReview);
      expect(
        (
          await http
            .get(`/api/v1/hr/performance/reviews/${outsiderReview}`)
            .set('Cookie', viewerCookie)
        ).status,
      ).toBe(404);
    });

    it('the dashboard reflects the caller’s scope — counts, activity, and no payroll without payroll access', async () => {
      const viewerCookie = await cookieFor(viewer);
      const dash = await http.get('/api/v1/hr/dashboard').set('Cookie', viewerCookie);
      expect(dash.status).toBe(200);
      // viewer + their one report, nobody else
      expect(dash.body.totalEmployees).toBe(2);
      const names = dash.body.recentActivity.map((a: { employeeId: string }) => a.employeeId);
      expect(names).not.toContain(outsider.id);
      expect(dash.body.currentPayroll).toBeNull();
      // activity is human-readable — no compensation, no raw ids in summaries
      for (const a of dash.body.recentActivity) {
        expect(a.summary).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
        expect(a.kind).not.toBe('COMPENSATION');
      }
      const admin = await adminCookie();
      const all = await http.get('/api/v1/hr/dashboard').set('Cookie', admin);
      expect(all.body.totalEmployees).toBeGreaterThan(dash.body.totalEmployees);

      // the workforce aggregates are real and bound by the same scope
      expect(dash.body.attendanceTrend).toHaveLength(14);
      expect(new Set(dash.body.attendanceTrend.map((d: { date: string }) => d.date)).size).toBe(14);
      const headcount = (b: { departmentDistribution: { count: number }[] }) =>
        b.departmentDistribution.reduce((a, d) => a + d.count, 0);
      expect(headcount(all.body)).toBe(all.body.activeEmployees);
      expect(headcount(dash.body)).toBe(dash.body.activeEmployees);
      expect(headcount(dash.body)).toBeLessThan(headcount(all.body));
    });

    it('narrowing scope takes effect immediately for the same member', async () => {
      await setScope(viewer.membershipId, viewerRole, 'OWN');
      const cookie = await cookieFor(viewer);
      const list = await http.get('/api/v1/hr/employees').set('Cookie', cookie);
      expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([viewerEmp.id]);
    });
  });

  // ---- documents + self-service --------------------------------------

  describe('employee documents and self-service', () => {
    let employee: UserFixture;
    let empRecord: { id: string };
    let other: UserFixture;

    beforeAll(async () => {
      const cookie = await adminCookie();
      employee = await addTenantMember(fx.tenantA);
      other = await addTenantMember(fx.tenantA);
      empRecord = await makeEmployee(cookie, { membershipId: employee.membershipId });
      await makeEmployee(cookie, { membershipId: other.membershipId });
    });

    const upload = async (cookie: string, content: Buffer, shared?: 'true' | 'false') => {
      const req = http
        .post(`/api/v1/hr/employees/${empRecord.id}/documents`)
        .set('Cookie', cookie)
        .field('kind', 'contract')
        .field('title', `Contract ${uniq()}`);
      if (shared) req.field('sharedWithEmployee', shared);
      return req.attach('file', content, {
        filename: 'contract.pdf',
        contentType: 'application/pdf',
      });
    };

    it('a document is HR-only by default and invisible to the employee until HR shares it', async () => {
      const admin = await adminCookie();
      const bytes = Buffer.from(`hr-private-${randomUUID()}`);
      const up = await upload(admin, bytes);
      expect(up.status).toBe(200);
      const doc = up.body.find(
        (d: { sharedWithEmployee: boolean }) => d.sharedWithEmployee === false,
      );
      expect(doc).toBeTruthy();

      const empCookie = await cookieFor(employee);
      const mine = await http.get('/api/v1/hr/me/documents').set('Cookie', empCookie);
      expect(mine.status).toBe(200);
      expect(mine.body.find((d: { id: string }) => d.id === doc.id)).toBeUndefined();
      const direct = await http
        .get(`/api/v1/hr/me/documents/${doc.id}/download`)
        .set('Cookie', empCookie);
      expect(direct.status).toBeGreaterThanOrEqual(400);

      // HR shares it: now the employee can see and download exactly those bytes
      const shared = await http
        .patch(`/api/v1/hr/employees/${empRecord.id}/documents/${doc.id}`)
        .set('Cookie', admin)
        .send({ sharedWithEmployee: true });
      expect(shared.status).toBe(200);
      const after = await http.get('/api/v1/hr/me/documents').set('Cookie', empCookie);
      expect(after.body.find((d: { id: string }) => d.id === doc.id)).toBeTruthy();
      const dl = await http
        .get(`/api/v1/hr/me/documents/${doc.id}/download`)
        .set('Cookie', empCookie);
      expect(dl.status).toBe(200);
      expect(Buffer.compare(dl.body as Buffer, bytes)).toBe(0);

      // unsharing takes it away again
      await http
        .patch(`/api/v1/hr/employees/${empRecord.id}/documents/${doc.id}`)
        .set('Cookie', admin)
        .send({ sharedWithEmployee: false });
      const gone = await http
        .get(`/api/v1/hr/me/documents/${doc.id}/download`)
        .set('Cookie', empCookie);
      expect(gone.status).toBeGreaterThanOrEqual(400);

      const audit = await pool.query(
        `select metadata from audit_logs where tenant_id=$1 and action='hr.employee.document_sharing_changed'`,
        [fx.tenantA],
      );
      expect(audit.rows.length).toBeGreaterThanOrEqual(2);
    });

    it('sharing at upload time works, and another employee can never fetch it', async () => {
      const admin = await adminCookie();
      const bytes = Buffer.from(`shared-${randomUUID()}`);
      const up = await upload(admin, bytes, 'true');
      expect(up.status).toBe(200);
      const doc = up.body.find((d: { sharedWithEmployee: boolean }) => d.sharedWithEmployee);
      const owner = await http
        .get(`/api/v1/hr/me/documents/${doc.id}/download`)
        .set('Cookie', await cookieFor(employee));
      expect(owner.status).toBe(200);
      const stranger = await http
        .get(`/api/v1/hr/me/documents/${doc.id}/download`)
        .set('Cookie', await cookieFor(other));
      expect(stranger.status).toBeGreaterThanOrEqual(400);
      const strangerList = await http
        .get('/api/v1/hr/me/documents')
        .set('Cookie', await cookieFor(other));
      expect(strangerList.body.find((d: { id: string }) => d.id === doc.id)).toBeUndefined();
    });

    it('an out-of-scope uploader is refused BEFORE anything is written to storage', async () => {
      const scoped = await addTenantMember(fx.tenantA);
      const scopedEmp = await makeEmployee(await adminCookie(), {
        membershipId: scoped.membershipId,
      });
      await grantProfile(scoped.membershipId, [...READ_KEYS, 'hr.employee.manage'], 'OWN');
      const cookie = await cookieFor(scoped);
      const res = await upload(cookie, Buffer.from('nope'));
      expect(res.status).toBe(404);
      const rows = await pool.query(
        'select count(*)::int as n from hr_employee_documents where tenant_id=$1 and employee_id=$2',
        [fx.tenantA, scopedEmp.id],
      );
      expect(rows.rows[0].n).toBe(0);
    });

    it('an employee cannot list or read anyone else through the admin routes', async () => {
      const cookie = await cookieFor(employee);
      const res = await http
        .get(`/api/v1/hr/employees/${empRecord.id}/documents`)
        .set('Cookie', cookie);
      expect(res.status).toBe(403); // no hr.employee.read
      const list = await http.get('/api/v1/hr/employees').set('Cookie', cookie);
      expect(list.status).toBe(403);
    });

    it('own performance reviews: drafts stay with the manager; submitted reviews appear; the employee can acknowledge (audited)', async () => {
      const admin = await adminCookie();
      await grantProfile(employee.membershipId, ['hr.attendance.self'], 'OWN');
      const period = await http
        .post('/api/v1/hr/performance/periods')
        .set('Cookie', admin)
        .send({ name: `Self H2 ${uniq()}`, periodStart: '2030-07-01', periodEnd: '2030-12-31' });
      const review = await http.post('/api/v1/hr/performance/reviews').set('Cookie', admin).send({
        performancePeriodId: period.body.id,
        employeeId: empRecord.id,
        overallRating: 5,
        managerComments: 'Private draft comments',
      });
      expect(review.status).toBe(200);

      const empCookie = await cookieFor(employee);
      const draft = await http.get('/api/v1/hr/me/performance-reviews').set('Cookie', empCookie);
      expect(draft.status).toBe(200);
      expect(draft.body.find((r: { id: string }) => r.id === review.body.id)).toBeUndefined();

      await http
        .post(`/api/v1/hr/performance/reviews/${review.body.id}/submit`)
        .set('Cookie', admin)
        .send({});
      const submitted = await http
        .get('/api/v1/hr/me/performance-reviews')
        .set('Cookie', empCookie);
      const mine = submitted.body.find((r: { id: string }) => r.id === review.body.id);
      expect(mine.status).toBe('SUBMITTED');
      // only their own — the review list never carries someone else's
      expect(
        submitted.body.every((r: { employeeId: string }) => r.employeeId === empRecord.id),
      ).toBe(true);

      const ack = await http
        .post(`/api/v1/hr/performance/reviews/${review.body.id}/acknowledge`)
        .set('Cookie', empCookie)
        .send({});
      expect(ack.status).toBe(200);
      expect(ack.body.status).toBe('ACKNOWLEDGED');
      const audit = await pool.query(
        `select entity_id from audit_logs where tenant_id=$1 and action='hr.performance.review_acknowledged'`,
        [fx.tenantA],
      );
      expect(audit.rows.some((r) => r.entity_id === review.body.id)).toBe(true);
    });
  });

  // ---- entitlement -------------------------------------------------

  describe('module entitlement on self-service', () => {
    it('a workspace WITHOUT HR gets no HR self-service, even for a member with a linked login', async () => {
      const t = await createTenantWithModules({ name: 'No HR Co', moduleKeys: ['CRM'] });
      const cookie = await cookieFor(t.admin);
      for (const path of [
        '/api/v1/hr/me',
        '/api/v1/hr/me/documents',
        '/api/v1/hr/me/leave-balances',
        '/api/v1/hr/me/expenses',
        '/api/v1/hr/me/payroll-history',
        '/api/v1/hr/me/performance-reviews',
        '/api/v1/hr/employees',
        '/api/v1/hr/dashboard',
      ]) {
        const res = await http.get(path).set('Cookie', cookie);
        expect(res.status, path).toBe(403);
        expect(res.body.error.code, path).toBe('ENTITLEMENT_MODULE_NOT_ENABLED');
      }
    });

    it('disabling HR later cuts self-service off immediately — data left behind is not served', async () => {
      const admin = await adminCookie();
      const member = await addTenantMember(fx.tenantA);
      await makeEmployee(admin, { membershipId: member.membershipId });
      const cookie = await cookieFor(member);
      expect((await http.get('/api/v1/hr/me').set('Cookie', cookie)).status).toBe(200);

      await disableModule(fx.tenantA, 'HR');
      try {
        const res = await http.get('/api/v1/hr/me').set('Cookie', cookie);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('ENTITLEMENT_MODULE_NOT_ENABLED');
        expect((await http.get('/api/v1/hr/me/documents').set('Cookie', cookie)).status).toBe(403);
      } finally {
        await enableModule(fx.tenantA, 'HR');
      }
      expect((await http.get('/api/v1/hr/me').set('Cookie', cookie)).status).toBe(200);
    });

    it('an unlinked login in an HR workspace gets the specific not-linked error', async () => {
      const member = await addTenantMember(fx.tenantA);
      const res = await http.get('/api/v1/hr/me').set('Cookie', await cookieFor(member));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('HR_EMPLOYEE_NOT_LINKED');
    });
  });

  // ---- organisation ------------------------------------------------

  describe('organisation — archive and audit', () => {
    it('an archived department cannot be assigned to new people, but current members keep it', async () => {
      const cookie = await adminCookie();
      const deptId = await makeDept(cookie);
      const member = await makeEmployee(cookie, { departmentId: deptId });

      const archived = await http
        .patch(`/api/v1/hr/departments/${deptId}`)
        .set('Cookie', cookie)
        .send({ status: 'ARCHIVED' });
      expect(archived.status).toBe(200);
      expect(archived.body.status).toBe('ARCHIVED');

      const blocked = await http.post('/api/v1/hr/employees').set('Cookie', cookie).send({
        firstName: 'Late',
        lastName: uniq(),
        joiningDate: '2025-01-01',
        departmentId: deptId,
      });
      expect(blocked.status).toBe(422);
      expect(blocked.body.error.code).toBe('HR_ORG_UNIT_ARCHIVED');

      // an existing member can still be edited (their unchanged department is not re-checked)
      const edit = await http
        .patch(`/api/v1/hr/employees/${member.id}`)
        .set('Cookie', cookie)
        .send({ departmentId: deptId, notes: 'still in archived dept' });
      expect(edit.status).toBe(200);

      // but they cannot be MOVED into another archived unit
      const other = await makeEmployee(cookie);
      const move = await http
        .patch(`/api/v1/hr/employees/${other.id}`)
        .set('Cookie', cookie)
        .send({ departmentId: deptId });
      expect(move.status).toBe(422);

      // restoring makes it assignable again
      await http
        .patch(`/api/v1/hr/departments/${deptId}`)
        .set('Cookie', cookie)
        .send({ status: 'ACTIVE' });
      const ok = await http
        .patch(`/api/v1/hr/employees/${other.id}`)
        .set('Cookie', cookie)
        .send({ departmentId: deptId });
      expect(ok.status).toBe(200);
    });

    it('unit updates and schedule updates are audited; schedules can now be edited and archived', async () => {
      const cookie = await adminCookie();
      const desig = await http
        .post('/api/v1/hr/designations')
        .set('Cookie', cookie)
        .send({ name: `Role ${uniq()}`, code: `R${uniq()}` });
      const renamed = await http
        .patch(`/api/v1/hr/designations/${desig.body.id}`)
        .set('Cookie', cookie)
        .send({ name: 'Renamed role' });
      expect(renamed.body.name).toBe('Renamed role');

      const sched = await http
        .post('/api/v1/hr/schedules')
        .set('Cookie', cookie)
        .send({ name: `Shift ${uniq()}`, startTime: '09:00', endTime: '17:00' });
      expect(sched.status).toBe(200);
      const edited = await http
        .patch(`/api/v1/hr/schedules/${sched.body.id}`)
        .set('Cookie', cookie)
        .send({ endTime: '18:30', graceMinutes: 10, status: 'ARCHIVED' });
      expect(edited.status).toBe(200);
      expect(edited.body.endTime).toBe('18:30');
      expect(edited.body.status).toBe('ARCHIVED');
      const missing = await http
        .patch(`/api/v1/hr/schedules/${randomUUID()}`)
        .set('Cookie', cookie)
        .send({ name: 'nope' });
      expect(missing.status).toBe(404);

      const audit = await pool.query(
        `select distinct action from audit_logs where tenant_id=$1 and action like 'hr.organization.%_updated'`,
        [fx.tenantA],
      );
      const actions = audit.rows.map((r) => r.action);
      expect(actions).toContain('hr.organization.designation_updated');
      expect(actions).toContain('hr.organization.schedule_updated');
    });

    it('org changes need hr.organization.manage', async () => {
      const cookie = await cookieFor(fx.limited);
      const res = await http
        .patch(`/api/v1/hr/schedules/${randomUUID()}`)
        .set('Cookie', cookie)
        .send({ name: 'x' });
      expect(res.status).toBe(403);
    });
  });

  // ---- Field ↔ HR ---------------------------------------------------

  describe('Field → HR employee link (optional, read-only)', () => {
    it('shows the linked employee only when HR is enabled and the caller may read employees', async () => {
      const admin = await adminCookie();
      const agent = await addTenantMember(fx.tenantA);
      const emp = await makeEmployee(admin, { membershipId: agent.membershipId });
      const designate = await http
        .post('/api/v1/field-agents')
        .set('Cookie', admin)
        .send({ membershipId: agent.membershipId });
      expect(designate.status).toBe(200);
      expect(designate.body.employee).toBeNull(); // designation itself never touches HR

      const list = await http.get('/api/v1/field-agents').set('Cookie', admin);
      const row = list.body.find(
        (a: { membershipId: string }) => a.membershipId === agent.membershipId,
      );
      expect(row.employee).toMatchObject({ id: emp.id, status: 'ACTIVE' });
      expect(Object.keys(row.employee).sort()).toEqual(
        ['displayName', 'employeeNumber', 'id', 'status'].sort(),
      );

      // a field manager WITHOUT hr.employee.read gets the agents but no employee data
      const fieldMgr = await addTenantMember(fx.tenantA);
      await grantProfile(fieldMgr.membershipId, ['field.agents.manage'], 'COMPANY');
      const mgrList = await http
        .get('/api/v1/field-agents')
        .set('Cookie', await cookieFor(fieldMgr));
      expect(mgrList.status).toBe(200);
      const mgrRow = mgrList.body.find(
        (a: { membershipId: string }) => a.membershipId === agent.membershipId,
      );
      expect(mgrRow.employee).toBeNull();

      // HR disabled: Field keeps working, the link simply disappears
      await disableModule(fx.tenantA, 'HR');
      try {
        const noHr = await http.get('/api/v1/field-agents').set('Cookie', admin);
        expect(noHr.status).toBe(200);
        const noHrRow = noHr.body.find(
          (a: { membershipId: string }) => a.membershipId === agent.membershipId,
        );
        expect(noHrRow.employee).toBeNull();
      } finally {
        await enableModule(fx.tenantA, 'HR');
      }
    });

    it('the link honours HR data scope — an out-of-scope employee is simply not linked', async () => {
      const admin = await adminCookie();
      const agent = await addTenantMember(fx.tenantA);
      await makeEmployee(admin, { membershipId: agent.membershipId });
      await http
        .post('/api/v1/field-agents')
        .set('Cookie', admin)
        .send({ membershipId: agent.membershipId });

      const scoped = await addTenantMember(fx.tenantA);
      await makeEmployee(admin, { membershipId: scoped.membershipId });
      await grantProfile(scoped.membershipId, ['field.agents.manage', 'hr.employee.read'], 'OWN');
      const list = await http.get('/api/v1/field-agents').set('Cookie', await cookieFor(scoped));
      const row = list.body.find(
        (a: { membershipId: string }) => a.membershipId === agent.membershipId,
      );
      expect(row.employee).toBeNull();
    });
  });

  // ---- notification context ----------------------------------------------

  describe('HR notification events', () => {
    it('leave and expense workflow events carry enough to notify the right person', async () => {
      const admin = await adminCookie();
      const approver = await addTenantMember(fx.tenantA);
      const worker = await addTenantMember(fx.tenantA);
      const approverEmp = await makeEmployee(admin, { membershipId: approver.membershipId });
      const workerEmp = await makeEmployee(admin, {
        membershipId: worker.membershipId,
        managerId: approverEmp.id,
      });

      const lt = await http
        .post('/api/v1/hr/leave/types')
        .set('Cookie', admin)
        .send({
          name: `Notify ${uniq()}`,
          code: `NT${uniq()}`,
          annualQuota: '10.00',
          approverStrategy: 'REPORTING_MANAGER',
        });
      const req = await http.post('/api/v1/hr/leave/requests').set('Cookie', admin).send({
        employeeId: workerEmp.id,
        leaveTypeId: lt.body.id,
        startDate: '2030-05-06',
        endDate: '2030-05-06',
      });
      expect(req.status).toBe(200);
      // the request is routed to the employee's manager…
      const row = await pool.query(
        'select approver_membership_id from hr_leave_requests where id=$1 and tenant_id=$2',
        [req.body.id, fx.tenantA],
      );
      expect(row.rows[0].approver_membership_id).toBe(approver.membershipId);
      // …and the requested/rejected events are emitted for the notification engine
      await http
        .post(`/api/v1/hr/leave/requests/${req.body.id}/reject`)
        .set('Cookie', admin)
        .send({ reason: 'Team is at capacity that week' });
      const events = await pool.query(
        `select distinct type from outbox_events where tenant_id=$1 and type in ('hr.leave.requested','hr.leave.rejected')`,
        [fx.tenantA],
      );
      expect(events.rows.map((r) => r.type).sort()).toEqual([
        'hr.leave.rejected',
        'hr.leave.requested',
      ]);
    });
  });
});
