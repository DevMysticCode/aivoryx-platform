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
