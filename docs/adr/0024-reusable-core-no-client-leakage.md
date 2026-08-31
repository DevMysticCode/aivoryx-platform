# ADR 0024 — Reusable Core, No Client-Specific Leakage

Status: Accepted

## Context
This is the first implementation of a reusable Aivoryx SaaS platform, delivered
for one client first (decision 33, `README.md`). The commercial value depends on
the core staying generic.

## Decision
Client-specific and provider-specific behaviour must not appear in reusable core
modules. It is expressed only as:

- **configuration / data** (sources, mapping profiles, custom-field definitions,
  email ingest rules, RBAC roles, workflow rules), or
- a **clearly isolated vertical extension** module, never as a branch inside a
  core module.

Concrete rules:
- No `if (tenant === …)` / `if (provider === …)` / client-name literals in core.
- Provider knowledge is confined to a single adapter module (ADR 0018).
- The canonical lead field set changes only by doc/ADR update.
- Module boundaries are enforced by ESLint import rules in CI (`CLAUDE.md §6`).
- Seed/demo data for the client lives in a separate, clearly labelled place.

## Consequences
A second tenant/client can be onboarded by configuration. Code review and CI
reject client-specific conditionals in core. Some early features cost a little
more to build generically; this is accepted.
