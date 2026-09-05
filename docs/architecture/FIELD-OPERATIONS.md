# Field Operations — Visits, GPS, and Site Survey

Status: **Implemented in Phase 4** (ADR 0033). Covers decision area 3's field
sales workflow. A business domain built on top of the existing platform — no
second identity/tenancy/RLS/RBAC/lead/custom-field/outbox/storage mechanism.
HR (employees, attendance, leave, payroll) is a later phase; field agents are
a capability flag on an existing membership, not an employee model.

## Entities

```
field_agents
  id, tenant_id, membership_id, status (active|inactive), deactivated_at?,
  created_at, updated_at

visits
  id, tenant_id, lead_id, assigned_membership_id?, status, scheduled_at,
  address_line? / city? / state? / postal_code? / country?,
  site_lat? / site_lng?,                        -- known site coords, no geocoding
  check_in_at? / check_in_lat? / check_in_lng? / check_in_accuracy_m?,
  check_out_at? / check_out_lat? / check_out_lng? / check_out_accuracy_m?,
  gps_distance_meters?,                          -- straight-line, checkout vs. site
  travel_km?, travel_notes?,                     -- operator-entered, never conflated with GPS
  survey_completed_at?,
  created_by_membership_id, created_at, updated_at

visit_activities        -- full, detailed, append-only visit timeline
  id, tenant_id, visit_id, type, actor_membership_id?, payload (jsonb), created_at

visit_notes             -- append-only at the API surface (no edit/delete endpoint yet)
  id, tenant_id, visit_id, author_membership_id?, body, created_at, updated_at, deleted_at?

visit_attachments       -- METADATA ONLY; bytes live in object storage
  id, tenant_id, visit_id, object_key, original_filename?, content_type,
  file_size, uploaded_by_membership_id?, created_at

custom_field_definitions / custom_field_values with entity='visit'  -- the site survey; see CUSTOM-FIELDS.md
```

All tenant-owned, RLS `ENABLE`+`FORCE`d (`TENANCY.md`), proven directly in
`apps/api/test/rls.int.spec.ts`. `leads.origin` (`manual | inbound |
field_agent`) is the only Phase 4 addition to the existing `leads` table.

## Visit lifecycle

```
SCHEDULED -> ASSIGNED | CANCELLED
ASSIGNED  -> IN_PROGRESS | CANCELLED
IN_PROGRESS -> COMPLETED | CANCELLED
COMPLETED / CANCELLED -> terminal
```

`RESCHEDULED` is not a status — it updates `scheduled_at` on a still
`SCHEDULED`/`ASSIGNED` visit and is recorded as a `rescheduled` activity. See
ADR 0033 §3 for the full rationale. Enforced in
`apps/api/src/field/visit-lifecycle.ts` (pure, unit-tested); invalid
transitions return `409 VISIT_INVALID_TRANSITION`.

Completing a visit (`IN_PROGRESS -> COMPLETED`) requires: a valid assigned
agent, a recorded check-in, a recorded check-out, and every required `visit`
survey field answered — checked server-side (`409 VISIT_INCOMPLETE` with the
list of what's missing), never trusted from the client alone.

## Visibility

A field agent sees only visits assigned to their own membership; anyone
holding `crm.leads.read` (CRM/admin users, always true for `TENANT_ADMIN`)
sees every tenant visit. Enforced in `VisitsService`; a field agent's own
`assignedMembershipId` filter is always the server-computed value, never the
client-supplied one. Check-in, check-out, survey submission, and completion
additionally require the caller to actually **be** the visit's assigned
agent — holding the permission alone is not enough, even for an admin.

## GPS

Check-in and check-out each capture `lat/lng/accuracy_m`, timestamped
server-side (`now()`), never the client's clock. Repeated check-in (or
check-out) is **idempotent** — a conditional `UPDATE ... WHERE ... AND
check_in_at IS NULL` means a retried or concurrently duplicated submission
returns the existing state as a success, not an error or a second record.

`gps_distance_meters` is a straight-line haversine distance
(`apps/api/src/field/distance.ts`) between the visit's optional
`site_lat/lng` and the check-out point — **not** road distance, no mapping
provider. `travel_km` is a separate, operator-entered figure captured
alongside check-out.

## Site survey

The same generic custom-field engine from ADR 0031 (`entity = 'visit'`
instead of `'lead'`) — not a second engine. A tenant admin defines survey
questions via the existing `POST /crm/custom-fields` endpoint with
`entity: "visit"` (`text | number | boolean | date | select`, optional
`isRequired`). There is no visual form builder; this is deliberate scope
discipline, not an oversight. Clans' solar-specific questions (roof type,
sanctioned load, meter type, orientation, shading, …) are representable
today as tenant-configured `visit` custom fields, without a single
solar-specific column anywhere in `visits`.

## Photos / attachments

`visit_attachments` stores metadata only; bytes live in the object storage
service (`apps/api/src/storage/`) behind the `ObjectStorageService`
interface (ADR 0015). V1 ships a local-filesystem adapter (dev-safe, keeps
large binaries out of Postgres); a real S3/R2 adapter can be swapped in later
without touching any caller. Uploads are authenticated `multipart/form-data`
(15 MB cap, image/PDF content types only); downloads stream through an
authenticated API route that re-checks tenant/RBAC/ownership before ever
touching storage — no public or long-lived signed URLs.

## Field-generated leads

A field agent creates a lead through the **same** `POST /crm/leads` endpoint
CRM uses, with `origin: "field_agent"` — the same dedup rules, the same
lifecycle, no second lead model or API.

## Timeline: visit vs. lead

`visit_activities` is the full, detailed visit timeline. Six of its
milestones (`visit_scheduled, visit_checked_in, visit_survey_completed,
visit_checked_out, visit_completed, visit_cancelled`) also land on the
**existing** `lead_activities` timeline, so a CRM user sees a visit's key
moments directly from the lead — without duplicating the whole visit
timeline onto the lead.

## API (`/api/v1`)

| Method + path                                                                  | Permission                                        |
| ------------------------------------------------------------------------------ | ------------------------------------------------- |
| `GET/POST /field-agents`                                                       | `field.agents.manage`                             |
| `POST /field-agents/:membershipId/deactivate`                                  | `field.agents.manage`                             |
| `GET /visits` (filter: status, leadId, assignedMembershipId, today; paginated) | `field.visits.read`                               |
| `GET /visits/:id`                                                              | `field.visits.read`                               |
| `POST /visits` (schedule)                                                      | `field.visits.create`                             |
| `POST /visits/:id/assign`                                                      | `field.visits.assign`                             |
| `POST /visits/:id/reschedule`                                                  | `field.visits.assign`                             |
| `POST /visits/:id/cancel`                                                      | `field.visits.assign`                             |
| `POST /visits/:id/check-in` / `check-out`                                      | `field.visits.checkin` (+ own assignment)         |
| `GET/POST /visits/:id/survey`                                                  | `field.visits.survey` (+ own assignment for POST) |
| `POST /visits/:id/complete`                                                    | `field.visits.complete` (+ own assignment)        |
| `GET /visits/:id/activities`                                                   | `field.visits.read`                               |
| `GET/POST /visits/:id/notes`                                                   | `field.visits.read` / `crm.activities.create`     |
| `GET/POST /visits/:id/attachments`                                             | `field.visits.read` / `field.visits.attachments`  |
| `GET /visits/:id/attachments/:attachmentId/download`                           | `field.visits.read`                               |
| `DELETE /visits/:id/attachments/:attachmentId`                                 | `field.visits.attachments`                        |
| `GET/POST /crm/custom-fields?entity=visit`                                     | `crm.leads.read` / `crm.leads.update`             |

Every route is RLS-scoped to the active tenant (ADR 0027), correlation-ID
traced (`OBSERVABILITY.md`), and returns the platform's stable error codes —
no field-specific API version or error envelope.

## Internal events (existing outbox, ADR 0013)

`visit.created`, `visit.assigned`, `visit.rescheduled`, `visit.checked_in`,
`survey.completed`, `visit.checked_out`, `visit.completed`. No external
connector consumes these yet — that is future integration-engine work
(`INTEGRATIONS.md`), reusing the same outbox, never a second event bus.

## Offline / resilience (V1)

Online-first with resilient local drafts, per ADR 0033 §12 — not a true
offline-first sync engine. Server-side idempotency (above) covers retried
network calls; the mobile UI additionally keeps a `localStorage` draft of
in-progress survey answers and queues photo uploads for retry, with honest
UI states (saved / queued / failed) rather than a false "success."

## Strictly out of scope this phase

HR/employee/attendance/leave/payroll/expense/incentive management; solar
design, BOQ, quotations, booking, procurement, inventory, installation,
finance; WhatsApp/SMS/email/IndiaMART/Justdial/Meta/Google connectors;
AI lead-scoring or survey analysis; route optimization or a paid mapping
provider; territory management or round-robin assignment; a general
workflow engine; a global `audit_logs` system; native mobile apps;
microservices.
