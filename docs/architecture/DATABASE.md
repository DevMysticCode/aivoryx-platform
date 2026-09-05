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

leads
lead_sources
lead_source_events
lead_assignments
customers
activities
tasks
follow_ups
calls

## Field/Sales entities

field_visits
site_surveys
survey_attachments
quotations
quotation_versions
bookings

## Lead ingestion entities

sources
connectors_config
lead_mapping_profiles
lead_mapping_rules
raw_events
canonical_lead_events
integration_event_log
dead_letter_events
email_ingest_rules

See `LEAD-INGESTION.md`, `FIELD-MAPPING.md`, `RAW-EVENTS-AND-REPLAY.md`,
`EMAIL-INGESTION.md`.

## Custom field entities

custom_field_definitions
custom_field_values

Typed definition + typed-value-column storage (not one JSON blob), filterable
and reportable. See `CUSTOM-FIELDS.md`.

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
