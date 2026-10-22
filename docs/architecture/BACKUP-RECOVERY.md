# Backup & Recovery

Status: first version — Production Operations & Customer Launch Readiness
milestone. Grounded in the providers actually selected for staging/production
(`DEPLOYMENT.md`): **Supabase PostgreSQL**, **Supabase Storage**, **Upstash
Redis**. No restore has been performed against a live Supabase/Upstash
instance as of this writing — every claim below that depends on provider
behavior is marked verified / documented-not-verified accordingly. This
document never claims a backup is restorable merely because a provider offers
backups.

**Open discrepancy, flagged rather than silently resolved:** `DEPLOYMENT.md`'s
own "Staging provisioning status" section states that, as of its last update,
no Vercel/Render/Supabase/Upstash resources exist for this project yet. If
staging has since actually been provisioned and verified (as later project
context suggests), `DEPLOYMENT.md` itself is the document that needs updating
by whoever has real dashboard access — this document defers to it rather than
asserting a provisioning state neither can verify from the repository alone.
Treat every "not yet provisioned" statement inherited from `DEPLOYMENT.md` in
this document as **needing a human check against the real dashboards** before
this document is relied on for an actual incident.

## 1. What actually needs to survive a disaster

| Store                          | Provider         | System of record for                                                                                                          | Loss impact if unrecoverable                                                                                             |
| ------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL                     | Supabase         | All tenant business data, RBAC, audit log, sessions, outbox, migration history (`drizzle.__drizzle_migrations` or equivalent) | Total — the only durable store in this platform                                                                          |
| Object storage (S3-compatible) | Supabase Storage | Tenant logos/branding assets, platform branding assets, HR employee documents, finance/EPC attachments                        | Files become unreachable; DB rows referencing them (`object_key`) become dangling                                        |
| Redis                          | Upstash          | BullMQ queue state (notification delivery jobs), session-adjacent caches — **not** a system of record (see below)             | Queued jobs lost; **no business data loss**, because every queued job's durable state already lives in Postgres (see §4) |

Sessions are **PostgreSQL rows** (`sessions` table, hashed token), not a Redis
or in-memory store (ADR 0010/0026) — a Postgres restore also restores session
state (subject to the RPO below), and Redis loss alone never logs anyone out
early enough to matter operationally (sessions keep working; only queued
background jobs are affected).

## 2. Decisions this document cannot make for you

These are genuinely organizational decisions, not engineering facts. Treat
every value below as **TBD until the business owner sets it** — do not infer
a number from a provider's marketing page.

| Decision                                                            | Status  | Notes                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RPO** (max acceptable data loss)                                  | **TBD** | Supabase's automated backup frequency (tier-dependent — daily on most paid tiers, point-in-time recovery only on higher tiers) sets the _floor_; the business must decide if that floor is acceptable before go-live. |
| **RTO** (max acceptable downtime during a restore)                  | **TBD** | Depends on Supabase support-ticket turnaround for a provider-side restore, or the time to stand up a fresh project and run `db:migrate` + a logical restore, whichever path is chosen (§5).                           |
| **Backup ownership** (who is paged, who holds provider credentials) | **TBD** | Must name a person/role with Supabase + Render + Vercel + Upstash dashboard access before go-live, not "whoever is online."                                                                                           |
| **Retention period** (how far back a restore can reach)             | **TBD** | Set by the Supabase plan tier. Confirm the actual retention window on the plan selected — do not assume Supabase's default free-tier retention is sufficient for a paying customer's expectations.                    |
| **Who may authorize a production restore**                          | **TBD** | A restore can roll back legitimate customer data created after the backup point. This needs an explicit, named approver before an incident, not during one.                                                           |

**Action required before onboarding a paying customer:** fill in this table
with real values from whoever owns the Supabase/Render/Vercel/Upstash
contracts, and confirm the chosen Supabase plan's backup frequency and
retention actually meets the RPO/retention decided above.

## 3. What each provider actually gives you (verify before trusting)

- **Supabase PostgreSQL** — automated backups exist on paid tiers; exact
  frequency and retention are plan-dependent (see Supabase's own pricing page
  for the plan actually purchased — not restated here since it changes
  independently of this repo and this document must not go stale against a
  moving target). Point-in-time recovery (PITR) is a separate, higher-tier
  feature — confirm whether it is enabled; without it, recovery granularity is
  "as of the last automated snapshot," not "as of any second."
- **Supabase Storage** — bucket contents are **not** automatically covered by
  the same backup guarantee as the Postgres database on every tier; confirm
  explicitly in the Supabase dashboard whether Storage objects are included in
  the project's backup/restore scope, or whether a separate export is needed.
  This repository's code treats storage as **derived, re-creatable where
  possible** (tenant logos can be re-uploaded; generated PDFs are never
  persisted — `DEPLOYMENT.md` §"PDF / document generation") but HR employee
  documents and finance/EPC attachments are **not** re-creatable from any
  other source — their loss is permanent if the bucket is lost with no backup.
- **Upstash Redis** — "persistence" (RDB/AOF-equivalent) and backup
  availability are plan-dependent. This platform does not require Redis
  durability for data integrity (see §4), but losing in-flight queue state
  does cause currently-queued notification deliveries to need to be
  re-triggered from Postgres (manual, described in §6).

None of the above has been confirmed against the actual provisioned project
(none was provisioned as of the last verified `DEPLOYMENT.md` audit) — this
is a reading of each provider's documented tier behavior, not a live
observation. **Re-verify every bullet in this section directly in the
Supabase/Upstash dashboard the first time a real project exists, before
relying on it.**

## 4. Why Redis loss never loses business data (verified from code)

- BullMQ queues only **notification delivery** jobs
  (`apps/api/src/notifications/notifications.queue.ts`,
  `notifications.worker.ts`). Each job's durable state is a row in
  `notification_deliveries` (Postgres) — the queue job is a _trigger to
  process that row_, not the row's only copy.
- The outbox pattern (ADR 0013) means every event that would enqueue a
  delivery is first written to Postgres (`outbox_events`), and a Postgres-only
  poller (`startPoller` in `drain-schedule.ts`) re-drains anything undelivered
  on an interval **independent of BullMQ** — so a wiped Redis instance does
  not strand an event permanently; the next poll cycle re-enqueues it.
- Sessions live in Postgres, not Redis (§1).
- Conclusion: Redis is **safe to treat as disposable cache/queue
  infrastructure** for this platform's actual architecture. A fresh, empty
  Upstash database after an incident does not lose tenant data — only
  queued-but-undelivered notifications are delayed until the next outbox
  drain cycle picks them back up, which happens automatically.

## 5. Recovery runbook — PostgreSQL (the only system of record)

**Read this entire section before touching anything.** Never run any step of
this against the live staging/production database as a drill — a restore
drill happens in an isolated recovery environment only (§5.4).

### 5.1 Prerequisites

- Supabase dashboard access (or whoever holds it, per §2's ownership
  decision) with permission to restore a backup or export a logical dump.
- The repository's migration history at the commit actually deployed when the
  incident occurred (`git log -- packages/db/src/migrations` or equivalent;
  confirm via the deployed API's build/commit, not an assumption).
- A place to restore _into_ that is **not** the live project — a new,
  throwaway Supabase project, or a local Postgres instance reachable from a
  machine with this repo checked out.
- `DATABASE_URL` for that isolated target, and `pnpm install` run at the repo
  root (monorepo — `packages/db` must be built; see `DEPLOYMENT.md`).

### 5.2 Ordered recovery steps (isolated environment)

1. **Freeze writes to the source of the restore data**, if restoring from a
   point before an ongoing incident (e.g., pause the API via Render, or at
   minimum confirm no further writes are landing) — otherwise the restore
   target and the live system diverge in a way that complicates reconciling
   them afterward.
2. **Restore the backup into the isolated target** using Supabase's own
   restore mechanism (dashboard-driven point-in-time or snapshot restore) or,
   for a logical-dump-based approach, `pg_restore`/`psql` against the
   isolated target — never against the live project's connection string.
3. **Verify the restored schema's migration state** before trusting the data:
   ```
   DATABASE_URL=<isolated target> pnpm --filter @aivoryx/db db:migrate
   ```
   This is **idempotent and additive-only** (every migration in this
   repository's history is forward-only; `DEPLOYMENT.md` confirms no
   destructive migration exists) — running it against an already-current
   restore is a safe no-op, and running it against a restore from an older
   point brings the schema forward to the current application's expectation
   without touching the restored data rows.
4. **Confirm the `aivoryx_app` role exists and is correctly scoped**
   (`NOSUPERUSER NOBYPASSRLS`, created by migration `0003`) — this is created
   by step 3's migration run if missing, but verify it explicitly:
   ```sql
   select rolname, rolsuper, rolbypassrls from pg_roles where rolname = 'aivoryx_app';
   -- expect: rolsuper = false, rolbypassrls = false
   ```
   A role that is somehow superuser or `BYPASSRLS` after a restore is a
   release-blocking finding — RLS is the last line of tenant isolation
   (ADR 0009/0027) and must never be bypassable by the API's runtime role.
5. **Spin up the application against the isolated target** (API only is
   enough for verification; the web app is optional) with that
   `DATABASE_URL`, and run the verification checks in §5.3 before considering
   the restore usable.
6. **Only after verification**, decide the cutover path for a real incident:
   either point production's `DATABASE_URL` at a _promoted_ version of the
   restored project (Supabase-specific promotion flow — confirm it exists on
   the plan in use), or treat the isolated restore as the new production
   database and repoint Render's environment variable, redeploying the API
   (which re-runs the pre-deploy migration step per `DEPLOYMENT.md`).

### 5.3 Post-restore verification (do not skip)

- `GET /api/v1/health` (readiness route) against the restored instance's API
  returns `{"status":"ok"}` for both `database` and `redis` checks.
- A tenant RLS smoke check: as two different tenant users, confirm each can
  only read their own tenant's data (the existing `test/rls.int.spec.ts`
  suite is the authoritative version of this check — run it against the
  restored database with `RUN_DB_IT=1` before trusting the restore, rather
  than inventing an ad hoc manual check).
- Spot-check that `audit_logs` is still append-only post-restore (`UPDATE`/
  `DELETE` as `aivoryx_app` must still fail with `42501` — migration 0013's
  `REVOKE` is part of the schema, so a correct migration replay preserves it,
  but confirm rather than assume after a provider-side restore mechanism that
  this repository's code did not control).
- Confirm object storage keys referenced by restored rows (e.g. a tenant's
  `tenant_assets.object_key`) still resolve via `ObjectStorageService` — a
  database restored to a point _after_ the storage bucket's own last backup
  (or vice versa) can leave dangling references; this is the reason §1 calls
  out the DB/storage relationship explicitly. There is no automated
  reconciliation job for this today — a manual spot-check across a handful of
  recently-modified tenants is the current mitigation, pending a real restore
  test (§5.4) that would either prove this is a non-issue in practice or
  surface it as a sequencing requirement to document (restore storage first,
  then the DB backup from the same or a later timestamp).

### 5.4 Restore test (required before trusting this document with real data)

A **restore test** is distinct from the drill steps above: it means actually
performing §5.2 against a real Supabase backup of the real staging project,
into a throwaway project, and confirming §5.3 passes. This has **not** been
done as of this writing. Required to perform it:

- Authorization from whoever owns the Supabase billing/project (creating a
  throwaway project may have cost implications depending on plan).
- A maintenance window is **not** required (the test restores into an
  isolated project — the live project is never touched), but the restore test
  should be scheduled and logged (who ran it, when, what was verified) the
  first time, and periodically thereafter (e.g., quarterly, or after any
  schema change that touches RLS policies).

**Never run a real restore against the live staging or production project to
"test" it.** If this document is ever used to justify that, stop — that is a
live-data risk, not a drill.

## 6. Recovery runbook — object storage

1. Confirm whether the Supabase project's own backup covers Storage (§3) —
   if yes, restore via the same provider mechanism as §5, into the same
   isolated target project so DB and storage restore points can be kept
   consistent.
2. If Storage is not covered by the automated backup on the plan in use,
   recovery depends entirely on whatever the uploader can re-supply: tenant
   logos/branding can be re-uploaded by the tenant admin or platform admin
   through the existing UI (no data loss beyond re-upload effort); HR
   documents and finance/EPC attachments uploaded by end users **cannot** be
   regenerated from any other system of record in this platform — their loss
   is permanent without a bucket-level backup. This is the concrete argument
   for enabling whatever Storage backup option the Supabase plan offers,
   rather than relying on tenant goodwill to re-upload irreplaceable
   documents.
3. After any storage restore, re-run the dangling-reference spot-check from
   §5.3 before declaring recovery complete.

## 7. Recovery runbook — queued jobs (Redis / BullMQ)

Per §4, Redis loss does not lose business data. Recovery is simply: bring up
a fresh Upstash database (or wait for Upstash's own recovery if it was a
transient outage), point `REDIS_URL` at it, redeploy/restart the API. The
in-process outbox poller (`NOTIFICATIONS_POLL_MS`, default documented in
`packages/config`) picks up any undelivered `notification_deliveries` rows on
its next cycle with no manual intervention. If verification is wanted: query

```sql
select count(*) from notification_deliveries where status = 'pending';
```

before and after a poll interval has elapsed to confirm the count is
draining, not stuck.

## 8. Returning to service

1. Confirm `GET /api/v1/health/live` returns `200` (process is up) and
   `GET /api/v1/health` returns `200` with both checks `ok` (dependencies
   reachable) **before** routing real traffic back — see
   `OBSERVABILITY.md`/`health.controller.ts` for the exact semantics.
2. Re-run the golden-path Playwright smoke test (`apps/web/e2e/smoke.spec.ts`)
   against the restored environment if practical — it is the existing,
   already-trusted check for "is this environment actually usable," not a
   new invention for this document.
3. Notify whoever owns customer communication (per the incident runbook,
   `INCIDENT-RUNBOOKS.md` §10) with the actual restore point (timestamp) used,
   so any work created between that point and the incident can be identified
   and, where possible, manually reconciled with affected customers.

## 9. Explicit non-goals of this document

- It does not introduce a new backup tool, agent, or provider — every
  mechanism described is the provider's own existing capability (Supabase
  backups/restore, Upstash's own durability settings) or this repository's
  own already-present migration/outbox machinery.
- It does not automate any restore step — every step above is manual,
  deliberately, because an automated destructive-adjacent operation against
  production data needs a human decision gate, not a script.
- It does not perform or schedule a destructive operation of any kind; it
  does not run against staging/production as part of being written.
