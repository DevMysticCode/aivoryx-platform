# Database Guide

## Principle

One integrated business data architecture, tenant-scoped at every layer:
PostgreSQL, accessed through Drizzle ORM (ADR 0007), isolated by RLS +
application guards (ADR 0009, `TENANCY.md`).

## Identifiers

All primary keys and externally visible identifiers are **UUIDv7** (ADR 0008):
time-ordered for index locality, globally unique, safe to expose. No auto-
increment integer keys on business tables. Raw internal ids are never a
security boundary.

## Initial foundation entities

tenants
users
user_tenant_memberships
roles
permissions
role_permissions
membership_roles
organizations
branches
departments
employees

Identity model (ADR 0026): a user is global (no `tenant_id` on `users`); the
user↔tenant link is always an explicit `user_tenant_memberships` row. Roles are
per-tenant and attach to a membership via `membership_roles`; `permissions` are
a global catalogue linked to roles via `role_permissions`. A `sessions` row
references its user and, optionally, one `active_membership_id` (composite FK
guarantees it is that user's own membership) — the authoritative active-tenant
selector. `organizations` / `branches` / `departments` / `employees` are later
tasks.

## CRM entities

**Implemented (Phase 3, ADR 0031):**

leads
lead_activities
lead_notes
lead_followups

`customers` (a lead graduating to an account) remains future work — Phase 3
stops at qualification/conversion of the lead itself (CLAUDE.md §28).

## Field/Sales entities

**Implemented (Phase 4, ADR 0033):**

field_agents
visits
visit_activities
visit_notes
visit_attachments

The site survey is `custom_field_definitions`/`custom_field_values` with
`entity = 'visit'` (see `## Custom field entities` below) — not a separate
`site_surveys` table. `survey_attachments` is `visit_attachments` (any
visit-scoped photo, not survey-specific). `quotations` / `quotation_versions`
/ `bookings` remain not built — later phase (CLAUDE.md §28). See
`FIELD-OPERATIONS.md`.

## Supply-chain entities

**Implemented (Phase 5, ADR 0034):**

projects
project_materials
project_activities
units
product_categories
products
suppliers
warehouses
stock_movements -- append-only ledger, the source of truth
stock_levels -- derived projection, maintained in the same tx
purchase_orders
purchase_order_lines
goods_receipts
goods_receipt_lines
dispatches
dispatch_lines
dispatch_attachments

`projects` is a thin CRM→operations bridge, not an EPC module. Inventory has
no "set quantity" table — `stock_levels` is only ever moved by a
`stock_movements` row. Quantities are `NUMERIC(18,4)`, money `NUMERIC(18,2)`;
no floats. Delivery proof reuses the Phase 4 object-storage adapter
(`dispatch_attachments` mirrors `visit_attachments`). See `SUPPLY-CHAIN.md`.

## Commercial entities

**Implemented (Phase 6, ADR 0035):**

customers -- reusable commercial party; created by promoting a lead (carries lead_id)
quotations
quotation_revisions -- immutable priced snapshots; totals STORED, not only derived
quotation_lines -- product_id optional (service/custom lines allowed)
quotation_activities
quotation_attachments

Money is `NUMERIC` throughout (no floats). Booking is one atomic transaction
that promotes the customer and activates the **existing Phase 5 `projects`
row** (`DRAFT → APPROVED`) — there is no `orders` entity. Only a `draft`
revision is mutable; `revise` appends a new one. See `COMMERCIAL.md`.

## EPC execution entities

**Implemented (Phase 7, ADR 0036):**

project_milestones -- the 11-key execution checklist (extends `projects`, not a new project table)
project_installations -- one per project; assignment references a field-agent membership
checklist_templates -- tenant-configurable checklist definitions
project_checklist_items -- per-project / per-QC-inspection checklist values
project_qc_inspections -- repeatable, seq-numbered QC inspections
project_defects -- lightweight defect list (OPEN → IN_PROGRESS → RESOLVED → VERIFIED)
project_net_metering -- internal grid-connection tracking (configurable, not a solar-only project column)
project_handover -- customer handover + internal acknowledgement
project_execution_attachments -- polymorphic (entity_kind, entity_id), bytes in object storage

The Phase 5 `project_status` enum is unchanged — execution detail lives in
milestones + workflow records. Completion is server-enforced
(`PROJECT_COMPLETION_BLOCKED` with a `missing` list). See `EPC-EXECUTION.md`.

## Notification entities

**Implemented (Phase 8, ADR 0037):**

notification_templates -- tenant override of a code default, keyed (key, channel); plain-text bodies
notification_rules -- tenant override of a code default, keyed key; toggles is_active / narrows channels
notification_preferences -- one row per membership: in_app_enabled / email_enabled (default true)
notifications -- one per (event × rule × recipient); dedupe_key unique per tenant
notification_deliveries -- per-channel delivery state; idempotency_key unique per tenant; PENDING→PROCESSING→SENT|FAILED|CANCELLED

System default rules + templates live in code (`@aivoryx/api`), so the platform
works with zero configuration; a tenant row _overrides_ a default by key. Plus
`outbox_events.actor_membership_id` (Phase 8) for the `ACTOR` recipient
strategy. No second event bus — the engine consumes the existing
`outbox_events`. See `NOTIFICATIONS.md`.

## Finance entities

**Implemented (Phase 9, ADR 0038):**

invoices -- number unique per tenant; frozen totals; projections amount_paid / amount_credited; CHECK paid + credited <= grand_total
invoice_lines -- snapshot line_subtotal/discount/taxable/tax/total; discount_type AMOUNT|PERCENT
payments -- RECORDED -> REVERSED / CANCELLED; never deleted; projection allocated_amount; CHECK allocated <= amount
payment_allocations -- authoritative payment<->invoice link; unique(tenant, payment, invoice); reversed_at = null means active
credit_notes -- lump adjustment; DRAFT -> ISSUED / CANCELLED; optional invoice link
finance_counters -- (tenant, kind) -> prefix / padding / value; atomic increment for INV-000001 style numbers
finance_idempotency -- (tenant, key) -> operation / result_ref for Idempotency-Key retries

Operational finance only � no ledger / chart of accounts / journals / P&L /
statutory accounting. `outstanding` and `overdue` are derived, never stored.
Money is `NUMERIC` throughout (no floats). Finance events flow to the existing
`outbox_events`; no `credit_note_lines` table (a credit note is a single
amount). See `FINANCE.md`.

## Lead ingestion entities

**Implemented (Phase 3, ADR 0032):**

lead_sources
raw_events
canonical_lead_events
integration_event_log

`lead_mapping_profiles` / `lead_mapping_rules` (the full versioned mapping
engine) and `dead_letter_events` (a separate DLQ lifecycle table) were
evaluated and deliberately not built for V1 — see ADR 0032 §4/§6 for why a
smaller mechanism covers the same requirements today. `email_ingest_rules`
remains future work (no email connector in this phase).

See `LEAD-INGESTION.md`, `FIELD-MAPPING.md`, `RAW-EVENTS-AND-REPLAY.md`,
`EMAIL-INGESTION.md`.

## Custom field entities

**Implemented (Phase 3, ADR 0031)** for the `lead` entity, **extended in
Phase 4 (ADR 0033)** to the `visit` entity (the site survey):

custom_field_definitions
custom_field_values

Typed definition + typed-value-column storage (not one JSON blob). See
`CUSTOM-FIELDS.md` for the V1 trims (no filterable/reportable flags or
declarative validation JSON yet).

## HR & Workforce entities

**Implemented (Phase 12, ADR 0041, `HR-WORKFORCE.md`) — migration `0014`.**
29 tenant-owned tables, all RLS `ENABLE` + `FORCE`:

hr_counters
hr_departments · hr_designations · hr_work_locations · hr_work_schedules
hr_employees · hr_employment_history · hr_employee_bank_details · hr_employee_documents
hr_attendance_records · hr_attendance_corrections
hr_leave_types · hr_leave_policies · hr_leave_balances · hr_leave_requests · hr_leave_balance_transactions
hr_expense_categories · hr_expense_claims · hr_expense_reimbursements
hr_compensation_profiles · hr_compensation_components · hr_incentives
hr_payroll_periods · hr_payroll_entries · hr_payroll_entry_components · hr_payroll_payments
hr_performance_periods · hr_performance_goals · hr_performance_reviews

Notes:

- Money columns are `NUMERIC(18,2)` with an explicit `currency` (no floats).
- `hr_employees.membership_id` is a **nullable** composite FK
  `(membership_id, tenant_id) → user_tenant_memberships(id, tenant_id)` with
  `unique(tenant_id, membership_id)` — an employee is **not** an identity.
- `hr_leave_balances.balance` is `GENERATED ALWAYS AS (opening + accrued +
adjusted − consumed) STORED` — it cannot drift.
- `hr_expense_claims.project_ref` / `.visit_ref` are plain nullable `uuid`
  columns **with no foreign key** — soft references that keep HR extractable.
- `hr_employment_history` and `hr_attendance_corrections` are immutable
  (append-only in practice); compensation history rows store no salary figure.
- `hr_payroll_entries.snapshot` (JSONB) is frozen at finalize — a later change
  to salary / leave / expenses never alters it.
- Every non-child table has `unique(id, tenant_id)` for composite child FKs.
- Enums: `hr_employee_status`, `hr_employment_type`, `hr_org_unit_status`,
  `hr_employment_change_type`, `hr_attendance_status`, `hr_attendance_source`,
  `hr_half_day_period`, `hr_leave_approver_strategy`, `hr_leave_request_status`,
  `hr_leave_balance_txn_kind`, `hr_expense_claim_status`,
  `hr_reimbursement_status`, `hr_payment_method`, `hr_pay_frequency`,
  `hr_compensation_status`, `hr_salary_component_kind`,
  `hr_payroll_period_status`, `hr_payroll_payment_status`, `hr_incentive_status`,
  `hr_performance_period_status`, `hr_performance_goal_status`,
  `hr_performance_review_status`.

## Platform entities

sessions
tenant_invitations
audit_logs
workflow_definitions
workflow_runs
outbox_events
job_runs

`integration_connections` / `integration_events` from the earlier draft are
superseded by the lead-ingestion entities above.

## Rules

- All keys and external identifiers are UUIDv7 (ADR 0008).
- Include created_at/updated_at consistently.
- Soft deletion only where business/legal semantics require it.
- Add tenant_id to every tenant-owned record; enable + force RLS on it; register
  its application tenant guard. CI blocks a tenant-owned table missing either.
- Use foreign keys and indexes intentionally.
- Index common filters: tenant_id + status, tenant_id + created_at, assignment
  fields, and the typed custom-field value indexes in `CUSTOM-FIELDS.md`.
- Never expose raw internal DB IDs as a security boundary.

## Row Level Security (ADR 0027 — implemented for the identity model)

- Migration `0003` (hand-authored — drizzle-kit does not model roles/RLS)
  creates the non-privileged role **`aivoryx_app`** and enables **+ forces** RLS
  on `user_tenant_memberships`, `roles`, `role_permissions`, `membership_roles`,
  `tenants`. Policy: `tenant_id = nullif(current_setting('app.tenant_id', true),
'')::uuid` (USING + WITH CHECK); `user_tenant_memberships` also has a
  self-read policy on `app.user_id`.
- Migration `0004` (ADR 0030) adds `tenant_invitations` and `outbox_events`
  (both `ENABLE` + `FORCE` RLS, same tenant policy), `users.name`, and the
  `'invited'` value on `membership_status`. Its RLS/grants block is hand-appended
  after the drizzle-generated DDL with a snapshot identical to the generated one,
  so `db:generate` reports no drift. `tenant_invitations` also has a by-token
  policy (`token_hash = app.invitation_token_hash`) for the public accept flow.
- Migration `0005` (Phase 3, ADR 0031/0032) adds the ten CRM/inbound-integration
  tables — `leads`, `lead_activities`, `lead_notes`, `lead_followups`,
  `custom_field_definitions`, `custom_field_values`, `lead_sources`,
  `raw_events`, `canonical_lead_events`, `integration_event_log` — all
  `ENABLE` + `FORCE` RLS with the same hand-appended-block pattern as `0004`.
  `lead_sources` additionally carries a by-secret policy
  (`secret_hash = app.connector_secret_hash`) for the public inbound webhook.
- Migration `0006` (Phase 4, ADR 0033) adds `field_agents`, `visits`,
  `visit_activities`, `visit_notes`, `visit_attachments` — all `ENABLE` +
  `FORCE` RLS with the same hand-appended-block pattern, plus `leads.origin`
  and the `visit` member on `custom_field_entity`/`lead_activity_type`.
- Migration `0007` (Phase 5, ADR 0034) adds the 17 supply-chain tables
  (`projects`, `project_materials`, `project_activities`, `units`,
  `product_categories`, `products`, `suppliers`, `warehouses`,
  `stock_movements`, `stock_levels`, `purchase_orders`,
  `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`,
  `dispatches`, `dispatch_lines`, `dispatch_attachments`) — all `ENABLE` +
  `FORCE` RLS with the same hand-appended-block pattern, composite
  `(id, tenant_id)` FKs, a `stock_levels` non-negative `CHECK`, and a partial
  unique index on `stock_movements (tenant_id, idempotency_key)`.
- Migration `0008` (Phase 6, ADR 0035) adds the 6 commercial tables
  (`customers`, `quotations`, `quotation_revisions`, `quotation_lines`,
  `quotation_activities`, `quotation_attachments`) — all `ENABLE` + `FORCE`
  RLS with the same hand-appended-block pattern, composite `(id, tenant_id)`
  FKs, non-negative money `CHECK`s, and `unique(tenant_id, project_id) where
project_id is not null` on `quotations`. It also adds
  `quotation_created/sent/accepted/booked` to `lead_activity_type` and
  `booked` to `project_activity_type` via `ALTER TYPE ... ADD VALUE`.
- Migration `0009` (Phase 7, ADR 0036) adds the 9 EPC-execution tables
  (`project_milestones`, `project_installations`, `checklist_templates`,
  `project_checklist_items`, `project_qc_inspections`, `project_defects`,
  `project_net_metering`, `project_handover`,
  `project_execution_attachments`) — all `ENABLE` + `FORCE` RLS with the same
  hand-appended-block pattern, composite `(id, tenant_id)` FKs, and
  tenant/assignee/status indexes. It also adds `project_completed` to
  `lead_activity_type` and 15 execution values to `project_activity_type` via
  `ALTER TYPE ... ADD VALUE`.
- Migration `0010` (Phase 8, ADR 0037) adds the 5 notification tables
  (`notification_templates`, `notification_rules`, `notification_preferences`,
  `notifications`, `notification_deliveries`) — all `ENABLE` + `FORCE` RLS with
  the same hand-appended-block pattern, composite `(id, tenant_id)` FKs,
  per-tenant unique dedupe / idempotency keys, and tenant/status indexes. It
  also adds `outbox_events.actor_membership_id` and two **additive**
  `outbox_events` policies — a cross-tenant `SELECT` and the `dispatched_at`
  `UPDATE`, both gated on the server-only `app.outbox_dispatcher` GUC — used by
  the notification worker to drain the outbox (it opens no other table and
  cannot `INSERT`).
- Migration `0011` (Phase 9, ADR 0038) adds the 7 finance tables (`invoices`,
  `invoice_lines`, `payments`, `payment_allocations`, `credit_notes`,
  `finance_counters`, `finance_idempotency`) � all `ENABLE` + `FORCE` RLS with
  the same hand-appended-block pattern, composite `(id, tenant_id)` FKs,
  per-tenant unique numbers / idempotency keys, money non-negative CHECKs and
  the invariant CHECKs `amount_paid + amount_credited <= grand_total` and
  `allocated_amount <= amount`, plus 6 enums
  (`invoice_status`, `invoice_source`, `line_discount_type`, `payment_status`,
  `payment_method`, `credit_note_status`).
- Migration `0012` (Phase 10, ADR 0039) adds the 3 tenant-branding tables
  (`tenant_company_profiles`, `tenant_assets`, `tenant_onboarding`) — all
  `ENABLE` + `FORCE` RLS with the same hand-appended-block pattern, composite
  `(id, tenant_id)` FKs for the `*_by_membership_id` columns, per-tenant unique
  rows, `#rrggbb` / ISO-currency CHECKs on the colour + currency columns, a
  positive `size_bytes` CHECK on `tenant_assets`, and one enum
  (`tenant_asset_kind`). Logo bytes live in object storage, never in a column.
- Migration `0014` (Phase 12, ADR 0041) adds the 29 `hr_*` tables and their
  enums. First statement is `ALTER TYPE audit_module ADD VALUE 'hr'` (safe in a
  migration transaction on PG 12+ because the new value is not used in the same
  transaction). The hand-appended block applies the standard
  `GRANT SELECT, INSERT, UPDATE, DELETE`, `ENABLE` + `FORCE ROW LEVEL SECURITY`
  and the `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
  isolation policy (USING + WITH CHECK) to every HR table.
- Migration `0013` (Phase 11, ADR 0040) adds the append-only `audit_logs` table.
  Unlike every other tenant table it is **`SELECT` + `INSERT` only** for
  `aivoryx_app` — the hand-appended block `REVOKE`s `UPDATE, DELETE` (which the
  schema-wide default privileges would otherwise grant) and the RLS block has a
  tenant `SELECT` policy and a tenant `INSERT` `WITH CHECK` policy but
  **deliberately no `UPDATE` or `DELETE` policy**. Composite actor FK
  `(actor_membership_id, tenant_id) → user_tenant_memberships` with
  `ON DELETE SET NULL (actor_membership_id)` (PG 15+ column list, so the
  `NOT NULL tenant_id` is preserved); CHECKs on the action-key format and the
  actor shape; 5 `(tenant_id, …, occurred_at)` indexes; 2 enums
  (`audit_actor_type`, `audit_module`). No application code path can edit or
  delete an audit row.
- The API `SET ROLE`s to `aivoryx_app` per connection and sets `app.tenant_id` /
  `app.user_id` per transaction (`withTenantContext` in `@aivoryx/db`). Migrator
  / seed run as the DB owner. Migrations run before the API starts.
- `users`, `sessions`, global `permissions` are deliberately not RLS-scoped.

## Migration

Schema changes must use versioned **Drizzle** migrations, run by the dedicated
migration role as a release step before the new API version takes traffic.
A migration that only changes roles/grants/RLS is hand-authored with a snapshot
identical to its predecessor so `db:generate` reports no drift (`0003`).
Migrations are forward-only and backward-compatible for one release.
Never manually edit production schema.
