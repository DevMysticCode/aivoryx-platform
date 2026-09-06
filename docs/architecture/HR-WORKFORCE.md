# HR & Workforce

Phase 12 — ADR 0041. A realistic, **generic** operational HR system:
Organisation → Employees → Employment → Attendance → Leave →
Expenses/Reimbursement → Compensation → Payroll → Payments → Performance →
employee self-service. Built ON the platform — RLS, RBAC, the transactional
outbox, the Phase 8 notifications engine, the Phase 10 document engine and
fixed-point money conventions, and the Phase 11 global audit log.

HR is a **bounded domain module**: other modules reach it only through narrow
contracts / events, never its tables (ADR 0041 §1).

## What it is / is not

| Is                                                     | Is not                                                                 |
| ------------------------------------------------------ | ---------------------------------------------------------------------- |
| employee master + effective-dated employment history   | an identity / auth store (that stays `user_tenant_memberships`)        |
| attendance (server time), lightweight work schedules   | biometric / facial / fingerprint attendance, geo-fencing               |
| leave types + policies + ledger balances + requests    | a holiday-calendar / roster-optimization engine                        |
| first-class expense claims → approval → reimbursement  | a payments gateway / bank-API integration / an accounting ledger       |
| generic compensation history + generic incentives      | country-specific statutory payroll (PF/ESI/PAYE/EPF/SOCSO), tax filing |
| transparent payroll with immutable finalized snapshots | government submissions, Form-16/P60 generation                         |
| lightweight performance periods / goals / reviews      | talent management, calibration, AI scoring                             |
| employee self-service at `/hr/me`                      | a full HR document-management system                                   |

## Modules (`apps/api/src/hr`)

| File                      | Responsibility                                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `common.ts`               | `HrScope`, paging, `hr_counters` numbering (`nextHrNumber`), self-service identity resolution (`resolveMyEmployeeId`), haversine GPS distance |
| `lifecycles.ts`           | transition graphs — employee status, leave, expense, payroll, review (pure)                                                                   |
| `money.ts`                | `computePayrollTotals`, `mileageAmount`, 2-dp `sum` — fixed-point, no JS float                                                                |
| `organization.service.ts` | departments / designations / locations / schedules + the derived org chart                                                                    |
| `employees.service.ts`    | list / detail / create / update / status transitions / employment history / membership link / documents                                       |
| `bank-details.service.ts` | masked-on-read bank details; audit metadata carries no digits                                                                                 |
| `attendance.service.ts`   | self & admin check-in/out, `record`, immutable audited `correct`, list                                                                        |
| `leave.service.ts`        | types + policies, ledger balances, requests, configurable-approver `decide`, cancel, calendar                                                 |
| `expenses.service.ts`     | categories, claims, submit / `decide` / cancel / `reimburse`, receipts; `createFromFieldVisit` (the Field seam)                               |
| `compensation.service.ts` | effective-dated profiles (supersede, never overwrite); no salary in audit                                                                     |
| `incentives.service.ts`   | generic incentive records (free-text `type`), DRAFT → APPROVED                                                                                |
| `payroll.service.ts`      | period lifecycle, `process`, `finalize` (freeze snapshot), `recordPayment`, payslip, history                                                  |
| `payslip.builder.ts`      | generic `DocumentDefinition` for the Phase 10 renderer (imports only `document.types`)                                                        |
| `performance.service.ts`  | periods, goals, reviews (DRAFT → SUBMITTED → ACKNOWLEDGED → CLOSED)                                                                           |
| `self-service.service.ts` | `/hr/me` — resolve from the session, fail closed when unlinked                                                                                |
| `dashboard.service.ts`    | workspace counters for `/hr`                                                                                                                  |
| `hr-*.controller.ts`      | `/api/v1/hr/{employees,organization,attendance,leave,expenses,payroll,incentives,performance,me}`                                             |
| `bank-privacy.spec.ts`    | static contract guard — no raw `accountNumber` or salary field in any response schema                                                         |

Field seam: `apps/api/src/field/field-expenses.controller.ts` —
`POST /api/v1/field/visits/:visitId/expense-claim`.

## Data model (`packages/db/src/schema/hr.ts`, migration 0014)

29 tenant-owned tables. Every non-child table has `unique(id, tenant_id)` so
child tables can carry a composite `(id, tenant_id)` FK; every table has
`tenant_id`, RLS `ENABLE` + `FORCE`, the `aivoryx_app` DML grant and the
standard tenant-isolation policy.

- **Organisation** — `hr_counters`, `hr_departments`, `hr_designations`,
  `hr_work_locations` (optional lat/lng), `hr_work_schedules` (name, start/end
  `HH:MM`, working-days bitmask, grace minutes, optional location).
- **Employees** — `hr_employees` (self-FK manager with a `manager_id <> id`
  CHECK; composite membership FK; `unique(tenant_id, membership_id)`;
  `category` free text e.g. `'field'`), `hr_employment_history`
  (immutable, effective-dated, `from_value`/`to_value` JSONB — **no salary
  figures**), `hr_employee_bank_details` (`unique(tenant_id, employee_id)`),
  `hr_employee_documents` (`unique(object_key)`).
- **Attendance** — `hr_attendance_records` (`unique(tenant_id, employee_id,
work_date)` prevents overlaps; CHECK check-out ≥ check-in),
  `hr_attendance_corrections` (immutable — original + new + reason + actor).
- **Leave** — `hr_leave_types`, `hr_leave_policies`
  (`unique(tenant_id, leave_type_id)`, `approver_strategy`,
  `designated_approver_membership_id`), `hr_leave_balances`
  (`balance` GENERATED ALWAYS AS `opening + accrued + adjusted − consumed`;
  `unique(tenant_id, employee_id, leave_type_id, year)`), `hr_leave_requests`
  (`unique(tenant_id, request_number)`, CHECKs on dates and `total_days > 0`),
  `hr_leave_balance_transactions` (signed ledger).
- **Expenses** — `hr_expense_categories` (`default_mileage_rate` — set ⇒ a
  mileage category), `hr_expense_claims` (`project_ref` / `visit_ref` = plain
  nullable `uuid`, **no FK**; `approved_amount` frozen on decision),
  `hr_expense_reimbursements` (`unique(tenant_id, expense_claim_id)`).
- **Compensation** — `hr_compensation_profiles`
  (`unique(tenant_id, employee_id, effective_date)`, status ACTIVE →
  SUPERSEDED), `hr_compensation_components` (EARNING / DEDUCTION / INCENTIVE /
  REIMBURSEMENT).
- **Incentives** — `hr_incentives` (free-text `type`, opaque `source_ref`).
- **Payroll** — `hr_payroll_periods` (`unique(tenant_id, name)`, roll-up
  totals, 7-state lifecycle), `hr_payroll_entries`
  (`unique(tenant_id, payroll_period_id, employee_id)`; `snapshot` JSONB frozen
  at finalize; `employee_number` / `employee_name` snapshotted),
  `hr_payroll_entry_components`, `hr_payroll_payments` (multiple rows ⇒ partial
  payments).
- **Performance** — `hr_performance_periods`, `hr_performance_goals`,
  `hr_performance_reviews` (`unique(tenant_id, performance_period_id,
employee_id)`, rating 1–5 CHECK).

Money columns are `NUMERIC(18,2)` with an explicit `currency`.

## Key rules

### Employee ≠ Identity

`hr_employees.membership_id` is nullable; it links to a membership but never
duplicates password / hash / sessions / roles / permissions. Employee without
login and user without employee are both first-class. Linking is a dedicated
audited step (`hr.employee.membership_linked`), not a create field.

### Employee number

Tenant-scoped `EMP-000001`, server-generated via a single atomic `UPDATE
hr_counters SET value = value + 1 RETURNING`. Concurrent creates never collide
(proved in `hr-concurrency.int.spec.ts`).

### Employee lifecycle

ACTIVE / ON_LEAVE / SUSPENDED / TERMINATED / RESIGNED / INACTIVE with an
explicit transition graph. Terminal states set `terminated_at`. Employees with
historical HR data are never destructively deleted.

### Employment history

Every department / designation / manager / location / employment-type /
compensation / status change writes an effective-dated
`hr_employment_history` row — history is preserved, never overwritten.
Compensation history rows record only `effectiveDate` + `payFrequency`, never a
figure.

### Attendance

Server `now()` only — client timestamps are never trusted. One row per
employee-day prevents overlapping sessions; no check-out without a check-in, no
double check-in (row lock + `HR_ATTENDANCE_*` codes). Optional GPS is a
straight-line haversine distance from a work-location coordinate — **not** road
distance and not proof of presence; no Google Maps dependency. Corrections are
immutable rows carrying the original value, the new value, a reason and the
actor, and generate a `hr.attendance.corrected` audit entry with a
`{field:{from,to}}` diff.

### Leave

Approval authority is **tenant-configurable** per policy — REPORTING_MANAGER /
HR / DESIGNATED_APPROVER / TENANT_ADMIN (nothing hardcoded). A request is
blocked if it overlaps an existing PENDING or APPROVED request. Approval, in one
transaction: lock the balance row, check `allow_negative_balance`, `consumed +=
total_days`, insert a CONSUMPTION ledger row. Concurrent approvals against a
thin balance produce exactly one winner; cancellation of an approved request
restores the balance and writes a REVERSAL row. UI: **My Leave / My Requests**,
**Approval Queue**, a filterable **Leave Calendar**, and ledger-style
**Balances** (opening / accrued / consumed / adjusted / remaining).

### Expenses & reimbursement

A first-class workflow: DRAFT → SUBMITTED → APPROVED / REJECTED →
REIMBURSEMENT_PENDING → REIMBURSED / REIMBURSEMENT_FAILED / CANCELLED. The
approved amount is frozen on the decision (corrections are revision semantics,
not edits). Self-approval is forbidden by default (separation of duties). A
mileage category computes `reimbursement = distance_km × rate` in fixed point;
operational travel distance (Phase 4 GPS) is kept separate from financial
reimbursement. A reimbursement record captures amount / date / method /
reference / transaction id / status / failure reason / processed-by; it is
immutable after REIMBURSED except by explicit reversal.

**HR / Finance boundary** — HR owns "I incurred an expense and am owed a
reimbursement". Finance owns settlement and accounting. HR records operational
payment state only; a future Finance adapter can consume an approved claim
through a narrow contract without changing HR.

**Field seam** — `POST /api/v1/field/visits/:visitId/expense-claim`. Field
validates visit ownership, HR resolves the employee from the caller's
membership, and the claim is created through `ExpensesService` — the same
domain, no second system. `hr.expense.submit` is granted to the `FIELD_AGENT`
role; it carries no `hr.expense.read` (tenant-wide), approve, reimburse,
compensation, bank or payroll keys.

### Compensation & payroll

Compensation is generic (effective date, pay frequency, base salary, allowance
/ deduction / incentive / reimbursement components, currency) and historical —
a new profile supersedes the previous one.

Payroll: DRAFT → PROCESSING → FINALIZED → PAYMENT_PROCESSING → PARTIALLY_PAID →
PAID (or CANCELLED). **Process** recomputes entries; the transparent formula is
`Base + Allowances + Incentives + Approved Reimbursements − Deductions = Net`.
**Finalize** freezes each entry into an immutable snapshot — later changes to
salary, department, leave, expenses or incentives never alter it. **Payment
recording** supports partial payments and rolls the period status up from the
per-entry payment states. Payslips are real branded PDFs from the Phase 10
document engine; an employee sees only their own.

### Sensitive-data protection

- **Salary** — gated by `hr.compensation.*`; never in the employee list /
  detail DTO, generic search, audit metadata, or ordinary notifications.
- **Bank details** — gated by the narrower `hr.bank_details.*`; only
  `accountNumberMasked` is ever returned; audit metadata is
  `{ preferredMethod, bankNameSet }`; never logged or put in a notification.
  Protection model: strict permission + access boundaries, masking, tenant RLS
  - composite FK, and platform at-rest volume encryption (Railway). No bespoke
    crypto was introduced; application-level field encryption is an open option.
    A static contract test fails CI if a raw `accountNumber` or salary field
    appears in any response schema.

### Self-service (`/hr/me`)

`@AuthOnly()`. Identity is resolved _authenticated membership → linked employee
→ own data_. A client `employeeId` is never trusted; an unlinked account gets
`HR_EMPLOYEE_NOT_LINKED` (403). An employee never sees another employee's
salary, bank details, private HR notes, manager-only performance comments or
other employees' expenses.

## Permissions (`hr.*`, 35 keys)

`employee.read|create|update|manage` · `organization.read|manage` ·
`attendance.read|self|manage|correct` · `leave.read|request|approve|manage` ·
`expense.read|submit|approve|manage|reimburse` ·
`compensation.read|manage` · `bank_details.read|manage` ·
`payroll.read|manage|process|finalize|payment` · `incentive.read|manage` ·
`performance.read|manage`. `TENANT_ADMIN` holds all of them; `FIELD_AGENT`
holds only `expense.submit`.

## Audit & notifications

`audit_module` gains `'hr'`; ~44 `hr.*` actions are in the catalogue
(`hr.employee.*`, `hr.organization.*`, `hr.attendance.*`, `hr.leave.*`,
`hr.expense.*`, `hr.compensation.*`, `hr.incentive.*`, `hr.payroll.*`,
`hr.performance.*`, `hr.bank_details.updated`). Sensitive values never enter
audit metadata.

HR emits business events to the existing outbox — `hr.leave.approved`,
`hr.expense.submitted|approved|rejected|reimbursed|reimbursement_failed`,
`hr.payroll.finalized|payment_recorded`, `hr.performance.review_submitted`,
`hr.employee.created|status_changed`, … — and never calls a channel API
directly. System defaults ship for leave-approved (→ the requester),
expense-reimbursed (→ the requester) and payroll-finalized (→ tenant admins).

## API

`/api/v1/hr/...` families. Narrow DTOs (never raw rows), server-side
pagination and filtering on every list, OpenAPI synchronised. Attachments
(receipts, employee documents) and payslip PDFs stream through authenticated,
tenant-scoped routes.

## UI

`/hr` (dashboard), `/hr/employees` + `/hr/employees/:id` (Overview / Employment
/ Attendance / Leave / Expenses / Compensation / Bank·Payment / Documents /
Activity — sensitive tabs permission-gated), `/hr/organization` (departments /
designations / locations / schedules / org chart), `/hr/attendance`,
`/hr/leave`, `/hr/expenses` (+ detail), `/hr/payroll` (+ detail),
`/hr/performance`, `/hr/me`. Client at `apps/web/lib/api/hr.ts`; TanStack Query
hooks at `apps/web/lib/hr/use-hr.ts`.

## Tests

- Unit — `lifecycles.spec.ts`, `money.spec.ts`, `bank-privacy.spec.ts`.
- Integration — `apps/api/test/hr.int.spec.ts` (organisation, employees,
  hierarchy + cross-tenant manager/membership rejection, attendance +
  correction, leave request/approval/balance + overlap, expense
  claim/approval/reimbursement + self-approval, compensation history, payroll
  process/finalize/payment + finalized immutability, payslip PDF, performance,
  notifications, audit, bank privacy, self-service isolation, the Field seam).
- Concurrency — `apps/api/test/hr-concurrency.int.spec.ts` (employee number,
  duplicate check-in, leave balance, concurrent approvals, reimbursement,
  payroll finalization, payment recording).
- RLS — `apps/api/test/rls.int.spec.ts` Phase 12 block (tenant isolation on
  every HR table, cross-tenant manager / membership / attachment FK rejection,
  fail-closed with no context).
- Playwright — `apps/web/e2e/hr.spec.ts` (the 28-step golden path against live
  web + API + PostgreSQL + Redis, plus privacy negatives and the Field seam).

## Seed

`pnpm --filter @aivoryx/api run seed:hr-demo` — deterministic, generic data for
`clans-demo`: a 3-level org, 7 employees (2 field agents), attendance, 3 leave
types with an approved/pending/rejected request, 6 expense claims (incl. a field
fuel claim), compensation history, one DRAFT + one FINALIZED payroll with
payment records, and an OPEN performance period. `admin@clans-demo.test` links
to `EMP-000001`; `agent@clans-demo.test` links to `EMP-000004`.
