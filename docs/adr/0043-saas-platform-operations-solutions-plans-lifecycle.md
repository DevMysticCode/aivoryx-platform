# ADR 0043 — SaaS Platform Operations: Tenant Lifecycle, Solutions, Plans & Subscriptions

Status: Accepted (Phase 14 — the operational layer around Phase 13's platform
access foundation: tenant provisioning, a code-defined solution/plan
catalogue, an explicit tenant lifecycle, and a subscription abstraction)

Builds on ADR 0026 (identity/tenancy), ADR 0027 (RLS), ADR 0040 (global audit
log), ADR 0042 (module entitlements — unchanged, still the sole authorization
boundary).

It adds **no** billing/payment processing, **no** Stripe or other provider
integration, **no** marketplace, **no** microservices, **no** second
authorization model, and **no** vertical-specific business logic in the
platform layer.

## Context

Phase 13 gave Aivoryx module entitlements and a platform-admin identity, but
every tenant was still created by hand — a seed script, never an API. There
was also no explicit tenant lifecycle (`tenants.status` only distinguished
`active`/`suspended`), no vocabulary for "what this customer bought" beyond
the raw module set, and no place to hang future billing without redesigning
the entitlement model.

The product direction (stated explicitly for this phase) is that Aivoryx is a
**horizontal platform that ships vertical solutions as configuration**, never
as forked or hardcoded business logic:

```
Solution / Plan
    ↓
Tenant Module Entitlements   ← the ONLY authorization boundary, unchanged
    ↓
Profiles → Permission Sets → Data Scope → User / Membership
```

## Decision

### 1. Four commercial/product concepts, never collapsed into one table

| Concept          | What it is                                          | Where it lives                                                           |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| **Solution**     | A product preset — a recommended module set         | Code (`@aivoryx/shared` `SOLUTION_DEFINITIONS`)                          |
| **Plan**         | Commercial packaging, resolves to one solution      | Code (`@aivoryx/shared` `PLAN_DEFINITIONS`)                              |
| **Subscription** | A tenant's actual commercial relationship to a plan | DB, tenant-owned (`tenant_subscriptions`, RLS)                           |
| **Entitlement**  | The technical authorization boundary                | DB, tenant-owned (`tenant_module_entitlements`, unchanged from ADR 0042) |

A solution or plan key is **never** read by any authorization check —
`if (solution === 'SOLAR_EPC')` branching is explicitly forbidden anywhere in
the codebase. Provisioning reads a solution once, to seed
`tenant_module_entitlements`; afterwards the platform admin can freely diverge
a tenant's actual modules from its solution's recommendation, and nothing
re-derives entitlements from the solution/plan again. `tenant_subscriptions`
records commercial status (`active`/`canceled`/`expired`) and a
`billing_provider_ref` placeholder for future billing — it is read-only from
an authorization standpoint.

### 2. Tenant lifecycle is a fourth-and-final enum value set, not a second model

`tenants.status` (`packages/db/src/schema/identity.ts`) is extended from
`['active', 'suspended']` to `['active', 'suspended', 'provisioning',
'archived']` via `ALTER TYPE ... ADD VALUE` (migration 0019) — the same
column, the same enforcement point
(`AuthService.resolveActiveTenant`, which already threw `TENANT_SUSPENDED` for
any non-`active` status; it now attributes the correct specific code —
`TENANT_PROVISIONING` / `TENANT_ARCHIVED` — without changing what
`TENANT_SUSPENDED` itself means for a genuinely suspended tenant). No second
"lifecycle" table, no duplicate status concept.

Allowed transitions (`@aivoryx/shared` `canTransitionTenantStatus`, pure and
unit-tested):

```
provisioning -> active
active       -> suspended | archived
suspended    -> active | archived
archived     -> (terminal — no un-archiving, no destructive deletion, yet)
```

A non-`active` tenant fails closed at the exact point every tenant-scoped
request already resolves its context — no new middleware, no bypass surface
for a platform admin (whose routes never require an active tenant to begin
with, per ADR 0042).

### 3. Provisioning is one small orchestrating service, not a workflow engine

`TenantProvisioningService` (`apps/api/src/platform/`) does five things in
sequence: insert the tenant row, enable the resolved module set + create the
generic `TENANT_ADMIN` role (reusing `provisionTenantAdmin`, unchanged from
seed tooling), record the subscription, create the admin invitation (reusing
`InvitationService.create`, extended to accept a `SYSTEM` actor since a
platform admin has no membership in the tenant being created), and flip the
tenant to `active`. It depends only on `@aivoryx/db`, the code-defined
solution/plan catalogues, `AuditService`, `InvitationService` (identity, not a
business module) and its own sibling `PlatformService` — never CRM, HR,
Field, Finance, EPC or Supply internals.

It is **not** one ACID transaction end-to-end (each reused primitive owns its
own transaction) — a genuinely async, fully-transactional provisioning
pipeline was judged out of scope for this phase (no infrastructure
provisioning actually happens; everything is synchronous DB writes). The
idempotency guarantee that matters in practice — a retried identical request
never creates a second tenant — comes from a much smaller mechanism: the
tenant's slug is derived deterministically from its name (no random
component, no silent suffix-retry), so a retry collides on the same unique
slug and fails closed with `PLATFORM_TENANT_SLUG_TAKEN`.

### 4. `tenants` itself needed an RLS-aware insert path

`tenants` has carried `ENABLE`+`FORCE ROW LEVEL SECURITY` since migration 0003
(`tenants_visibility`: `WITH CHECK (id = app.tenant_id)`) — there was
previously no INSERT policy at all because nothing but a seed script (running
as the database owner, which bypasses RLS) ever created a tenant. Api-layer
code runs as the non-privileged `aivoryx_app` role, so a plain insert is
rejected by Postgres. `TenantProvisioningService` generates the tenant's UUID
itself (`newUuidV7()`, not a server default) precisely so it can bind
`app.tenant_id` to that id _before_ the insert, satisfying the existing
`WITH CHECK` — no new policy, no owner-connection carve-out.

### 5. Basic usage is computed, not tracked

`PlatformService.usage()` runs a handful of `COUNT(*)` queries against
existing tables (`leads`, `projects`, `invoices`, `employees`), each only when
the owning module is enabled for that tenant (otherwise the metric is `null`,
never a fabricated zero). No analytics engine, no pre-aggregation, no new
tables. Storage usage is omitted entirely — there is no real
storage-accounting infrastructure to source it from, and inventing a number
would violate the same "never fabricate data" principle established in
Phase 13D's CRM analytics.

## Consequences

- Adding a new vertical (a fourth `Solution`) is a code change to one array in
  `@aivoryx/shared` plus, if genuinely new capability is needed, a new module
  in the existing module catalogue — never a change to the platform's
  authorization code.
- Billing can be added later by pointing `tenant_subscriptions` at a real
  payment provider (populating `billing_provider_ref`, adding a webhook
  handler) without touching `tenant_module_entitlements` or any
  `SecurityGuard` code path.
- The tenant list/detail UI still loads every tenant into the browser
  (`GET /platform/tenants` is unpaginated) — acceptable at today's scale, and
  explicitly called out as deferred work in `PRODUCT-UX.md`, not silently
  left broken.
