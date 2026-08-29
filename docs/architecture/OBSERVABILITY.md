# Observability and Client-Debugging

## Goal

A client should be able to give support a precise failure reference.

## Correlation ID

Every request and important background event receives a correlation ID.

Example:
`AIV-01JXXXXXXXXXXXX`

Return it in API responses/headers where appropriate.

## User-facing failure

Always show:
- concise failure statement
- safe reason
- next action
- reference ID

Example:
“Lead could not be assigned because no eligible telecaller is available. It has been queued for manual assignment. Reference: AIV-01J…”

## Log fields

- timestamp
- correlation_id
- tenant_id
- user_id
- module
- operation
- severity
- duration
- error_code
- external_provider
- external_event_id

Never log:
- passwords
- tokens
- secrets
- full payment credentials
- unnecessary personal data
- full call recordings

## Integration event lifecycle

RECEIVED → VALIDATING → PROCESSING → SUCCEEDED

or

RECEIVED → PROCESSING → FAILED → RETRYING → SUCCEEDED

or

FAILED → DEAD_LETTERED

Admin/support can inspect and replay safe failed events.
