# Backend Developer Guide

## Stack

NestJS + TypeScript + PostgreSQL + Redis + OpenAPI.

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

HTTP → authentication → tenant resolution → authorization → DTO validation → application use case → domain rules → repository → events/outbox → response.

## Tenant safety

Tenant context comes from authenticated server context. Never accept tenant identity as an authority from client input.

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

Use Redis-backed workers for:
- external API calls
- notifications
- document processing
- integration retries
- heavy reporting

Do not block HTTP requests for long-running work.

## Security

Validate input, authorize every operation, sanitize external payloads, protect secrets, avoid logging sensitive data, and audit privileged actions.
