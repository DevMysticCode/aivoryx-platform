# `src/modules/` — business/domain modules

Empty in Phase 1 by design.

Domain modules (CRM, HR, Field, Lead Ingestion, ...) are added here in later
phases, one bounded vertical slice at a time (see `docs/claude/AI-DEVELOPMENT.md`
and `docs/architecture/ARCHITECTURE.md`).

Rules (enforced by ESLint module-boundary config + review):

- A module talks to another module only through its application services and
  domain events (transactional outbox), never by importing its tables
  (`CLAUDE.md §6`, ADR 0013).
- Every tenant-owned table gets `tenant_id` + forced RLS + a registered tenant
  guard (ADR 0009).
- No client-specific or provider-specific branching in a module core (ADR 0024).
