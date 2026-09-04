# Backend Developer Guide

## Stack

NestJS + TypeScript + PostgreSQL + **Drizzle ORM** + Redis + **BullMQ** + code-first OpenAPI.

- All primary keys and externally visible identifiers are **UUIDv7** (ADR 0008).
- Schema changes are Drizzle migrations run by a dedicated migration role
  (ADR 0007); the request-serving DB role is non-superuser and cannot bypass RLS.
- API is REST under `/api/v1`; the OpenAPI document is generated from NestJS
  decorators (ADR 0005).

## Module structure

Each business module should contain, as appropriate:

- controller
- DTO/contracts
- application/use cases
- domain entities/rules
- repository interface
- infrastructure implementation
- events
- tests

Avoid putting business logic inside controllers.

## Request flow

HTTP → session authentication (cookie) → tenant resolution → authorization (scope-aware RBAC) → DTO validation → application use case → domain rules → repository → events/outbox → response.

Every request/job opens a transaction that first runs `SET LOCAL app.tenant_id / app.user_id / app.role_scope` from authenticated context, so PostgreSQL RLS applies for the whole unit of work.

## Authentication

HTTP-only, `Secure`, `SameSite` cookie sessions backed by a server-side
`sessions` table (ADR 0010). Passwords hashed with Argon2id. No JWT for browser
auth, no tokens in `localStorage`. CSRF token on state-changing requests.
Details in `AUTH.md`.

## Authorization

Scope-aware RBAC (ADR 0011). `@RequirePermission('<module>.<resource>.<action>')`
guards every controller action and injects a scope filter
(`tenant` / `branch` / `department` / `team` / `self`) that the data layer
applies alongside `tenant_id`. Frontend permission checks are cosmetic only.
Details in `AUTH.md`.

## Tenant safety

Tenant context comes from authenticated server context (session → `tenant_id`),
or, for integration events, from the tenant-scoped `source` configuration. Never
accept tenant identity as an authority from client input or payload body.
Enforced twice: PostgreSQL RLS **and** application tenant guards (ADR 0009,
`TENANCY.md`). CI blocks any new tenant-owned table that lacks an RLS policy or
a guard registration.

## Errors

Use stable error codes such as:

- CRM_LEAD_NOT_FOUND
- CRM_LEAD_ASSIGNMENT_UNAVAILABLE
- CRM_DUPLICATE_LEAD
- HR_EMPLOYEE_NOT_FOUND
- AUTH_FORBIDDEN

Map them to safe human-readable messages.

## Idempotency

Inbound webhooks and retryable external operations must tolerate duplicate delivery. Use provider event IDs/idempotency keys.

## Events

Use an outbox pattern for important domain/integration events so database state and emitted events remain reliable.

Examples:

- LeadCreated
- LeadAssigned
- LeadQualified
- SiteVisitCompleted
- QuotationApproved
- BookingCreated
- EmployeeCreated
- LeaveApproved

## Jobs

Use Redis + BullMQ workers (ADR 0012) for:

- external API calls
- notifications
- document processing
- lead ingestion pipeline stages and integration retries/replay
- heavy reporting

Do not block HTTP requests for long-running work. Workers run on a separate
Railway service with no public port. Each job carries a persisted tenant context
and re-establishes `SET LOCAL app.tenant_id` before touching tenant data.
BullMQ requires Redis persistence (AOF) enabled.

## Security

Validate input, authorize every operation, sanitize external payloads, protect secrets, avoid logging sensitive data, and audit privileged actions.
