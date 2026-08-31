# ADR 0007 — Drizzle ORM

Status: Accepted

## Context
The backend needs typed database access and versioned migrations on PostgreSQL.
Tenant isolation will rely on PostgreSQL Row Level Security (ADR 0009), which
needs predictable, inspectable SQL and per-transaction session settings.

## Decision
Use **Drizzle ORM** for schema definition, queries and migrations.

- Migrations are Drizzle-generated, versioned, forward-only, and
  backward-compatible for one release.
- Migrations run under a dedicated migration role (may bypass RLS); the
  request-serving role is non-superuser and cannot bypass RLS.
- The data-access layer is wrapped so every query on a tenant-owned table takes
  an explicit `tenant_id` from `TenantContext`.

## Consequences
Thin, SQL-transparent access that co-operates with RLS and `SET LOCAL`. Less
"magic" than a heavier ORM; some conveniences (e.g. rich lazy relations) must be
written explicitly. UUIDv7 keys (ADR 0008) are generated in the application or
by a database function, not by an ORM identity column.
