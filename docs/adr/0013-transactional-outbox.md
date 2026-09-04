# ADR 0013 — Transactional Outbox for Important Events

Status: Accepted

## Context

Domain events (`LeadCreated`, `LeadAssigned`, `QuotationApproved`,
`BookingCreated`, `EmployeeCreated`, …) must not be lost when the database
commit and the message publish can fail independently.

## Decision

Write important events to an **`outbox_events`** table in the **same
transaction** as the state change. A BullMQ dispatcher polls/streams the outbox
and delivers events to in-process handlers (and later external subscribers),
marking each delivered.

- Events carry `tenant_id`, `correlation_id`, type, payload, occurred_at.
- Delivery is at-least-once; consumers are idempotent.
- Cross-module communication uses events + application services, never direct
  table access (`CLAUDE.md §6`).

## Consequences

State and events stay consistent across crashes. A small delivery lag is
accepted. The outbox is tenant-scoped and RLS-protected like any other table.
