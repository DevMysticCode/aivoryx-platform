# Release & Incident Runbooks

Status: first version — Production Operations & Customer Launch Readiness
milestone. Every step below is grounded in this repository's actual code,
scripts and environment variables as of this writing (`docs/architecture/
DEPLOYMENT.md`, `docs/architecture/AUDIT.md`, `docs/architecture/
OBSERVABILITY.md`). Where a capability does not exist yet, this document says
so explicitly rather than describing a procedure that would fail in a real
incident. No secrets or real infrastructure values appear anywhere below.

## 1. Pre-release verification

Run before merging to `main` and before deploying:

1. `pnpm format:check && pnpm typecheck && pnpm lint && pnpm build` — all four
   must be clean (CLAUDE.md §16/§18).
2. `RUN_DB_IT=1 DATABASE_URL=<integration DB> REDIS_URL=<local redis> pnpm --filter @aivoryx/api test` —
   the full unit + integration suite, against real Postgres/Redis (never
   mocked for integration specs).
3. `pnpm --filter @aivoryx/web test` — web unit suite.
4. Any Playwright suite touched by the change (`apps/web/e2e/*.spec.ts`) —
   most are opt-in (`RUN_<NAME>_E2E=1` + credentials); run the ones relevant
   to the change, and at minimum `smoke.spec.ts` against a real running
   API+web pair.
5. Confirm the OpenAPI contract is regenerated if any DTO/route changed
   (`pnpm --filter @aivoryx/api run openapi:extract` then
   `pnpm --filter @aivoryx/contracts run generate`) and that the diff is
   reviewed, not just regenerated and forgotten.
6. Confirm no new environment variable was introduced without a corresponding
   entry in `packages/config/src/server-env.ts`/`web-env.ts` (the Zod schema
   that makes the process **refuse to start** on a missing var — a missing
   schema entry means a real deploy fails at boot with a clear error, which is
   actually the safe failure mode; this step is about catching it in review,
   not about that failure mode being unsafe).
7. Confirm `git diff` contains no secret-shaped string (the CI
   `gitleaks` job is the backstop, not the only check — review before it runs).

## 2. Database migration and deployment sequencing

**Hard rule, unconditional:** `pnpm --filter @aivoryx/db db:migrate` must
complete successfully **before** the new API version receives any traffic.
Migration `0003` creates the `aivoryx_app` role the API's connection pool
`SET ROLE`s into on every physical connection — if the API starts against a
database that hasn't run this migration yet, every query fails closed
(`DEPLOYMENT.md` §"Database migration order"). This is a feature, not a bug:
it is strictly safer than a role that silently doesn't exist and somehow lets
queries through unscoped.

Recommended sequencing (Render):

1. Run migrations as Render's **Pre-Deploy Command** on the API service, so
   it is part of the same deploy and uses the same `DATABASE_URL` as the
   instance about to receive traffic — never run migrations from a
   developer's laptop against a shared environment.
2. Only after the pre-deploy command succeeds does Render start routing
   traffic to the new instance.
3. Every migration in this repository's history is **forward-only and
   additive** — confirmed no destructive migration exists
   (`DEPLOYMENT.md`). This means step 1 is safe to re-run (idempotent) and
   there is no "undo migration" command to reach for in step 4 of a rollback
   (§3) — a schema rollback, if ever needed, is a new forward migration that
   reverses the effect, written and reviewed like any other change, not an
   automatic down-migration.
4. Web (Vercel) deploys independently and has no migration step — API and web
   are not required to deploy in lockstep _unless_ a change alters the API
   contract in a way the currently-deployed web build does not yet handle
   (coordinate those specific releases manually; this is a process
   discipline, not something the tooling enforces today).

## 3. Rollback decision-making and limitations

- **Web (Vercel):** instant rollback to a previous deployment via Vercel's
  own dashboard/CLI. Low risk, no data implications — the web app holds no
  state of its own beyond the session cookie it reads from the API.
- **API (Render):** "redeploy a previous deploy" via Render's dashboard.
  Safe **only if** the previous deploy's expected schema is still what the
  database currently has. Because migrations are forward-only, rolling the
  **API** back after a migration has already run forward means the old code
  is now running against a _newer_ schema than it was written for.
  - If the migration was purely additive (new column with a default, new
    table) — rolling the API back is normally safe; old code simply doesn't
    use the new column/table.
  - If the migration changed the _meaning_ of existing data the old code
    reads (rare in this codebase's history, but not structurally
    impossible for a future migration) — rolling back the API code without
    a compensating migration can reintroduce the bug the forward migration
    fixed, or worse, write data the new schema no longer expects correctly.
    **Decide this case by case, by reading the specific migration that ran**,
    not by a blanket "rollback is always safe" assumption.
- **Database:** there is no rollback mechanism beyond a full restore from
  backup (`BACKUP-RECOVERY.md`) — treat a bad migration as a forward-fix
  problem (write and deploy a new migration that corrects it), not a
  rollback problem, except in the most severe cases where a restore is
  genuinely warranted (data corruption, not just a bug).

## 4. API and frontend health verification

- `GET /api/v1/health/live` — liveness only (process up, no dependency
  checks). Use this as the infrastructure's own restart-loop health check
  (Render), **never** the deeper check, so a transient Supabase/Upstash blip
  never triggers an unnecessary restart.
- `GET /api/v1/health` (no `/live`) — readiness: checks database connectivity
  (`checkDatabaseHealth`, confirms `uuidv7()` works, not just a bare
  connection) and Redis (`PING`). Returns HTTP `503` if either dependency is
  unreachable, `200` otherwise, and always includes a `correlationId` for
  support reference. Use this for manual verification after a deploy or
  incident — do not wire it as the platform's own restart trigger (that would
  make the API's own liveness depend on every external dependency, which
  `OBSERVABILITY.md`/this document both explicitly avoid).
- Frontend has no separate `/health` route — Vercel's own deploy health check
  (build success) is the only automated signal; a manual check is loading the
  actual app and confirming `GET /api/v1/auth/me` round-trips the session
  cookie correctly (the login page itself already performs this check before
  navigating away — `DEPLOYMENT.md` §"Same-origin API proxy").
- Both checks return a `correlationId` — quote it when escalating (§10).

## 5. Diagnosing database, Redis, storage and queue failures

| Symptom                                                     | First check                                                                                                                                                      | Likely cause                                                                                                                                                                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/health` returns 503, `database.status = error` | `database.detail` field in the response (safe error text, no credentials)                                                                                        | Supabase connectivity, wrong `DATABASE_URL`, exhausted connection pool, or — if seen only right after a deploy — migrations not yet run (§2)                                                                                      |
| `GET /api/v1/health` returns 503, `redis.status = error`    | `redis.detail`                                                                                                                                                   | Upstash connectivity or wrong `REDIS_URL` scheme (`DEPLOYMENT.md` requires `rediss://`, the TCP protocol, never Upstash's separate REST API URL)                                                                                  |
| Uploads/downloads failing, health check otherwise green     | API logs for `[S3ObjectStorage]` entries (structured, includes `operation`, `provider`, `correlationId`, and the real error — never a credential)                | Object storage health is **not** part of the readiness check by design (it is not needed to serve most traffic) — check logs directly, not `/health`                                                                              |
| Notifications not being delivered                           | `select count(*), status from notification_deliveries group by status;` and the API logs for `NotificationsWorker` warnings (`job ... failed: ...`)              | Outbox drain stalled, email provider misconfigured (`EMAIL_PROVIDER`), or Redis unavailable — see §4 of `BACKUP-RECOVERY.md`: a Redis outage alone does not lose the underlying rows, it only delays delivery until the next poll |
| General 5xx spike                                           | `AllExceptionsFilter`'s log line (`Unhandled: <code>`) — every unhandled exception is logged with the real cause server-side and a stable `code` in the response | Varies — the error code narrows it; `INTERNAL_ERROR` with no further code means an unclassified exception, read the logged `err` for the real stack                                                                               |

**No external error-monitoring/alerting provider (e.g. Sentry, Datadog) is
wired into this codebase as of this writing.** Diagnosis today means reading
structured Pino logs at the host (Render's log stream) directly — there is no
dashboard, no automatic paging, and no aggregated error-rate signal beyond
what a human watching logs or manually polling `/health` would notice. This is
a genuine gap, not a style choice; closing it is a provider-selection decision
for the business (which service, whose budget, whose on-call rotation reads
its alerts) and is called out as a blocker in the milestone's completion
report rather than guessed at here.

## 6. Session and authentication incidents

- Sessions are **soft-revoked**, not deleted: `sessions.revoked_at` is set and
  `SessionService.resolve()` rejects any session with a non-null
  `revoked_at` (`AUTH_SESSION_REVOKED`) — this is the existing, tested
  pattern (`session.service.ts`), and incident response should reuse it
  rather than inventing a `DELETE`, which would lose the row's history.
- `SessionService.revokeAllForUser(userId)` already exists and is exactly
  "revoke every live session for one user" — but it is currently only called
  internally (password reset / account lock in `auth.service.ts`), **not
  exposed through any admin-facing API route**. For a single compromised
  _user_ discovered during an incident, this is the correct underlying
  operation; today it requires either a direct, reviewed SQL statement using
  the same shape the real method already uses —
  `update sessions set revoked_at = now() where user_id = '<id>' and revoked_at is null;`
  — or a follow-up to add an admin route that calls the existing method.
  **Prefer adding that route over improvising raw SQL under incident
  pressure once there is time to do it properly.**
- For a suspected **mass** session-store compromise (not one user), the same
  pattern applied platform-wide:
  `update sessions set revoked_at = now() where revoked_at is null;`
  — logs out every active session everywhere. There is no admin API route
  for this either; it is a direct, reviewed database statement run by someone
  with that access, as an explicit, logged incident action — not a routine
  one.
- **`SESSION_SECRET` has been removed** (this milestone) — it was required by
  the environment schema but never actually consumed anywhere in the session-
  token lifecycle (`apps/api/src/auth/session-token.ts`: a session token is a
  256-bit opaque random value, and the database stores only its SHA-256 hash,
  `sessions.token_hash`; there was no HMAC or signature involving
  `SESSION_SECRET` anywhere). A fresh deployment no longer needs to set it; an
  existing deployment that still has it set in Render/Vercel's env panel is
  unaffected (the schema simply ignores an unrecognized variable) and can
  remove it at leisure. It was never a usable incident-response lever —
  rotating it never invalidated anything, before or after this change.
- A login that returns a successful (`2xx`) response immediately followed by
  an unauthenticated `401` on the very next request is the documented
  cross-origin-cookie symptom in `DEPLOYMENT.md` §"Same-origin API proxy" —
  check the proxy/CORS configuration before assuming an auth-logic bug.
- **Credential-stuffing / brute-force containment (added this milestone):**
  `/auth/login` is throttled per attempted email (`LOGIN_RATE_LIMIT_MAX`/
  `LOGIN_RATE_LIMIT_WINDOW_SECONDS`, default 10 attempts / 60s — the same
  in-process token-bucket mechanism already used for inbound webhooks). A
  spike of `429 RATE_LIMITED` responses on `/auth/login` for one email is the
  expected, working signal of an attack against that account, not a bug —
  the account itself is never locked beyond the rolling window, so no manual
  unlock step exists or is needed. If an attack is spread across many
  different emails (so per-email throttling doesn't concentrate it), that is
  a volumetric pattern this in-process limiter cannot see across replicas or
  stop on its own — treat it as a signal to escalate to whatever sits in
  front of the API (Render/Cloudflare) rather than something to "fix" here.
  **The inverse is also a known, accepted tradeoff, not a bug to chase:**
  because the limiter's key is the attacker-supplied email, anyone who knows
  one victim's address can keep that single account perpetually throttled
  (one well-timed request every `windowSeconds/capacity` seconds holds the
  bucket at empty indefinitely) — a narrow, single-account denial-of-service
  that never touches any other account and self-heals the moment the
  attacker stops. If a _specific_ user reports they can never log in, check
  whether their own bucket is being kept empty by someone else before
  assuming an application bug.

## 7. Tenant-isolation or authorization incidents

This is the most severe class of incident this platform can have — treat any
credible report of one tenant seeing another tenant's data as a stop-the-line
event, not a normal bug ticket.

1. **Do not attempt to "quietly patch" a suspected RLS/authorization bypass
   in production first.** Reproduce it in a non-production environment using
   the existing RLS/authorization test suites
   (`test/rls.int.spec.ts`, `test/platform.int.spec.ts`,
   `test/access.int.spec.ts`) as the starting point — if the suspected bypass
   doesn't already have a failing test, write one that reproduces it before
   writing the fix, so the fix is provably correct and the regression is
   permanently covered.
2. Identify the exact access path: was it a platform-admin route (`@PlatformAdmin()`,
   which runs with no tenant bound — `withUserContext`, relying on the
   additive `*_platform_read` RLS policies), a tenant-scoped route that failed
   to bind `app.tenant_id` correctly, or a role/permission-set
   misconfiguration (`AccessService`)? The three have different root causes
   and different fixes.
3. Once root-caused and fixed, **audit the blast radius**: query `audit_logs`
   and, if business data was actually read or written across the tenant
   boundary, identify exactly which rows, which tenants, and whether the
   affected tenant(s) need to be notified. Do not guess at scope — query for
   it.
4. This is the one incident class where proactively notifying the affected
   customer(s) is very likely the right call even before every detail is
   known — tenant isolation is this platform's core promise
   (CLAUDE.md §5/§6).

## 8. Credential rotation and incident containment

| Secret                                               | Where it's set                                | Rotation effect                                                                                                                                      | Rotation procedure                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_SECRET` (removed this milestone)            | n/a                                           | **None, ever** — verified unused by the actual session-token code before removal (§6)                                                                | Not a real containment action — this variable no longer exists. To actually end every session, see §6's `update sessions set revoked_at = now() ...` procedure instead.                                                                                                                                                                  |
| `CONNECTOR_CREDENTIAL_ENCRYPTION_KEY`                | Render env var                                | **Breaks decryption of every already-stored connector credential** — there is no re-encryption/re-keying tool in this codebase as of this writing    | **Do not rotate this casually.** If genuinely compromised: rotating it requires every tenant to re-enter their connector credentials (Meta/Google/IndiaMART/etc. tokens) after the rotation, because the old encrypted values become permanently unreadable. Plan this as a coordinated, communicated event, not a quiet env-var change. |
| `DATABASE_URL` (password component)                  | Supabase project settings + Render env var    | Any live connection using the old password is dropped by Postgres; the app reconnects automatically (connection pool) once the new value is deployed | Rotate in Supabase first, then update Render's env var and redeploy (or restart) the API. Expect a brief connection-pool reconnect window.                                                                                                                                                                                               |
| `REDIS_URL` (password component)                     | Upstash project settings + Render env var     | Similar to above; no business-data risk either way (§4 of `BACKUP-RECOVERY.md`)                                                                      | Rotate in Upstash first, then update Render's env var and redeploy/restart.                                                                                                                                                                                                                                                              |
| `OBJECT_STORAGE_ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` | Supabase Storage S3 settings + Render env var | Uploads/downloads fail until the new value is deployed; no decryption-style breakage since objects aren't encrypted with this key client-side        | Rotate in Supabase, update Render, redeploy. Verify with a real upload/download immediately after (`DEPLOYMENT.md` §"Supabase Storage setup" step 5).                                                                                                                                                                                    |

Never put any of the above in a committed file, a log line, or a support
ticket. `logger.module.ts`'s Pino redaction already strips
`authorization`/`cookie`/`set-cookie` headers and `password`/`token`/`secret`
body fields from logs by configuration — but that is a backstop, not a
substitute for not typing a secret into a terminal that gets copy-pasted
somewhere.

## 9. Backup recovery and post-recovery validation

See `BACKUP-RECOVERY.md` in full — it is the authoritative document for this
section. In summary: Postgres is the only true system of record; Redis loss
loses no business data (only delays queued notification delivery); object
storage loss is permanent for user-uploaded documents unless the provider's
own backup covers Storage specifically (verify this per project, don't
assume). Post-recovery, always confirm `/health` is green and re-run (or at
minimum re-check the result of) `test/rls.int.spec.ts` before declaring tenant
isolation intact on a restored database.

## 10. Escalation, incident notes and post-incident follow-up

This repository has **no formal incident-management tool or paging
integration configured** as of this writing (no PagerDuty/Opsgenie wiring, no
status-page integration). Until the business sets one up, treat the following
as the minimum bar, not a complete process:

1. **During the incident:** keep a running, timestamped note (even a plain
   text file) of what was observed, what was checked, and what was changed —
   include every `correlationId` encountered, since it is the thread that
   connects a user-visible symptom to the exact server-side log lines and
   (where relevant) audit rows.
2. **Decide and record who is the approver** for any action with a blast
   radius beyond "restart the API" — a credential rotation (§8), a
   restore (§9), or anything touching tenant isolation (§7) needs an explicit
   named decision-maker, not an assumption that whoever is online can decide
   alone.
3. **After the incident:** write a short post-incident note covering what
   happened, root cause, what was fixed, what test now covers it (§7 requires
   this explicitly for tenant-isolation incidents), and whether this document
   or `BACKUP-RECOVERY.md` needs updating because something here turned out
   to be wrong or incomplete in practice. Update the doc in the same change
   that fixes the bug, not as a separate, easily-skipped follow-up.
4. **Customer communication** is a business decision on content and timing,
   not an engineering one — but engineering should always be able to state,
   factually: what was affected, for how long, and (for a tenant-isolation
   incident specifically) exactly whose data was involved, per §7.
