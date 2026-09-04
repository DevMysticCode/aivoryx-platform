# ADR 0008 — UUIDv7 Identifiers

Status: Accepted

## Context

The earlier draft said "UUIDs/ULIDs are preferred" without choosing. Identifier
type must be fixed before the first migration because it is pervasive.

## Decision

All primary keys and externally visible identifiers are **UUIDv7**.

- Time-ordered, so index locality and insert performance are close to a serial
  key while remaining globally unique and safe to expose.
- No auto-increment integer keys on business tables.
- Correlation/reference ids shown to users keep the separate `AIV-<ULID>` format
  (ADR 0014) and are not database keys.

## Consequences

One identifier type everywhere. Generation happens in the application (or a DB
default function); code must not assume sequential integers. Raw ids remain not
a security boundary — authorization is still enforced (ADR 0009, 0011).
