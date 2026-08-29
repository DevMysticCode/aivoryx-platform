# Database Guide

## Principle

One integrated business data architecture, tenant-scoped at every layer.

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

## Platform entities

audit_logs
workflow_definitions
workflow_runs
integration_connections
integration_events
outbox_events
job_runs

## Rules

- UUIDs/ULIDs are preferred for externally visible identifiers.
- Include created_at/updated_at consistently.
- Soft deletion only where business/legal semantics require it.
- Add tenant_id to tenant-owned records.
- Use foreign keys and indexes intentionally.
- Index common filters: tenant_id + status, tenant_id + created_at, assignment fields.
- Never expose raw internal DB IDs as a security boundary.

## Migration

Schema changes must use versioned migrations.
Never manually edit production schema.
