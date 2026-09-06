# ADR 0041 — HR & Workforce Module Architecture

Status: Accepted (Phase 12 — a bounded HR domain module: organisation,
employees, employment history, attendance, leave, expenses/reimbursement,
compensation, payroll, performance, and employee self-service)

Builds on ADR 0007 (Drizzle), ADR 0008 (UUIDv7), ADR 0009/0027 (multi-tenancy &
RLS), ADR 0013 (transactional outbox), ADR 0014 (error codes & correlation),
ADR 0015 (object storage), ADR 0029 (RBAC & permission catalogue), ADR 0037
(notifications engine), ADR 0039 (document engine & fixed-point money
conventions carried from Phase 9), ADR 0040 (global audit log).

It adds **no** second identity system, **no** second event bus, **no**
country-specific statutory payroll, **no** tax-filing or government submission,
**no** bank-API integration, **no** accounting ledger, **no** recruitment/ATS,
**no** biometric attendance, and **no** shift-rostering/optimization engine.

## Context

HR runs in parallel with CRM (ADR 0003) and is a P1 stream. It must be a
realistic operational HR system — Organisation → Employees → Employment →
Attendance → Leave → Expenses → Compensation → Payroll → Payments → Performance
— and it must stay **generic** (usable by non-solar tenants and other
industries). It must serve both office and field employees without creating a
second "field worker" concept alongside the Phase 4 field agent.

Two forces shape the design:

1. **Extraction capability.** The architecture must answer "could HR eventually
   become a separately deployed Aivoryx HR application without rewriting the HR
   domain?" with substantially _yes_ — while **not** splitting into microservices
   now (ADR 0001 still holds).
2. **Privacy.** Compensation and bank details are the most sensitive data the
   platform holds. They must never leak through list DTOs, generic search,
   audit metadata, notification payloads, logs, error responses, or the OpenAPI
   contract.

## Decision

### 1. A bounded domain module

`HrModule` (`apps/api/src/hr/`) depends **only** on shared-kernel primitives:
`@aivoryx/shared`, `@aivoryx/db` (schema + `withTenantContext`), the platform
`SecurityContext`, `AdminModule` (transactional `OutboxService`), the global
`AuditService`, `StorageModule` (the `OBJECT_STORAGE` abstraction) and
`DocumentsModule` (the branded-PDF engine).

It has **no** import of CRM / Field / Supply / EPC / Finance service internals,
and **no HR table carries a foreign key into another business module**.
Cross-module links are _soft references_ — `hr_expense_claims.project_ref` and
`.visit_ref` are plain nullable `uuid` columns with no FK. That is the seam
where a narrow capability validator could later be injected without a schema
change.

`HrModule` **exports exactly one thing**: `ExpensesService`. It is the single
narrow capability other modules use.

### 2. Employee ≠ Identity

`user_tenant_memberships` (ADR 0026) stays the sole authority for
authentication, sessions, roles and permissions. `hr_employees.membership_id` is
a **nullable** column with a composite `(membership_id, tenant_id)` FK into
`user_tenant_memberships(id, tenant_id)` and a `unique(tenant_id, membership_id)`
constraint. An employee can exist with no login; a user can exist with no
employee. No HR table stores a password, hash, session, role or permission.
Linking/unlinking is a dedicated, audited operation
(`hr.employee.membership_linked` / `_unlinked`), never a field on employee
create.

### 3. The Field agent relationship

An employee **may be** a field agent (`hr_employees.category = 'field'`). Phase 4
field-agent capability is untouched: visit assignment, GPS check-in/out and
field permissions all keep working. A field agent linked to an employee gains
one HR permission — `hr.expense.submit` — and raises claims through the same HR
domain via `POST /api/v1/field/visits/:visitId/expense-claim`. That route:

- derives tenant + actor from the `SecurityContext`;
- validates visit ownership server-side (`VisitsService.get` rejects a visit
  that is not the caller's, unless they hold the CRM/admin visibility
  permission);
- resolves the employee **inside HR** from the caller's membership — a client
  `employeeId` is never trusted;
- forwards to `ExpensesService.createFromFieldVisit(...)`, passing the visit id
  as an opaque `visitRef`.

The Field module never imports an HR schema type or any HR service other than
the exported `ExpensesService`.

### 4. Money & concurrency

All monetary columns are `NUMERIC(18,2)` with an explicit `currency`. Payroll
and mileage arithmetic reuse the Phase 9 fixed-point helpers
(`apps/api/src/supply/decimal.ts`) — never JavaScript floating point.

Every guarded operation is protected by a transaction plus a row lock and is
covered by a concurrency test:

| Operation                        | Guard                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| employee number generation       | `hr_counters` single atomic `UPDATE … value = value + 1 RETURNING`                          |
| attendance check-in / check-out  | `unique(tenant, employee, work_date)` + `SELECT … FOR UPDATE` on the day row                |
| leave balance consumption        | locked balance row + `consumed = consumed + n` + a CONSUMPTION ledger row, one tx           |
| expense approval / reimbursement | `SELECT … FOR UPDATE` on the claim; `unique(tenant, expense_claim_id)` on the reimbursement |
| payroll process / finalize       | `SELECT … FOR UPDATE` on the period; finalize is rejected once `status` is locked           |
| payroll payment recording        | `SELECT … FOR UPDATE` on the entry; `paid_amount` recomputed from real payment rows         |

### 5. Ledger balances

`hr_leave_balances.balance` is a Postgres `GENERATED ALWAYS AS (opening +
accrued + adjusted − consumed) STORED` column — it can never drift from its
inputs. Consumption and reversal always write a signed row in
`hr_leave_balance_transactions` (kinds: OPENING / ACCRUAL / CONSUMPTION /
ADJUSTMENT / REVERSAL) in the same transaction as the balance mutation.
Approving a request checks the policy's `allow_negative_balance`; concurrent
approvals against a thin balance produce exactly one winner.

### 6. Immutable payroll snapshots

A payroll period moves DRAFT → PROCESSING → FINALIZED → PAYMENT_PROCESSING →
PARTIALLY_PAID → PAID (or CANCELLED). **Process** rebuilds every entry from the
employee's current compensation profile + APPROVED unpaid incentives +
PAID reimbursements dated in the window; the transparent calculation is
`Base + Allowances + Incentives + Approved Reimbursements − Deductions = Net`.
**Finalize** freezes each entry: the full component breakdown and totals are
written to `hr_payroll_entries.snapshot` (JSONB) with a `frozenAt` timestamp,
and consumed incentives are tied to the period. After finalize the period is
locked — a later change to salary, department, leave, expenses or incentives
**does not** alter a finalized entry. Payslips are real downloadable PDFs
produced by the Phase 10 `DocumentRenderService` from a generic
`DocumentDefinition` (the payslip builder imports only `document.types`, so HR
stays extractable).

### 7. Sensitive-data protection

- **Salary** — never in `EmployeeListItemDto` / `EmployeeDetailDto`, generic
  search, generic audit metadata, or ordinary notification payloads. Gated by
  `hr.compensation.read` / `hr.compensation.manage`. `hr_employment_history`
  COMPENSATION rows record only the effective date and pay frequency — never a
  figure. Audit rows for `hr.compensation.*` carry no amounts.
- **Bank details** — the most sensitive record. Gated by the even-narrower
  `hr.bank_details.read` / `.manage`. The response DTO exposes only
  `accountNumberMasked` (`••••••••4821`); the raw number is never returned,
  logged, put in audit metadata, or sent in a notification. Audit metadata for
  `hr.bank_details.updated` is `{ preferredMethod, bankNameSet }` only. Not in
  the employee list DTO. A static contract test
  (`src/hr/bank-privacy.spec.ts`) fails CI if any **response** schema
  re-introduces a raw `accountNumber` or a salary field. **Protection model:**
  strict application permission + access boundaries, masked-on-read, tenant RLS
  - composite FK, plus the platform's at-rest volume encryption (Railway,
    `DEPLOYMENT.md`). No bespoke cryptographic infrastructure was introduced
    (the brief explicitly cautioned against inventing it); application-level
    field encryption remains an open option recorded for the lead.

### 8. Platform integrations

- **Audit** — `AUDIT_MODULES` gains `'hr'` (migration `ALTER TYPE audit_module
ADD VALUE 'hr'`); ~44 `hr.*` actions are added to the catalogue. Critical
  mutations call `audit.record(tx, …)` inside their transaction (ADR 0040).
- **Notifications** — HR emits business events to the existing transactional
  outbox (`hr.leave.approved`, `hr.expense.reimbursed`, `hr.payroll.finalized`,
  `hr.performance.review_submitted`, …). HR never calls `sendEmail` /
  `sendWhatsApp` / `sendSMS`. Three Phase 8 rules + templates ship as system
  defaults.
- **Outbox** — the existing `OutboxService`; no new infrastructure.
- **Object storage** — employee documents and expense receipts use the
  `OBJECT_STORAGE` abstraction and `buildEntityAttachmentKey`; downloads go
  through an authenticated, tenant-scoped route (`StreamableFile`).
- **RLS** — every tenant-owned HR table (29) has `tenant_id`, `ENABLE` +
  `FORCE ROW LEVEL SECURITY`, the standard `aivoryx_app` DML grant and the
  `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
  isolation policy in USING + WITH CHECK. Direct PostgreSQL proof is in
  `rls.int.spec.ts` (Phase 12 block).

### 9. API & UI

- REST under `/api/v1/hr/...` with narrow DTOs (never raw rows), server-side
  pagination/filtering, and the OpenAPI contract synchronised.
- `/hr/me/*` is `@AuthOnly()` and resolves _authenticated membership → linked
  employee → own data_; an unlinked account gets `HR_EMPLOYEE_NOT_LINKED`
  (403) — it never trusts a client `employeeId`.
- Web UI at `/hr` (dashboard, employees + detail tabs with permission-gated
  sensitive tabs, organisation, attendance, leave, expenses, payroll,
  performance, and `/hr/me`), reusing the existing shells and shared components.

## Consequences

- HR can be lifted into its own deployable service with minimal change: it has
  its own numbering (`hr_counters`), its own payment-method enum, its own money
  helpers, no cross-module FKs, and a single narrow export. The seam is real.
- The Field PWA gains an HR-backed expense flow without a second expense system.
- Adding a country's statutory fields, or a real Finance/bank settlement
  integration, is future work that consumes an approved claim / finalized
  payroll through a narrow contract — not a rewrite of this domain.
- Application-level encryption of bank fields is an open decision (see §7).

## Alternatives considered

- **Merge User and Employee.** Rejected — conflates auth with an HR record,
  makes "employee without login" and "contractor" awkward, and couples HR to the
  identity module's lifecycle.
- **Foreign keys from `hr_expense_claims` into `field.visits` /
  `supply.projects`.** Rejected — it welds HR to those schemas and kills the
  extraction story. Soft references + a future validator hook keep the option
  open.
- **A statutory payroll engine (PF/ESI/PAYE/EPF/SOCSO).** Rejected for V1 —
  country-specific, high-maintenance, and out of the generic-product scope.
- **Trigger-based attendance auto-marking / a rostering optimizer.** Rejected —
  the brief scopes attendance to lightweight schedules; no optimization engine.
- **A second notification path from HR.** Rejected — HR emits events; the Phase 8
  engine owns delivery.
