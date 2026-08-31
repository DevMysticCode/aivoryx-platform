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
organizations
branches
departments
users
roles
permissions
employees

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

## Migration

Schema changes must use versioned **Drizzle** migrations, run by the dedicated
migration role as a release step before the new API version takes traffic.
Migrations are forward-only and backward-compatible for one release.
Never manually edit production schema.
