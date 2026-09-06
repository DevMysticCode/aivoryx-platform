# ADR 0036 — EPC Project Execution

Status: Accepted (Phase 7 — project planning, material readiness, installation
assignment + workflow, configurable checklists, QC inspections, defects, net
metering, customer handover, and enforced project completion)

Builds on ADR 0026 (identity/membership), ADR 0027 (RLS), ADR 0029 (RBAC),
ADR 0031 (CRM / lead lifecycle), ADR 0033 (field operations / field-agent
capability / object storage), ADR 0034 (projects / inventory / project
materials), ADR 0035 (booking → project activation), ADR 0013 (transactional
outbox), ADR 0014 (error codes). Extends the Phase 5 `projects` model — it
does **not** add a second project, employee, field-agent, inventory,
attachment, custom-field, notification, or workflow-engine mechanism.

## Context

Phase 7 takes a booked/approved project through the physical EPC lifecycle:
planning → material readiness → installation → QC → net metering → handover →
completion. It must be reusable beyond solar: net metering is a configurable
per-project workflow record, not a solar-only column in the core project
model.

## Decision

### 1. Extend `projects` with milestones + workflow records — not more statuses

The Phase 5 `project_status` enum is **unchanged**
(`DRAFT → APPROVED → PROCUREMENT → READY_FOR_DISPATCH → IN_PROGRESS →
COMPLETED`). Detailed execution state lives in:

- **`project_milestones`** — a fixed 11-key checklist (`PLANNING`,
  `MATERIAL_READY`, `INSTALLATION_SCHEDULED`, `INSTALLATION_STARTED`,
  `INSTALLATION_COMPLETED`, `QC_PENDING`, `QC_PASSED`, `NET_METERING`,
  `HANDOVER_READY`, `HANDED_OVER`, `COMPLETED`), each with
  `status/completed_at/completed_by/notes`. Created on `startExecution`; the
  auto-managed ones are re-derived from the workflow records after every write
  (`refreshMilestones`), while `PLANNING` and any manually-completed milestone
  are left alone.
- Per-project workflow records: `project_installations`,
  `project_qc_inspections`, `project_defects`, `project_net_metering`,
  `project_handover`, plus definition/value checklists
  (`checklist_templates` + `project_checklist_items`).

Commercial state (quotation) and operational state (project status) stay
distinct — booking is commercial approval, project `APPROVED` is operational
activation, and Phase 7 completion moves the project to `COMPLETED`.

Execution _starts_ from any non-`DRAFT` project. When installation starts and
the project is behind `IN_PROGRESS`, the service walks the existing Phase 5
lifecycle (`APPROVED → READY_FOR_DISPATCH → IN_PROGRESS`, etc.) via
`advanceProjectStatus`, recording each hop as a `status_changed` activity —
no new statuses, no skipped edges.

### 2. Installation assignment reuses the field-agent capability

`project_installations` (one per project) references an existing
`user_tenant_memberships` row via `assigned_membership_id`. Only an **active
field agent** (`isActiveFieldAgent`) can be assigned. Lifecycle
`UNASSIGNED → ASSIGNED → IN_PROGRESS → COMPLETED` (+ `UNASSIGNED` on
un-assign, `CANCELLED`), a pure function. No worker/employee table.

### 3. Material readiness reads Phase 5, never duplicates it

`computeReadiness` is a pure roll-up over the Phase 5 `project_materials`
rows: `READY` when every line has `delivered ≥ required` (or there are no
lines), `NOT_READY` when nothing is delivered, `PARTIALLY_READY` otherwise.
Installation `start` requires `READY` **or** an explicit
`material_override` on the installation, set through a dedicated
`POST .../installations/material-override` action gated by
`projects.execution.update` (a field agent cannot self-override) — recorded
with the actor and a mandatory reason. Error: `MATERIAL_NOT_READY`.

### 4. Configurable checklists — definition/value split (like custom fields)

`checklist_templates` are tenant-configurable definitions (per `kind` ∈
`installation | qc | handover`), seeded lazily from a code-defined default set
the first time execution or a QC inspection needs them. `project_checklist_items`
are the per-project (and, for QC, per-inspection) values, snapshotting
`label`/`required` at copy time. Checklist questions are **never** columns in
the schema. Required items must be complete before installation completion
(`INSTALLATION_CHECKLIST_INCOMPLETE`), QC pass (`QC_CHECKLIST_INCOMPLETE`),
and handover completion — validated server-side, not by the UI.

### 5. QC — repeatable inspections + a lightweight defect list

`project_qc_inspections` (multiple per project, `seq`-numbered).
`PENDING → IN_PROGRESS → PASSED | FAILED` (results terminal). A new inspection
can be opened after a `FAILED` one once rework is done. **QC pass is blocked**
(`QC_BLOCKING_DEFECTS`) while any defect is `OPEN` or `IN_PROGRESS`, and while
required QC checks are incomplete.

`project_defects` — `description`, `severity`, `status`
(`OPEN → IN_PROGRESS → RESOLVED → VERIFIED`, reopenable before `VERIFIED`),
`assigned_membership_id`, `resolution_note`, `resolved_at`, `verified_at`. Not
a ticketing system — no comments, no SLAs, no watchers.

### 6. Net metering — an internal workflow record, no utility integration

`project_net_metering` (one per project): `status`
(`NOT_STARTED → DOCUMENTS_PENDING → SUBMITTED → UNDER_REVIEW → APPROVED →
COMPLETED`, `REJECTED` reworkable), `reference_number`, `submitted_at`,
`approved_at`, `notes`, and a `not_required` flag for off-grid projects. No
assumption of any specific utility API.

### 7. Handover — internal acknowledgement, no e-signature

`project_handover` (one per project): `status` (`PENDING → READY →
COMPLETED`), `customer_acknowledged` (a recorded internal action, **not** an
e-signature / OTP / Aadhaar), `acknowledged_by_name`, `handover_at`, a
`handover`-kind checklist. `handover/complete` validates installation
COMPLETED + latest QC PASSED + required checklist done + acknowledgement
recorded (`HANDOVER_NOT_READY` lists what is missing).

### 8. Project completion is server-enforced with a specific missing list

`POST /projects/:id/complete` (permission `projects.complete`) locks the
project `FOR UPDATE`, runs `checkProjectCompletion` over the workflow
snapshot, and — if anything is missing — throws `PROJECT_COMPLETION_BLOCKED`
with `details.missing` (e.g. `["QC not passed", "Handover not completed"]`).
Requirements: installation COMPLETED, latest QC PASSED, net metering COMPLETED
**or** `not_required`, handover COMPLETED, no unresolved defects. On success:
project → `COMPLETED`, `COMPLETED` milestone done, `completed` project
activity, a `project_completed` activity on the CRM **lead** timeline, and a
`project.completed` outbox event — all atomic.

### 9. Field-agent boundary

A caller holding `projects.execution.read` sees every project's execution
workspace (the "sees all" signal, like `crm.leads.read` for visits). A field
agent, who holds only `projects.installation.read/update/complete` +
`projects.defects.read/update` (added to the `FIELD_AGENT` role), sees and
acts on **only** the projects where they are the assigned installation agent
or a defect assignee — enforced by `assertProjectVisible` server-side,
returning `INSTALLATION_NOT_ASSIGNED_TO_YOU`. Field agents get no
`projects.execution.update`, `projects.installation.assign`, `projects.qc.*`,
`projects.complete`, or net-metering/handover control.

### 10. Attachments + timeline + events reuse existing infra

`project_execution_attachments` is one polymorphic table
(`entity_kind` ∈ `installation | qc | defect | net_metering | handover`,
`entity_id`), always scoped by tenant + project, bytes in the Phase 4
object-storage adapter, 15 MB + image/PDF allow-list, authenticated-stream
download that re-checks tenant + project visibility. The execution timeline is
new enum members on the existing `project_activities` table (`execution_started`,
`milestone_completed`, `installation_*`, `qc_*`, `defect_*`, `net_metering_*`,
`handover_completed`, `completed`). Events go through the existing outbox
(`project.execution.started`, `installation.assigned/started/completed`,
`qc.created/passed/failed`, `defect.created/resolved`,
`net_metering.submitted/approved`, `handover.completed`, `project.completed`).
No global `audit_logs`, no notification engine.

## Consequences

- Phase 7 adds **9 tenant-owned tables**: `project_milestones`,
  `project_installations`, `checklist_templates`, `project_checklist_items`,
  `project_qc_inspections`, `project_defects`, `project_net_metering`,
  `project_handover`, `project_execution_attachments` — all `ENABLE` +
  `FORCE ROW LEVEL SECURITY`, tenant-isolation policy, `aivoryx_app` grants,
  composite `(id, tenant_id)` FKs, indexes on the tenant/assignee/status
  access paths. Verified by direct PostgreSQL RLS tests in
  `apps/api/test/rls.int.spec.ts`.
- Migration `packages/db/drizzle/0009_dusty_puppet_master.sql`; also adds
  `project_completed` to `lead_activity_type` and 15 execution values to
  `project_activity_type` via `ALTER TYPE ... ADD VALUE`. Fresh-apply,
  rerun-idempotent, `db:generate`-drift-clean.
- 19 permissions added to the single `@aivoryx/shared` catalogue; 5 of them
  granted to `FIELD_AGENT`.
- Installation completion, QC pass, handover completion and project completion
  are each one atomic transaction, `SELECT ... FOR UPDATE` on the aggregate
  row, with a status-conditional early return so concurrent duplicates each
  resolve to exactly one transition / activity / event — proven by real
  concurrent-request integration tests.
- No notification engine, email/SMS/WhatsApp, payment/invoice/accounting,
  e-signature, public portal, utility API, route/fleet management, HR/payroll,
  AI, computer vision, native mobile, true offline-first, microservices, or
  general workflow engine was added — all explicitly out of scope per the
  phase brief.
