# ADR 0031 — CRM Core & Lead Domain

Status: Accepted (Phase 3 — CRM core & lead ingestion)

Builds on ADR 0026 (identity/membership model), ADR 0027 (RLS), ADR 0029 (RBAC),
and the `docs/architecture/CUSTOM-FIELDS.md` architecture. Implements the
reusable Lead entity so any inbound source or manual entry produces one
consistent CRM record, independent of industry or provider.

## Decision

### 1. Lead is generic, not solar-specific

`leads` carries only fields common across verticals: identity/contact
(`name`, `phone`, `email`, address fields), `source_id`, `status`,
`assigned_membership_id`, and `qualification_note`. Anything client- or
industry-specific (electricity bill, roof type, solar capacity, property
type, …) is a `custom_field_definitions` / `custom_field_values` row per
`docs/architecture/CUSTOM-FIELDS.md` — never a column on `leads`.

Custom fields ship as the narrow typed-column EAV design that document
already specifies, trimmed for V1: a single `lead` entity (the doc's `entity`
enum is extensible but only has one member today), no `is_filterable` /
`is_reportable` flags or declarative `validation` JSON (coercion + `options`
for `select` cover the "sensible types" requirement without an elaborate
form-builder), and no filterable-value indexes beyond `(tenant_id, entity,
entity_id)` — added when a real custom-field filtering requirement exists.

### 2. Lifecycle — a fixed, small graph

```
NEW -> ASSIGNED | CONTACTED | QUALIFIED | DISQUALIFIED
ASSIGNED -> CONTACTED | QUALIFIED | DISQUALIFIED
CONTACTED -> QUALIFIED | DISQUALIFIED
QUALIFIED -> CONVERTED | DISQUALIFIED
DISQUALIFIED -> (terminal)
CONVERTED -> (terminal)
```

`QUALIFIED`/`DISQUALIFIED` are reachable from any non-terminal status — a
telecaller can qualify or disqualify as soon as they've spoken to the lead,
without a mandatory "mark contacted" step first. Everything else is strict:
no reopening a terminal lead, no skipping backwards. Enforced by a pure
function (`apps/api/src/crm/lead-lifecycle.ts`), not a workflow engine — this
is deliberately not a general-purpose state machine product.

Assigning a `NEW` lead bumps it to `ASSIGNED`; reassigning a lead already past
`NEW` changes only the assignee, leaving status untouched. Both the
assignment and the resulting status bump are recorded as separate timeline
activities.

### 3. Assignment history via the timeline, not a separate table

"View current assignee" is a column on `leads`; "assignment history" is the
`lead_activities` rows of type `assigned` / `reassigned` (payload
`{from, to}` membership ids). No dedicated assignment-history table — the
append-only timeline already gives full, ordered history, and extending it
later (round-robin, territory rules) only needs a new activity payload shape,
not a schema change.

### 4. Activities, notes, and follow-ups

- `lead_activities` — append-only, one row per lifecycle event
  (`created, assigned, reassigned, status_changed, note, call_attempt,
qualified, disqualified, followup_created, followup_completed`). `payload`
  is small structured JSON (old/new status, note id, call outcome, …).
  `actor_membership_id` is nullable — `null` marks a system/ingestion actor
  (a lead created by the Pabbly connector has no human actor).
- `lead_notes` — a real table (not just an activity), so notes support
  independent edit/delete and soft-delete (`deleted_at`), while a `note`
  activity row still marks the note's place on the timeline. Edit/delete is
  allowed for the note's author, or anyone holding `crm.leads.update`
  (typically `TENANT_ADMIN`) — "sensible permissions" per the phase brief,
  without inventing a dedicated notes-moderation permission.
- `lead_followups` — `assigned_membership_id`, `due_at`, `status` (`pending
| completed | cancelled`), `note` (at creation) / `result` (at
  completion). Reschedule is a `due_at` update on a still-pending follow-up;
  completing an already-completed follow-up is rejected
  (`FOLLOWUP_ALREADY_COMPLETED`). No task-management platform — no
  priorities, no recurrence, no dependencies.

### 5. Deduplication — conservative and deterministic (also governs Pabbly ingestion, ADR 0032)

Exact match only, tenant-scoped, in this priority order:

1. `normalized_phone` — strip everything except digits and a leading `+`; a
   `+`/`00` international prefix is preserved, but **no default country code
   is ever assumed** for a bare local number (deliberately conservative — a
   guessed country code would risk merging two different people's leads).
2. `normalized_email` — `trim().toLowerCase()`.
3. Neither present, or a query for one identifier returns more than one
   match (ambiguous) → treated as **no match**. Creating a new lead is always
   safer than guessing which existing lead to merge into.

On a match: **update the existing lead conservatively** — fill blank fields
only, never overwrite a value that is already set, never touch `status` or
`qualification_note`. Attach a `note` activity recording that a duplicate
event was re-ingested from the source. **Never** create a second lead for the
same identity within a tenant. **Never** match across tenants — the lookup is
always scoped by `tenant_id` (enforced twice: the application `WHERE` clause
and PostgreSQL RLS).

No fuzzy/AI matching (Soundex, similarity scoring, ML) — out of scope by the
phase brief and inappropriate for financial/contact data without human
review.

## Consequences

- New tables: `leads`, `lead_activities`, `lead_notes`, `lead_followups`,
  `custom_field_definitions`, `custom_field_values` — all tenant-owned, RLS
  `ENABLE`+`FORCE`d (migration `0005`, ADR pattern from ADR 0027/0030).
- New permissions: `crm.leads.read/create/update/assign/qualify/followup`,
  `crm.activities.read/create`. `TENANT_ADMIN` (full catalogue) retains
  administrative control automatically; no other role is seeded — a tenant
  currently has no API to create a scoped "Telecaller" role (role-creation
  endpoints don't exist yet — a Phase 2 gap, not introduced here).
- The dedupe rule is intentionally simple enough to unit-test exhaustively
  and to explain to a support engineer in one sentence.
