# CRM Core — Lead Domain

Status: **Implemented in Phase 3** (ADR 0031). Covers decision area 3 (CRM
primary business stream). This is the reusable Lead domain only — field
visits, surveys, quotations, booking, and everything after qualification are
later phases (CLAUDE.md §3, §28).

## Entities

```
leads
  id, tenant_id, source_id?, name?, phone?, normalized_phone?, email?,
  normalized_email?, address_line? / city? / state? / postal_code? / country?,
  status, assigned_membership_id?, qualification_note?, created_at, updated_at

lead_activities        -- append-only timeline
  id, tenant_id, lead_id, type, actor_membership_id?, payload (jsonb), created_at

lead_notes             -- editable/deletable, separate from the timeline entry it creates
  id, tenant_id, lead_id, author_membership_id?, body, created_at, updated_at, deleted_at?

lead_followups
  id, tenant_id, lead_id, assigned_membership_id?, due_at, status,
  note?, result?, created_at, completed_at?

custom_field_definitions / custom_field_values   -- see CUSTOM-FIELDS.md
```

All tenant-owned, RLS `ENABLE`+`FORCE`d (`TENANCY.md`). `source_id` is null
for a manually-created lead; non-null for one that arrived through the
inbound integration engine (`LEAD-INGESTION.md`, ADR 0032).

## Lifecycle

```
NEW -> ASSIGNED | CONTACTED | QUALIFIED | DISQUALIFIED
ASSIGNED -> CONTACTED | QUALIFIED | DISQUALIFIED
CONTACTED -> QUALIFIED | DISQUALIFIED
QUALIFIED -> CONVERTED | DISQUALIFIED
DISQUALIFIED / CONVERTED -> terminal
```

See ADR 0031 for the exact rationale. Enforced in
`apps/api/src/crm/lead-lifecycle.ts` (pure, unit-tested); invalid transitions
return `409 LEAD_INVALID_TRANSITION`.

## Deduplication

Conservative, deterministic, tenant-scoped: exact `normalized_phone` match,
then exact `normalized_email` match; ambiguous or no match ⇒ create a new
lead. A match enriches blanks only and never touches `status`. Full rule and
rationale in ADR 0031 §5; normalization rules in
`apps/api/src/crm/lead-normalization.ts`.

## API (`/api/v1/crm`)

| Method + path                                                                   | Permission                                      |
| ------------------------------------------------------------------------------- | ----------------------------------------------- |
| `GET /crm/leads` (filter: status, sourceId, assignedMembershipId, q; paginated) | `crm.leads.read`                                |
| `GET /crm/leads/:id`                                                            | `crm.leads.read`                                |
| `POST /crm/leads`                                                               | `crm.leads.create`                              |
| `PATCH /crm/leads/:id`                                                          | `crm.leads.update`                              |
| `POST /crm/leads/:id/assign`                                                    | `crm.leads.assign`                              |
| `POST /crm/leads/:id/status`                                                    | `crm.leads.update`                              |
| `POST /crm/leads/:id/qualify`                                                   | `crm.leads.qualify`                             |
| `POST /crm/leads/:id/call-attempts`                                             | `crm.activities.create`                         |
| `GET /crm/leads/:id/activities`                                                 | `crm.activities.read`                           |
| `GET/POST/PATCH/DELETE /crm/leads/:id/notes[/:noteId]`                          | `crm.activities.read` / `crm.activities.create` |
| `GET/POST /crm/leads/:id/followups`, `.../complete`, `.../reschedule`           | `crm.leads.followup`                            |
| `GET/POST /crm/custom-fields`, `PATCH .../:id/deprecate`                        | `crm.leads.read` / `crm.leads.update`           |

Every route is additionally RLS-scoped to the active tenant (ADR 0027) — a
lead, note, follow-up, or custom field from another tenant is invisible and
unmodifiable, proven directly against PostgreSQL as `aivoryx_app`
(`apps/api/test/rls.int.spec.ts`).

## RBAC

New permissions (ADR 0029's catalogue, `@aivoryx/shared`):
`crm.leads.read`, `crm.leads.create`, `crm.leads.update`, `crm.leads.assign`,
`crm.leads.qualify`, `crm.leads.followup`, `crm.activities.read`,
`crm.activities.create`, `crm.integrations.manage`. `TENANT_ADMIN` holds the
full catalogue automatically (unchanged mechanism from ADR 0029) and needs no
special-casing to retain administrative control. There is currently no API to
create a scoped business role (e.g. "Telecaller" with only `crm.leads.*`) —
role-creation endpoints don't exist yet (a pre-existing gap from Phase 2, not
introduced here); only `TENANT_ADMIN` can act on CRM data until that lands.

## Web UI

`/crm` (redirects to `/crm/leads`), `/crm/leads` (search/filter/paginate,
quick-add), `/crm/leads/:id` (contact info, custom fields, assignment, status
actions, qualification, manual call logging, notes, follow-ups, timeline).
Built from the existing Next.js + Tailwind + `@aivoryx/ui` stack and the
`@/components/admin/ui` primitives — no new component library or pattern.

## Out of scope (unchanged)

Field visits, surveys, quotations, booking, procurement, AI lead scoring,
round-robin/territory assignment, a general workflow engine — see CLAUDE.md
§3/§28 and ADR 0031/0032 for what is explicitly deferred.
