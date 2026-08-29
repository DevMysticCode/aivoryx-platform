# ADR 0004 — Aivoryx Integration Engine

Status: Accepted

## Decision
Build a lightweight reusable integration engine with webhooks, REST connectors, mapping, conditions, actions, retries and logs.

Do not build a full Pabbly/Zapier clone in the first release.

## Reason
The client currently depends on Pabbly, and integration is a reusable Aivoryx capability. The first implementation should remove dependency progressively without creating a second product that delays the client system.
