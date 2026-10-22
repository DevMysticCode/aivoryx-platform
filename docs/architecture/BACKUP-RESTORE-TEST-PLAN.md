# Backup & Recovery — Evidence Audit and Isolated Restore-Test Plan

Status: **audit and plan only — no restore has been executed.** This document
is the companion to `BACKUP-RECOVERY.md` (the general strategy document) and
exists to do two things precisely: (1) separate what is actually verified
about the live staging environment from what is historical/assumed, and
(2) propose a restore test that can be run in an isolated environment without
ever touching staging or production. Nothing in this document authorizes
running that test — it is a plan awaiting approval (§4).

## 1. What was actually verified for this document, and how

A live, read-only, unauthenticated HTTPS check was made against the
previously-reported staging URLs. This is **application-layer reachability
evidence**, not provider-dashboard evidence — it proves the services respond
right now; it proves nothing about backup configuration, retention, access
control, or MFA on any underlying provider project.

Checked **2026-10-22, ~11:04 UTC** (timestamp from the frontend response's own
`Date` header, not asserted from memory):

| Check                                           | Result                                                                                                                                                                            |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET https://aivoryx-platform-web.vercel.app/`  | `200 OK`, `Server: Vercel`, Next.js prerendered page served                                                                                                                       |
| `GET .../api/v1/health/live` (Render API)       | `200 OK`, `{"status":"ok","uptimeSeconds":47}` — note the low uptime: the process had just cold-started, consistent with an idle-tier service spinning down and waking on request |
| `GET .../api/v1/health` (Render API, readiness) | `200 OK`, `{"status":"ok","checks":{"database":{"status":"ok","latencyMs":30,"detail":"connectivity+uuidv7 ok"},"redis":{"status":"ok","latencyMs":1,"detail":null}}}`            |

No secret, credential, connection string, or customer data was requested,
returned, or recorded anywhere above or in this document — these are the
same public, unauthenticated health routes `health.controller.ts` exposes
with `@Public()` specifically so they can be checked without a session.

**Conclusion from this evidence alone:** the Vercel frontend, Render API,
Supabase PostgreSQL, and Upstash Redis described in `DEPLOYMENT.md` are, as of
the timestamp above, live and reachable. The Render API's very low uptime at
check time is worth carrying into any real RTO discussion: if the production
tier behaves the same way (spins down when idle, cold-starts on the next
request), that cold-start latency is part of the real "time to serve the
first request after an incident," not just the restore time itself —
flagged as a question for whoever owns the Render plan, not assumed either
way here.

## 2. Provider-by-provider evidence table

Every row below is explicitly one of: **Confirmed by repository evidence**,
**Confirmed by live, unauthenticated check (§1)**, **Reported historically,
not currently re-verified**, or **Unknown / blocked — needs dashboard
access**. Nothing is marked confirmed without a stated source.

| Area                                                         | Vercel (web)                                                                                        | Render (API)                                                                                                                   | Supabase (Postgres + Storage)                                                                                                                                                                                                  | Upstash (Redis)                                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **Resource reachable right now**                             | **Confirmed, live check (§1)**                                                                      | **Confirmed, live check (§1)**                                                                                                 | **Confirmed indirectly** — the API's readiness check reports `database: ok` with real latency, meaning the API's configured `DATABASE_URL` resolved and answered                                                               | **Confirmed indirectly** — same readiness check reports `redis: ok`                  |
| **Resource identity (project name/ref, region, org)**        | Unknown / blocked                                                                                   | Unknown / blocked                                                                                                              | Unknown / blocked                                                                                                                                                                                                              | Unknown / blocked                                                                    |
| **Who owns/administers the project**                         | Unknown / blocked — this is §2's named decision, not yet made (`BACKUP-RECOVERY.md` §2)             |                                                                                                                                |                                                                                                                                                                                                                                |                                                                                      |
| **Database/Redis endpoint**                                  | n/a                                                                                                 | n/a — confirmed only that the API's own configured connection works; the endpoint itself is never exposed by any route checked | Unknown / blocked — repository code never logs or exposes `DATABASE_URL`                                                                                                                                                       | Unknown / blocked — same, `REDIS_URL` is never exposed by any route                  |
| **Backup/PITR availability on the actual plan**              | n/a                                                                                                 | n/a (no database here)                                                                                                         | Unknown / blocked — plan-tier dependent, not inspectable from outside the dashboard                                                                                                                                            | Unknown / blocked                                                                    |
| **Backup frequency / latest successful backup time**         | n/a                                                                                                 | n/a                                                                                                                            | Unknown / blocked                                                                                                                                                                                                              | Unknown / blocked                                                                    |
| **Retention policy, deletion behavior**                      | n/a (Vercel's own deployment history serves as its "rollback" window, not a backup in the DB sense) | n/a                                                                                                                            | Unknown / blocked                                                                                                                                                                                                              | Unknown / blocked                                                                    |
| **Restore capability — tested?**                             | n/a — Vercel rollback is instant and separate from this concern                                     | n/a                                                                                                                            | **Not tested** (§3 below, `BACKUP-RECOVERY.md` §5.4) — this is the central unresolved question this document exists to plan for                                                                                                | Not tested; low stakes per `BACKUP-RECOVERY.md` §4 (Redis holds no system of record) |
| **Regional-failure limitations**                             | Unknown / blocked                                                                                   | Unknown / blocked                                                                                                              | Unknown / blocked                                                                                                                                                                                                              | Unknown / blocked                                                                    |
| **Access control / MFA posture on the provider account**     | Unknown / blocked                                                                                   | Unknown / blocked                                                                                                              | Unknown / blocked                                                                                                                                                                                                              | Unknown / blocked                                                                    |
| **Alerting on failed backups / exhausted retention/storage** | n/a                                                                                                 | n/a                                                                                                                            | Unknown / blocked — and, per `INCIDENT-RUNBOOKS.md` §5, **no external alerting provider is wired into this codebase at all**, so even if the provider itself alerts, nothing in this repo currently relays that alert anywhere | Unknown / blocked                                                                    |
| **Estimated RPO**                                            | n/a                                                                                                 | n/a                                                                                                                            | **TBD** — explicitly not inferred (`BACKUP-RECOVERY.md` §2)                                                                                                                                                                    | n/a — not a system of record (§4 there)                                              |
| **Estimated RTO**                                            | Low — Vercel's own instant rollback                                                                 | Unknown / blocked — depends on cold-start behavior (§1) plus whatever the real incident is                                     | **TBD** — depends on Supabase's actual restore mechanism and plan tier, neither inspectable from here                                                                                                                          | n/a                                                                                  |

**The exact evidence a human operator needs to collect**, to turn every
"Unknown / blocked" row above into a real answer, in one pass per provider:

- **Supabase:** Project Settings → General (project ref/region/org) →
  Database → Backups (frequency, retention window, PITR availability and
  window if enabled) → Storage (whether bucket contents are included in the
  same backup scope — `BACKUP-RECOVERY.md` §3 already flags this as
  plan-dependent and not assumable) → Authentication/Team (who has access,
  whether MFA is enforced on the organization).
- **Upstash:** Database details page (region, plan) → persistence/durability
  setting for the plan → whether any backup/export feature is offered on
  that plan, and whether it's enabled.
- **Render:** Service settings (region, plan/tier — specifically whether this
  is an auto-sleeping free/starter tier, which §1's low uptime reading is
  consistent with) → environment group / env vars (confirm `DATABASE_URL`
  points at the direct, non-pooled Supabase connection string per
  `DEPLOYMENT.md`'s release-blocking requirement — this can be confirmed by
  an operator with dashboard access without ever printing the value) → who
  has deploy access.
- **Vercel:** Project settings (production domain mapping, confirm
  `NEXT_PUBLIC_API_PROXY`/`API_PROXY_TARGET` are set per `DEPLOYMENT.md`'s
  same-origin-proxy requirement) → who has deploy access.

None of this requires exposing a single secret value — every item above is a
_setting_, not a credential, and can be read and reported back as a yes/no or
a plain value (region name, plan tier, retention days) without ever quoting a
connection string, key, or password.

## 3. Database and external-storage recovery findings (code-level audit)

Verified by reading the actual code and migration files, not assumed:

- **PostgreSQL version / extensions:** no `CREATE EXTENSION` statement exists
  anywhere in the 28 migration files (`packages/db/drizzle/*.sql`) — UUIDv7
  generation happens in application code (the `uuidv7` npm package,
  `packages/db/src/id.ts`), not a Postgres extension. This means a restore
  target has **no extension-provisioning prerequisite** beyond whatever
  Supabase's base image already includes — one less thing that can silently
  fail during a restore.
- **Migration location/command:** `packages/db/drizzle/` (28 files),
  `pnpm --filter @aivoryx/db db:migrate` (`src/migrate.ts`, using
  `drizzle-orm/node-postgres/migrator`, a single-connection pool
  (`poolMax: 1`) — deliberately serial, not parallel).
- **Forward-only in practice:** confirmed by `grep` across every migration
  file for `DROP TABLE`, `DROP COLUMN`, `DROP TYPE` — zero matches. This
  matches `DEPLOYMENT.md`'s own claim; re-verified independently here rather
  than re-stating it on trust.
- **Migration execution vs. application startup:** confirmed **separated** —
  `apps/api/src/main.ts` never calls `runMigrations()` or anything in
  `migrate.ts`; a `grep` for any caller of that function outside the script's
  own CLI entry point and its own test returns nothing. Migrations only run
  when `db:migrate` is explicitly invoked (locally, or as Render's
  documented Pre-Deploy Command).
- **Concurrent migration risk from worker processes:** there is **no separate
  worker deployment** in this architecture — the notification worker
  (`NotificationsWorker`) runs in-process inside the same API Nest
  application, not as a second deployable process. There is therefore no
  second process that could race a migration run; the only concurrency risk
  this platform's own test suite had to guard against was `packages/db`'s
  _own_ destructive integration tests racing `apps/api`'s integration tests
  against a shared database in CI (already solved — separate disposable DB
  in CI, documented in `DEPLOYMENT.md`'s CI/CD section).
- **Does a database backup include all application-critical data?** No —
  **by design**. Object storage (Supabase Storage, S3-compatible) holds
  tenant logos/branding assets, platform branding assets, HR employee
  documents, and finance/EPC attachments; these are referenced from Postgres
  rows by `object_key` but are not _in_ Postgres. A Postgres-only restore
  leaves these references pointing at whatever currently exists in the
  bucket — if the bucket's own backup point differs from the database's
  restore point, some rows will reference objects that don’t exist (if the
  bucket is "behind" the DB) or the bucket will hold orphaned objects no row
  references (if the bucket is "ahead"). Neither case is automatically
  detected today — `BACKUP-RECOVERY.md` §5.3 already calls this out as a
  manual spot-check, carried forward here as the single most important
  cross-system consistency risk in this platform's recovery story.
- **Queues/scheduled jobs:** already traced in `BACKUP-RECOVERY.md` §4 — no
  change to that finding. BullMQ (Upstash Redis) holds no system of record;
  the outbox pattern (Postgres) re-drains anything undelivered after Redis
  comes back, including after a fresh/empty Redis following a restore.
- **Sessions and revocation records:** sessions are Postgres rows
  (`sessions` table, `revoked_at` soft-revoke — confirmed in
  `INCIDENT-RUNBOOKS.md` §6's investigation this same milestone). A database
  restore to a point _before_ a user's logout or a security-driven
  `revokeAllForUser` call would **resurrect that session** — i.e., restoring
  the database can un-revoke a session that was correctly revoked after the
  backup point. This is a genuine, previously-undocumented recovery
  implication, surfaced here for the first time: **any restore must be
  followed by a deliberate decision about whether to re-revoke sessions that
  were revoked after the restore point**, not an assumption that the
  restored state is simply "the truth."
- **Encryption keys / integration credentials:** `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`
  is an environment variable (Render), not a database row — it is **not**
  included in any Postgres backup and must be present, unchanged, in the
  restored/recovery environment's own configuration for already-encrypted
  connector-credential rows in a restored database to remain decryptable.
  Restoring a database into an environment with a _different_
  `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY` value makes every stored connector
  credential permanently undecryptable — the same irreversible-rotation risk
  already documented in `INCIDENT-RUNBOOKS.md` §8, now stated as a restore
  precondition: **the recovery environment's encryption key must match the
  source database's key, or every connector credential is lost regardless of
  whether the restore itself "succeeded."**
- **Tenant isolation during a restore:** RLS policies and the `aivoryx_app`
  role are schema-level (created by migration `0003`, enforced by every
  migration since) — a correct migration replay against a restored database
  recreates them exactly as they exist in production, _if_ the restore
  process doesn't bypass or alter them. `BACKUP-RECOVERY.md` §5.2 step 4
  already requires explicitly verifying `aivoryx_app` is `NOSUPERUSER
NOBYPASSRLS` after any restore rather than assuming it; this finding
  doesn't change, it's re-confirmed as still the right check.
- **Is a database snapshot application-consistent?** Not assumed here either
  way — Supabase's snapshot mechanism and its consistency guarantees are
  provider-internal and not inspectable from this repository. This is
  explicitly listed as an "Unknown / blocked" item for whoever has Supabase
  dashboard/support access to confirm (their own documentation for the
  specific backup mechanism in use — physical snapshot vs. logical dump —
  determines this, and it is plan/mechanism-specific).

## 4. Proposed isolated restore-test plan (NOT executed — awaiting approval)

This plan is designed so that **no step can affect staging or production**,
by construction: every destination is a resource created fresh for the test
and discarded afterward, and every external side-effect channel is disabled
before the restored application is ever started.

### 4.1 Preconditions and approvals required

- [ ] A named approver for this specific test (per `BACKUP-RECOVERY.md` §2's
      ownership decision — this should not be a different, ad hoc decision
      each time).
- [ ] Confirmed billing/authorization to create one throwaway Supabase
      project (and, if desired, one throwaway Upstash database) for the
      duration of the test only.
- [ ] A time window during which the approver and whoever runs the test are
      both available, in case the test surfaces something that needs a
      same-day decision (e.g., a restore that fails outright).
- [ ] This plan itself reviewed and approved — this document is the approval
      artifact; execution should not begin from a verbal "go ahead" alone.

### 4.2 Isolated target

- A **new, throwaway Supabase project**, created specifically for this test,
  in the same region as staging if known (otherwise, region is not
  restore-correctness-relevant — only latency). Never the existing staging
  or production Supabase project.
- A **new, throwaway Upstash database** if the test wants to exercise the
  "Redis also recovers" path end to end — not required for the core
  Postgres-restore test, since §3 above already establishes Redis holds no
  system of record; a fresh empty Upstash database (not even restored from
  anything) is sufficient and simpler.
- Neither throwaway resource is ever pointed at by staging's or production's
  own Render/Vercel services — the test runs its own, separate, temporary API
  process (a developer's machine, or a throwaway Render service, is enough;
  it does not need to be publicly reachable).

### 4.3 Selecting the source backup/recovery point

- The exact backup or PITR timestamp to restore from must be **identified
  and its identity/timestamp confirmed in the Supabase dashboard before the
  restore starts** — never "the most recent one, whatever that is" without
  looking. Record the exact timestamp chosen in the test's evidence log
  (§4.12).
- Prefer the **most recent available** backup for a routine restore-test
  (the goal is proving the mechanism works, not reconstructing a specific
  historical state) unless the test's purpose is specifically to validate a
  point-in-time recovery to an arbitrary timestamp.

### 4.4 Preventing external side effects from the restored environment

Before the restored application is started against the recovery target, in
this order:

1. Set `NOTIFICATIONS_ENABLED=false` in the test environment's configuration
   — this is an existing, real environment variable
   (`notifications.worker.ts` checks it and the worker simply never starts
   if it's false) — not a new flag invented for this plan. This prevents any
   real email/notification from being sent from the restored data.
2. Point `REDIS_URL` at the fresh, empty throwaway Upstash database (§4.2),
   never at staging's or production's Redis — this also means no stale
   BullMQ job in a restored Redis could fire (there is none, since it's
   fresh) and no real queue is shared.
3. Confirm no outbound webhook/connector credentials in the restored data
   are live-callable from the test environment: this platform's connectors
   call _out_ to third parties (Meta, Google, etc.) only when a tenant's own
   integration flow is actively exercised through the UI/API — simply
   booting the application and running health/RLS checks does not trigger
   any of that. If the test plan is extended to exercise integration flows,
   each connector's credential should be revoked/rotated on the _third-party_
   side first, or the test should use test-only connector credentials — not
   attempted in this initial plan.
4. Do not configure `OBJECT_STORAGE_*` to point at the live staging/production
   bucket — either point at a fresh, empty throwaway bucket (accepting that
   §3's cross-system consistency check will show every referenced object as
   missing, which is itself useful information) or skip the storage-specific
   checks in this pass and note them as not covered.

### 4.5 Preventing access to production credentials/services

- The test environment's `.env` (or Render/local env) is populated **only**
  with the throwaway project's own connection strings and a throwaway
  `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`/`SESSION_SECRET` — never copied from
  staging's or production's real values. (Using a _different_ encryption key
  than the source database's real key means, per §3's finding, that restored
  connector-credential rows will show as present but undecryptable — an
  acceptable, expected limitation for a mechanism test; if credential
  decryption specifically needs testing, that requires explicit, separate
  authorization to use the real key value in a controlled way, not a default
  assumption here.)
- `CORS_ALLOWED_ORIGINS` and any API-proxy variables point only at the test's
  own temporary frontend/API pair, if a frontend is stood up at all (optional
  for this plan — most checks below only need the API).

### 4.6 Applying/verifying migrations without touching the source

- Run `DATABASE_URL=<throwaway target> pnpm --filter @aivoryx/db db:migrate`
  against the **restored throwaway database only**. This is the same command
  used in normal releases — no new tooling — and is additive/idempotent per
  §3's independently-reconfirmed finding, so it is safe to run even if the
  restore already matches the current schema.
- The source (staging/production) database is never connected to by this
  step or any other step in this plan.

### 4.7 Data-integrity and application-startup checks

- API process starts cleanly against the throwaway target (env schema
  validation passes — confirms the throwaway config is complete).
- `GET /api/v1/health/live` → `200`.
- `GET /api/v1/health` → `200`, both `database` and `redis` checks `ok`.
- Spot-check row counts on a handful of core tables (`tenants`,
  `user_tenant_memberships`, `audit_logs`) are non-zero and roughly consistent
  with what's expected from the backup's timestamp.

### 4.8 Tenant-isolation checks

- Run `test/rls.int.spec.ts` (`RUN_DB_IT=1`) against the throwaway target —
  this is the existing, already-trusted suite, not a new ad hoc check. A
  failure here is release-blocking for trusting the restore mechanism at all.
- Manually confirm, via two different tenant logins (seeded or restored real
  tenants), that each sees only their own data through at least one list
  endpoint — a second, applied confirmation on top of the automated suite.

### 4.9 Document/object-storage consistency (where exercised, §4.4 item 4)

- If a storage target was configured: for a sample of tenants with branding
  assets or HR documents, confirm the referenced `object_key` resolves via
  `ObjectStorageService`. Record the pass/fail rate — do not extrapolate a
  100%-consistent conclusion from a small sample; report exactly what was
  checked and what wasn't.
- If storage was intentionally not exercised this pass: record that
  explicitly as "not covered," not as "verified."

### 4.10 Session, audit-log, and credential-handling checks

- Confirm `audit_logs` is still append-only post-restore: as `aivoryx_app`,
  attempt `UPDATE`/`DELETE` against a restored row and confirm both fail with
  `42501` (the existing RLS/grant behavior, re-confirmed rather than assumed
  after a provider-side restore mechanism this codebase's own migrations did
  not directly control).
- Confirm sessions with `revoked_at` set **before** the backup's timestamp
  are still rejected by `SessionService.resolve()` (expected — they're in the
  backup as revoked). Explicitly note, per §3's new finding, whether any
  session revoked **after** the backup's timestamp and therefore "un-revoked"
  by the restore is found — this is expected behavior for the mechanism test,
  not a bug, but must be reported so a real incident's post-restore runbook
  accounts for it (re-revoke anything revoked after the chosen restore
  point).
- Confirm connector credentials behave exactly as §3/§4.5 predicted given
  whichever encryption key was configured for the test.

### 4.11 Timing measurements

Record wall-clock time for each phase separately (not just a single total):
backup/recovery-point identification, Supabase-side restore completion,
migration-verification run (§4.6), and application-level validation (§4.7–
§4.10). This is the raw data an RTO decision will eventually be built from —
report it, do not convert it into an RTO recommendation yourself (that's a
business decision per `BACKUP-RECOVERY.md` §2).

### 4.12 Cleanup and evidence retention

- Tear down the throwaway Supabase project and Upstash database after the
  test completes (or keep them only as long as genuinely needed for
  follow-up investigation, with an explicit decision to do so, not by
  default).
- Retain: the exact backup/recovery-point identifier and timestamp used, the
  timing measurements (§4.11), the pass/fail result of each check in §4.7–
  §4.10, and who performed the test and when. Do **not** retain: real
  customer data exports, screenshots containing tenant data, or any secret
  value used to configure the throwaway environment.

## 5. Pass/fail criteria (objective, no invented targets)

| Criterion                                | Pass                                                                                            | Fail                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Backup identity confirmed before restore | Exact timestamp/identifier recorded before the restore starts                                   | Restore started without confirming which backup was used                             |
| Database restoration                     | Restore completes without provider-reported error                                               | Any provider-reported error during restore                                           |
| Migration compatibility                  | `db:migrate` completes with no error against the restored schema                                | Migration fails or requires manual intervention                                      |
| Application startup                      | API boots, env validation passes                                                                | Boot fails for any reason                                                            |
| Health endpoints                         | Both `/health/live` and `/health` return `200` with all checks `ok`                             | Either returns non-200 or a non-`ok` check                                           |
| Tenant isolation                         | `rls.int.spec.ts` passes in full; manual two-tenant check confirms isolation                    | Any RLS test failure or any cross-tenant visibility observed                         |
| Data integrity / relationships           | Spot-checked tables have plausible row counts; no FK-constraint errors surface                  | Implausible counts (e.g., zero rows) or constraint violations                        |
| Document/object availability             | Sampled objects resolve, or storage was explicitly marked "not covered"                         | Objects expected to resolve don't, and this wasn't already a known/explained outcome |
| Audit log availability and immutability  | Historical rows present; `UPDATE`/`DELETE` still rejected (`42501`)                             | Rows missing unexpectedly, or a mutation succeeds                                    |
| Queue/worker safety                      | No real external side effect (email, webhook, live job) observed                                | Any real external side effect observed                                               |
| Secret/credential isolation              | No staging/production secret value ever appears in the test environment, logs, or this document | Any such value appears anywhere                                                      |
| Recovery time measured                   | Each phase's timing recorded per §4.11                                                          | Timing not recorded, or only a single aggregate number with no breakdown             |

**RPO and RTO remain explicitly TBD.** This test, even if fully passed,
produces _measured_ restore/validation timings (§4.11) — it does not, by
itself, establish an RPO or RTO target. Those are business decisions
(`BACKUP-RECOVERY.md` §2) that should be informed by this test's measured
numbers, not replaced by them. **A fully passing restore test is evidence
that the recovery mechanism works — it is not, on its own, proof that the
platform meets any disaster-recovery commitment that hasn't been explicitly
set.**

## 6. Human decisions and access still required

1. Named approver for an actual restore-test execution (§4.1).
2. Supabase/Upstash/Render/Vercel dashboard access for whoever will fill in
   every "Unknown / blocked" row in §2's evidence table.
3. Confirmation of Render's actual plan tier (whether the cold-start behavior
   observed in §1 is expected/acceptable for production, or whether a
   higher, always-on tier is needed before go-live).
4. Billing authorization for one throwaway Supabase project (and optionally
   one throwaway Upstash database) for the test itself.
5. A decision on whether to also exercise the connector-credential
   decryption path (§4.5) with real keys in a controlled way, or to leave
   that explicitly out of scope for the first restore test.
6. The RPO/RTO decisions from `BACKUP-RECOVERY.md` §2, ideally informed by
   this test's eventual timing results (§4.11) rather than decided blind.

## 7. Recommendation

The plan in §4 is, by construction, safe to approve for execution — every
step targets a disposable resource, every external side-effect channel is
disabled before the restored application starts, and the source
staging/production environment is never written to or even connected to by
any step. **It has not been executed.** Recommend: get the named-approver
decision (§4.1 / §6.1) and the throwaway-project billing authorization
(§4.1 / §6.4), then schedule the test. No code or provider-configuration
change is required to proceed — this is purely a scheduling and authorization
gate at this point, not an engineering blocker.
