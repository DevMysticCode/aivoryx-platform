# ADR 0033 — Field Operations: Visits, Field Agents, GPS, and Site Survey

Status: Accepted (Phase 4 — field operations, visits, mobile PWA, GPS & site survey)

Builds on ADR 0026 (identity/membership), ADR 0027 (RLS), ADR 0029 (RBAC),
ADR 0031 (CRM core / custom fields), ADR 0032 (integration engine / outbox),
and ADR 0015 (object storage). Implements field visits as a business domain
**on top of** the existing platform — no second identity, tenancy, RLS,
RBAC, event, custom-field, or storage mechanism.

## Decision

### 1. Field agent is a capability flag, not a new identity model

`field_agents` is a thin row keyed on `(tenant_id, membership_id)` with a
`status` (`active` | `inactive`). It carries no salary, department,
attendance, or leave data — that is explicitly deferred to a future HR phase
(ADR TBD). A user becomes a field agent by designation on their _existing_
`user_tenant_memberships` row; deactivating the flag revokes field access
only, never the membership itself.

### 2. A second generic platform role: `FIELD_AGENT`

ADR 0029 deliberately shipped only one generic role (`TENANT_ADMIN`, holding
the full permission catalogue) because there was no second real access
profile yet. Phase 4 introduces the first one: `FIELD_AGENT`, provisioned by
`provisionFieldAgentRole` (mirroring `provisionTenantAdmin`) with a fixed,
narrow grant:

```
field.visits.read
field.visits.checkin
field.visits.survey
field.visits.attachments
field.visits.complete
crm.leads.create
crm.activities.create
```

Deliberately **excluded**: `field.visits.create/assign/update`,
`field.agents.manage`, and `crm.leads.read/update` — scheduling, assignment,
and general lead visibility stay CRM/admin-only. There is still no
role-creation API; both platform roles are provisioned by code, not
configured by tenants.

### 3. Visit lifecycle — five statuses, no workflow engine

```
SCHEDULED -> ASSIGNED | CANCELLED
ASSIGNED  -> IN_PROGRESS | CANCELLED
IN_PROGRESS -> COMPLETED | CANCELLED
COMPLETED -> (terminal)
CANCELLED -> (terminal)
```

`RESCHEDULED` is deliberately **not** a status. Rescheduling updates
`scheduled_at` on a visit that stays `SCHEDULED`/`ASSIGNED` and is recorded as
a `rescheduled` visit activity — treating it as a state would double the
transition graph for no benefit. Enforced by a pure function
(`apps/api/src/field/visit-lifecycle.ts`), mirroring `lead-lifecycle.ts`.
Assignment/reassignment and rescheduling are only permitted before on-site
work starts (`SCHEDULED`/`ASSIGNED`) — once a visit is `IN_PROGRESS` the
agent is already on the way or on site.

### 4. Visit visibility: reuse `crm.leads.read` as the "sees everything" signal

A field agent sees only visits assigned to their own membership; a CRM/admin
user (anyone holding `crm.leads.read`) sees every tenant visit. This mirrors
the exact ownership-check pattern already used for Phase 3's lead-note
edit/delete permission (`canManageAnyNote`) — no new "visibility" permission
was introduced for a single boolean. The check is enforced in
`VisitsService`, never trusted from client-supplied filters: a field agent's
`assignedMembershipId` filter is always overridden server-side to their own
membership id.

### 5. GPS check-in/out: columns on `visits`, not a separate table

`check_in_at/lat/lng/accuracy_m` and the `check_out_*` equivalents live
directly on `visits`. A separate `visit_gps_events` table would suit repeated
tracking pings, which this phase does not need — one check-in and one
check-out per visit is the full requirement.

**Idempotency**: repeated check-in (or check-out) is a conditional `UPDATE
... WHERE status = 'ASSIGNED' AND check_in_at IS NULL` (mirroring the
Phase 3 pattern used for connector-secret rotation). A second call that loses
the race returns the _existing_ row as a successful, idempotent response —
not an error. This differs deliberately from Phase 2's one-time invitation
token (correctly an error on replay): a visit check-in is not a
security-sensitive single-use secret, so silently no-op'ing a duplicate
submission (the concurrency scenario the phase brief calls out) is the
correct, user-friendly behavior. Concurrent duplicate requests are proven
safe by a real concurrent-request integration test, not just reasoned about.

**Authorization**: check-in, check-out, survey submission, and completion all
require `current.assigned_membership_id === caller's own membership` —
holding `field.visits.checkin` etc. alone is not enough, even for
`TENANT_ADMIN`. Presence at a site is inherently the assigned agent's action;
an admin can reschedule or reassign a visit but cannot check in "on behalf
of" someone else.

### 6. GPS distance is straight-line, not road distance — no mapping provider

`gps_distance_meters` is a haversine (`apps/api/src/field/distance.ts`)
computed between the visit's optional, manually-entered `site_lat/lng` and
the **check-out** coordinates, only when both are present — never assumed to
be zero when a coordinate is missing. This is explicitly not road distance:
no Google Maps, no routing/mapping provider, no route optimization. Manual
`travel_km` + `travel_notes` are captured alongside it at check-out time as
an independent operator-entered figure; the two are never conflated.

### 7. Site survey reuses the Phase 3 custom-field engine — not a second one

`custom_field_definitions.entity` gained a `visit` member alongside `lead`.
The same coercion/validation/persistence functions in
`apps/api/src/crm/custom-fields.service.ts` now take an explicit `entity`
parameter (defaulting to `'lead'` so every existing call site is unchanged)
and serve both. No new "photo" or "location" custom-field data type was
added — the existing `text/number/boolean/date/select` set is enough for
survey questions, and photos/GPS already have their own dedicated mechanisms
(attachments, check-in/out columns). This keeps Clans' solar-specific
questions (roof type, sanctioned load, meter type, …) fully representable as
tenant-configured `visit` custom fields later, with **zero** solar-specific
columns anywhere in `visits`.

A visit's survey is "complete" when every `isRequired` active `visit` custom
field has a non-null, non-empty value — computed on demand
(`VisitsService.isSurveyComplete`), with `visits.survey_completed_at` cached
the first time it becomes true (and left alone afterwards, so re-submitting
optional answers never un-completes a finished survey).

### 8. Visit timeline vs. lead timeline — two tables, one purpose each

`visit_activities` is the full, detailed, append-only visit timeline
(created, assigned, reassigned, rescheduled, checked_in, survey_started,
survey_completed, photo_uploaded, photo_removed, note, checked_out,
completed, cancelled) — mirrors `lead_activities`' shape exactly.

Six of those milestones also get a matching row on the **existing**
`lead_activities` table (new enum members: `visit_scheduled,
visit_checked_in, visit_survey_completed, visit_checked_out,
visit_completed, visit_cancelled`), so a CRM user reading a lead's timeline
sees the visit's key moments without opening the visit at all. This is
deliberately not a duplication of the full visit timeline onto the lead —
only the handful of events a CRM user actually cares about.

### 9. Visit notes: a dedicated table, structurally mirroring `lead_notes`

A visit-specific note cannot live in lead-scoped `lead_notes` because one
lead can have several visits and a note usually concerns one specific visit.
`visit_notes` mirrors `lead_notes`'s shape (author, body, soft-delete column
present for future parity) but is intentionally append-only at the API
surface today — no edit/delete endpoint, since the phase brief only asked for
"author/timestamp/content" appearing on the timeline, not full note
moderation.

### 10. Lead provenance: `leads.origin`, not a second lead table

A field-generated lead **is** a `leads` row — it goes through the exact same
`POST /crm/leads`, the same dedup rules, the same lifecycle. The only new
surface is `leads.origin` (`manual | inbound | field_agent`, a new
`lead_origin` enum) so it can be filtered/labelled. The inbound ingestion
pipeline (ADR 0032) now explicitly sets `origin: 'inbound'`; the field app
sets `origin: 'field_agent'` on its `POST /crm/leads` call; everything else
defaults to `'manual'`. There is no separate field-lead API, model, or
lifecycle — only a UI route (`/field/leads/new`) that calls the existing
endpoint.

### 11. Object storage V1: local filesystem adapter, authenticated download

ADR 0015 specified "S3-compatible, Cloudflare R2 initially" behind an
internal interface, but no implementation existed yet (only env-schema
placeholders). Phase 4 needed one for visit photos and built the **minimum
development-safe adapter**: `ObjectStorageService` (`putObject/getObject
/deleteObject`) with a `LocalFilesystemObjectStorageService` implementation
storing bytes under `OBJECT_STORAGE_LOCAL_DIR`, keyed as
`tenants/<tenantId>/visits/<visitId>/<uuid><ext>` (server-generated only —
never client-supplied, and key structure is defense-in-depth, not the
authorization boundary).

Downloads go through an **authenticated API route**
(`GET /visits/:id/attachments/:id/download`), which re-checks tenant/RBAC/
visit-ownership before ever touching storage, rather than a signed URL — a
local adapter has no bucket to sign against, and an authenticated stream is
at least as strong a boundary for V1. A real S3/R2 adapter (with presigned
URLs) can be swapped in later purely inside `storage.module.ts` without
touching any caller, per ADR 0015's abstraction requirement. Cloudflare R2
itself is explicitly **not** introduced this phase.

### 12. Offline/resilience: online-first with resilient local drafts (V1)

The phase brief allowed stopping to document a true offline-first
architecture if required, but preferred an online-first approach with
resilient local drafts/queued submissions for V1 "unless testing proves
insufficient." Nothing in this phase's testing surfaced a case that online-
first cannot handle (check-in/out and survey submission are all small,
idempotent, single-shot API calls). V1 therefore ships:

- server-side idempotency for check-in/out (§5) so a retried submission from
  a flaky connection never double-records;
- a browser-side draft/retry layer (localStorage) for the survey form and
  queued photo uploads, so a temporary network failure does not lose
  in-progress field work;
- explicit, honest UI states — "saved," "queued, will retry," "failed" —
  rather than claiming full offline support.

A true offline-first sync engine (service-worker-mediated conflict
resolution, background sync APIs, an offline data store) is **not** built.
If a future phase's testing shows online-first is insufficient (e.g.
genuinely disconnected rural sites for extended periods), that is a new ADR,
not a silent scope expansion of this one.

## Consequences

- Field operations adds five new tables (`field_agents`, `visits`,
  `visit_activities`, `visit_notes`, `visit_attachments`), all tenant-owned,
  RLS-enabled and forced, granted to `aivoryx_app`, following the exact
  `packages/db/drizzle/000N_*.sql` hand-appended RLS pattern from ADR 0030 —
  verified by direct PostgreSQL RLS tests in `apps/api/test/rls.int.spec.ts`.
- `custom_field_definitions`/`custom_field_values`'s `entity` enum and the
  underlying service functions are now genuinely generic across two entities,
  validating the ADR 0031 design without a rewrite.
- No HR, payroll, attendance, leave, route optimization, quotation, booking,
  procurement, inventory, finance, or native-mobile capability was added —
  those remain explicitly out of scope per the phase brief.
