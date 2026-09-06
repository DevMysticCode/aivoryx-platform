# EPC Project Execution

Status: **Implemented in Phase 7** (ADR 0036). Takes a booked/approved Phase 5
project through planning → material readiness → installation → QC → net
metering → handover → completion. Built ON the existing platform — it
**extends** `projects` (no second project table), reuses `field_agents` for
installation assignment (no worker table), the Phase 3 definition/value split
for checklists, the object-storage adapter for attachments, the transactional
outbox for events, and `project_activities` for the timeline. Reusable beyond
solar — net metering is a configurable per-project workflow record, not a
solar-only column.

## Entities

```
project_milestones           -- the 11-key execution checklist
  id, tenant_id, project_id, key, sort_order, status
  (pending|in_progress|done|skipped|blocked),
  completed_at?, completed_by_membership_id?, notes?

project_installations        -- one per project; assignment + on-site workflow
  id, tenant_id, project_id,
  status (UNASSIGNED|ASSIGNED|IN_PROGRESS|COMPLETED|CANCELLED),
  assigned_membership_id?, assigned_at?, assigned_by_membership_id?, visit_id?,
  started_at?, completed_at?, start_lat?/lng?, complete_lat?/lng?,
  notes?, equipment_installed?, issues?,
  material_override, material_override_by_membership_id?, material_override_reason?

checklist_templates          -- definitions (tenant-configurable); (tenant, kind, label) unique
  id, tenant_id, kind (installation|qc|handover), label, sort_order, required, is_active

project_checklist_items      -- values (per project; per QC inspection for kind='qc')
  id, tenant_id, project_id, inspection_id?, template_id?,
  kind, label, sort_order, required,
  status (pending|done|na), completed_at?, completed_by_membership_id?, notes?

project_qc_inspections       -- repeatable; (tenant, project, seq) unique
  id, tenant_id, project_id, seq,
  status (PENDING|IN_PROGRESS|PASSED|FAILED),
  inspector_membership_id?, inspected_at?, notes?, result_note?

project_defects              -- lightweight defect list
  id, tenant_id, project_id, inspection_id?, description,
  severity (low|medium|high|critical),
  status (OPEN|IN_PROGRESS|RESOLVED|VERIFIED),
  assigned_membership_id?, resolution_note?, resolved_at?, verified_at?

project_net_metering         -- internal grid-connection tracking; (tenant, project) unique
  id, tenant_id, project_id,
  status (NOT_STARTED|DOCUMENTS_PENDING|SUBMITTED|UNDER_REVIEW|APPROVED|REJECTED|COMPLETED),
  not_required, reference_number?, submitted_at?, approved_at?, notes?

project_handover             -- customer handover; (tenant, project) unique
  id, tenant_id, project_id, status (PENDING|READY|COMPLETED), notes?,
  customer_acknowledged, acknowledged_by_name?, handover_at?, handed_over_by_membership_id?

project_execution_attachments -- METADATA ONLY; bytes in object storage; polymorphic
  id, tenant_id, project_id, entity_kind (installation|qc|defect|net_metering|handover),
  entity_id, object_key, original_filename?, content_type, file_size, uploaded_by_membership_id?
```

All 9 tables are tenant-owned, RLS `ENABLE` + `FORCE`d, isolation-policied,
granted to `aivoryx_app`, composite `(id, tenant_id)` FKs. Verified directly in
`apps/api/test/rls.int.spec.ts`.

## Lifecycles (pure functions, `apps/api/src/execution/lifecycles.ts`)

```
installation:  UNASSIGNED → ASSIGNED → IN_PROGRESS → COMPLETED
               ASSIGNED → UNASSIGNED (unassign) ;  any open → CANCELLED
QC inspection: PENDING → IN_PROGRESS → PASSED | FAILED   (results terminal)
defect:        OPEN → IN_PROGRESS → RESOLVED → VERIFIED   (reopenable pre-VERIFIED)
net metering:  NOT_STARTED → DOCUMENTS_PENDING → SUBMITTED → UNDER_REVIEW → APPROVED → COMPLETED
               REJECTED → DOCUMENTS_PENDING | SUBMITTED
handover:      PENDING ⇄ READY → COMPLETED
```

The Phase 5 `project_status` enum is **unchanged**. When installation starts
and the project is behind `IN_PROGRESS`, `advanceProjectStatus` walks the
existing lifecycle (`APPROVED → READY_FOR_DISPATCH → IN_PROGRESS`, etc.),
recording each hop as a `status_changed` activity — no new statuses.

## Milestones

11 fixed keys, created on `startExecution`. The auto-managed ones are
re-derived from the workflow records after every execution write
(`refreshMilestones`); `PLANNING` and any manually-completed milestone are
left alone. `POST /projects/:id/milestones/:milestoneId/complete` marks one
done by hand.

## Material readiness

`computeReadiness` — a pure roll-up over the Phase 5 `project_materials` rows:

- `READY` — every line has `delivered ≥ required` (or no lines exist)
- `NOT_READY` — nothing delivered against any line
- `PARTIALLY_READY` — otherwise

Installation `start` requires `READY` **or** an explicit `material_override`
on the installation. The override is a separate permissioned action
(`POST .../installations/material-override`, `projects.execution.update`) with
a mandatory reason and the actor recorded — a field agent cannot self-override.
Error code `MATERIAL_NOT_READY` (`details.readiness`).

## Configurable checklists

Definition/value split, like custom fields. `checklist_templates` are
tenant-configurable per `kind` and seeded lazily from a code default set.
`project_checklist_items` snapshot `label`/`required` at copy time. Required
items must be complete before installation completion
(`INSTALLATION_CHECKLIST_INCOMPLETE`, `details.missing`), QC pass
(`QC_CHECKLIST_INCOMPLETE`), and handover completion — validated server-side.

## QC + defects

QC inspections are `seq`-numbered and repeatable — a new inspection can be
opened after a `FAILED` one. **QC pass is blocked** while any defect is `OPEN`
or `IN_PROGRESS` (`QC_BLOCKING_DEFECTS`, `details.open`) or a required check is
incomplete. Defects are a lightweight list — no comments, SLAs, or watchers.

## Completion invariants (server-enforced)

`POST /projects/:id/complete` (`projects.complete`) locks the project
`FOR UPDATE` and runs `checkProjectCompletion`:

- installation `COMPLETED`
- latest QC inspection `PASSED`
- net metering `COMPLETED` **or** `not_required`
- handover `COMPLETED`
- no unresolved (`OPEN`/`IN_PROGRESS`) defects

If anything is missing → `PROJECT_COMPLETION_BLOCKED` with `details.missing`
(e.g. `["QC not passed", "Handover not completed"]`). On success (atomic):
project → `COMPLETED`, `COMPLETED` milestone done, `completed` project
activity, a `project_completed` activity on the CRM **lead** timeline, and a
`project.completed` outbox event.

## Transaction boundaries

| Operation               | One transaction                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation completion | lock installation → status-conditional early return → required-checklist check → status COMPLETED + notes/equipment → milestone sync → activity → outbox                         |
| QC pass                 | lock inspection → early return if PASSED → required-checklist check → no blocking defects → status PASSED + inspected_at → milestone sync → activity → outbox                    |
| QC fail                 | lock inspection → status FAILED + result note → milestone `QC_PASSED` → blocked → activity → outbox                                                                              |
| Handover completion     | lock handover → early return if COMPLETED → prereq check (installation + QC + checklist + acknowledgement) → status COMPLETED + handover_at → milestone sync → activity → outbox |
| Project completion      | lock project → early return if COMPLETED → `checkProjectCompletion` → `advanceProjectStatus` to COMPLETED → milestone + activity + lead-timeline + outbox                        |

## Idempotency / concurrency

Every completion locks its aggregate row `FOR UPDATE` and returns the current
state unchanged if already in the target status. Concurrent duplicate
installation completion / QC pass / handover completion / project completion
each resolve to **exactly one** transition, activity and event — proven by
real concurrent-request integration tests.

## Permissions (19 new, in the single `@aivoryx/shared` catalogue)

```
projects.execution.read / update
projects.installation.assign / read / update / complete
projects.qc.read / create / update / approve
projects.net_metering.read / update
projects.handover.read / update / complete
projects.complete
projects.defects.read / create / update
```

`TENANT_ADMIN` holds all 19. `FIELD_AGENT` holds
`projects.installation.read/update/complete` + `projects.defects.read/update`
— nothing else. `projects.execution.read` is the "sees all execution" signal;
a field agent without it sees only their assigned projects
(`assertProjectVisible` → `INSTALLATION_NOT_ASSIGNED_TO_YOU`).

## API (`/api/v1`)

```
GET   /projects/:id/execution                          projects.execution.read
POST  /projects/:id/execution/start                    projects.execution.update
GET   /projects/:id/milestones                         projects.execution.read
POST  /projects/:id/milestones/:milestoneId/complete   projects.execution.update
POST  /projects/:id/complete                           projects.complete

POST  /projects/:id/installations/assign               projects.installation.assign
POST  /projects/:id/installations/unassign             projects.installation.assign
POST  /projects/:id/installations/material-override    projects.execution.update
POST  /projects/:id/installations/start                projects.installation.update
POST  /projects/:id/installations/complete             projects.installation.complete

GET   /projects/:id/checklists                         projects.installation.read
POST  /projects/:id/checklists                         projects.execution.update
POST  /projects/:id/checklists/:itemId/toggle          projects.installation.update
DELETE /projects/:id/checklists/:itemId                projects.execution.update
GET/POST/PATCH /checklist-templates[/:id]              projects.execution.read / update

POST  /projects/:id/qc                                 projects.qc.create
GET   /projects/:id/qc/:inspectionId                   projects.qc.read
POST  /projects/:id/qc/:inspectionId/checklist/:itemId/toggle   projects.qc.update
POST  /projects/:id/qc/:inspectionId/{start,pass,fail} projects.qc.update / approve

GET   /projects/:id/defects                            projects.defects.read
POST  /projects/:id/defects                            projects.defects.create
PATCH /projects/:id/defects/:defectId                  projects.defects.update

GET   /projects/:id/net-metering                       projects.net_metering.read
PATCH /projects/:id/net-metering                       projects.net_metering.update
PATCH /projects/:id/handover                           projects.handover.update
POST  /projects/:id/handover/complete                  projects.handover.complete

GET   /field/projects                                  projects.installation.read
GET   /field/projects/:id                              projects.installation.read

GET/POST/DELETE /projects/:id/execution/attachments[...]   projects.installation.read / update
```

Every route derives tenant + actor from the authenticated security context;
tenant ownership is never accepted from a DTO.

## Events (existing outbox, ADR 0013)

`project.execution.started`, `installation.assigned/started/completed`,
`qc.created/passed/failed`, `defect.created/resolved`,
`net_metering.submitted/approved`, `handover.completed`, `project.completed` —
each emitted in the same transaction as its state change.

## Web UI

`/projects/:id/execution` — a tabbed execution workspace (Overview / Materials
/ Installation / QC / Net Metering / Handover / Files) with per-area progress
bars, milestone table, defect list, checklists, and a server-gated
"Complete project" button that shows the missing-requirements list. The
`/projects/:id` page links to it once the project is past `DRAFT`.

`/field/projects` + `/field/projects/:id` — the mobile-first PWA surface (under
the existing `/field` chrome): assigned installations, site + material summary,
touch checklist, camera capture, start/complete controls, and assigned
defects. GPS is captured from the device where available (Phase 4 pattern),
never fabricated.

## Demo / seed

`pnpm --filter @aivoryx/api seed:execution-demo` — idempotent, layers on the
commercial demo's booked `PRJ-QB-DEMO`. Leaves the project mid-execution:
milestones created, an installation assigned to `agent@clans-demo.test` and
`IN_PROGRESS` with a partly-done checklist, one `PENDING` QC inspection, one
`OPEN` defect, net metering `SUBMITTED`, handover `PENDING`. Needs the supply,
field and commercial demo seeds first. No production secrets.

## Strictly out of scope this phase

Notification engine, email/SMS/WhatsApp, payments/invoices/accounting/GST,
e-signature / OTP, public customer portal, utility API integrations,
route/fleet management, advanced HR/payroll, AI project planning / defect
detection / computer vision / predictive maintenance, native mobile, true
offline-first, microservices, and a general workflow engine.
