# Deployment Architecture

Status: Selected architecture for staging/production. **Not yet provisioned** —
no Vercel/Render/Supabase/Upstash resources exist for this project as of this
writing; see "Staging provisioning status" below. The "Database roles &
connection model" section is implemented and covered by tests regardless of
host (ADR 0027).

Covers decisions 14, 15 and 16, superseding their original Railway + Cloudflare
R2 framing — see "History" at the end of this document.

## Topology

| Component                   | Host                                 | Exposure                                                                              |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Next.js web app (SSR + PWA) | **Vercel**                           | Public HTTPS — `staging.aivoryx.com`                                                  |
| NestJS API (`/api/v1`)      | **Render** web service               | Public HTTPS — `staging-api.aivoryx.com`                                              |
| PostgreSQL                  | **Supabase**                         | Public endpoint, TLS; reachable only with the project's credentials                   |
| Redis (BullMQ + cache)      | **Upstash**                          | Public endpoint, TLS (`rediss://`)                                                    |
| Object storage              | **Supabase Storage** (S3-compatible) | Private bucket; downloads via authenticated API route (no presigned URLs — see below) |
| DNS                         | **BigRock**                          | `staging.aivoryx.com` → Vercel, `staging-api.aivoryx.com` → Render                    |

Render and Vercel both offer private networking add-ons, but Supabase and
Upstash are reached over their public TLS endpoints either way (neither
product peers with Render/Vercel's private network in the free/starter
tiers this project uses) — so, unlike the original Railway plan, **Postgres
and Redis are not on a private network here**. They are protected by TLS in
transit and per-project credentials, not network isolation. This is a real
difference from decision 16's original "no public endpoint" framing —
documented here deliberately rather than silently dropped.

## Build / start / health — verified against the actual repo scripts

| Service      | Root directory | Build command                                     | Start command                                                                                              | Port                                                                                                                                                                                                                                                                            | Health check                                                                                                                                                                                                                                                                                                                                 |
| ------------ | -------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API (Render) | `apps/api`     | `nest build` (`pnpm --filter @aivoryx/api build`) | `node dist/main.js` (`pnpm --filter @aivoryx/api start`)                                                   | **Reads `API_PORT` from the environment, defaults to 4000 — it does NOT read Render's own `PORT` variable.** Set `API_PORT` in Render's env vars to the port configured in Render's service settings (Render does not auto-inject a var this app reads under a different name). | `GET /api/v1/health/live` — liveness only, no DB/Redis dependency check, so a transient Supabase/Upstash blip never causes a restart loop. `GET /api/v1/health` (no `/live`) is the deeper DB+Redis readiness check (returns 503 if either is unreachable) — use it for manual/external verification, not as Render's own health-check path. |
| Web (Vercel) | `apps/web`     | `next build` (`pnpm --filter @aivoryx/web build`) | `next start` (Vercel manages this itself as a managed Next.js deployment — no custom start command needed) | Vercel-managed                                                                                                                                                                                                                                                                  | Vercel's own deploy health check (build success); the app has no separate `/health` route on the web side.                                                                                                                                                                                                                                   |

Monorepo note: both commands above must run from the repo root with
`pnpm install` first so workspace packages (`@aivoryx/contracts`,
`@aivoryx/shared`, `@aivoryx/ui`, `@aivoryx/config`, `@aivoryx/db`) are built
and linked — set each provider's "Root Directory" to the repo root, not
`apps/api`/`apps/web`, and use the `pnpm --filter` commands above as the
actual build/start commands (both providers support a monorepo root +
filtered build command).

## Database migration order (release-step requirement, unchanged by the host)

**`pnpm --filter @aivoryx/db db:migrate` must run to completion before the API
receives any traffic.** This is not new to Supabase — it was already true for
Railway and remains true regardless of host, because migration `0003` creates
the `aivoryx_app` role the API's connection pool `SET ROLE`s into on every
physical connection (ADR 0027; see "Database roles & connection model" below).
If the API starts before migrations run, every query fails closed (the role
does not exist yet) rather than silently bypassing RLS.

Recommended sequencing on Render: run migrations as a **pre-deploy command**
(Render's "Pre-Deploy Command" field on the web service, run before the new
instance starts receiving traffic) rather than from a developer's laptop, so
it is part of the same deploy and uses the same `DATABASE_URL`.

## Object storage — Supabase Storage via the existing S3-compatible adapter

No new storage abstraction. `ObjectStorageService` (`apps/api/src/storage/`)
already supports any S3-compatible endpoint via `@aws-sdk/client-s3` when
`OBJECT_STORAGE_PROVIDER=s3` — Supabase Storage exposes an S3-compatible API,
so this is a configuration change only, not a code change.

```
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_ENDPOINT=https://<PROJECT_REF>.supabase.co/storage/v1/s3
OBJECT_STORAGE_REGION=<the region shown on the Supabase Storage S3 settings page>
OBJECT_STORAGE_BUCKET=<bucket name, e.g. aivoryx-staging>
OBJECT_STORAGE_ACCESS_KEY_ID=<Supabase Storage S3 access key id>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<Supabase Storage S3 secret key>
```

The exact endpoint/region values above are the _shape_ Supabase's own S3
settings page will show once a project exists — not fabricated resource IDs;
no Supabase project exists yet for this repository, so there is nothing real
to fill in. Never put real values in this file or any other committed doc.

**Security properties preserved by the adapter, unchanged by the host swap:**
the bucket stays private, the adapter never returns a public object URL,
credentials are server-only and never logged, downloads still go through
authenticated application routes (object keys are opaque tenant-namespaced
UUIDs, never accepted from the browser), and presigned URLs remain explicitly
**not implemented** (deferred, not a gap introduced by this change).

### Supabase Storage setup (operator steps — not automatable from code)

1. Supabase dashboard → Storage → **New bucket**. Name it per environment
   (e.g. `aivoryx-staging`) — never share one bucket across environments.
   Leave it **private** (do not enable public access).
2. Supabase dashboard → Storage → **S3 connection** (or Project Settings →
   Storage) → note the S3-compatible endpoint and region shown there.
3. Create an access key scoped to that project (Supabase issues S3-style
   access key id / secret for Storage) — store it directly in Render's
   environment variable panel, never in a file.
4. Set all five `OBJECT_STORAGE_*` variables above (plus
   `OBJECT_STORAGE_PROVIDER=s3`) as Render environment variables on the API
   service. Redeploy.
5. Verify with a real upload through the running application (e.g. set a
   tenant logo), then confirm in the Supabase Storage dashboard that the
   object appears under the expected tenant-namespaced key, and that
   downloading it still requires going through the API.

## PDF / document generation (Phase 10, ADR 0039)

Unaffected by the hosting change. `DocumentPdfService` uses **pdfmake** — pure
JavaScript, no headless browser or system libraries, runs on Render's standard
Node container as-is. PDFs are generated per request and streamed, never
persisted — no bucket or cleanup job required. No new environment variables.

## Environments

`development` (local) → `staging` (Vercel preview + Render staging service,
`staging.aivoryx.com` / `staging-api.aivoryx.com`) → `production` (separate
Vercel production deployment + Render production service, separate Supabase
project, separate Upstash database). No shared credentials across
environments — a new Supabase/Upstash project per environment, not a shared
one with different schemas/prefixes.

## Database roles & connection model (ADR 0027) — host-independent, verified against the actual code

There are **two logical database connections**, using the **same
`DATABASE_URL`** (one PostgreSQL user, call it `U`) by default:

| connection       | role in effect                                             | used by                                                                                                                                                                                                                                                                       |
| ---------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| migrator / owner | `U` (owns the schema; may create roles)                    | `db:migrate`, `db:seed` — `createDb()` with **no** `appRole`, so no `SET ROLE`                                                                                                                                                                                                |
| API runtime      | `aivoryx_app` (`NOSUPERUSER`, `NOBYPASSRLS`, owns nothing) | the API — `getDb()` = `createDb({ appRole: DATABASE_APP_ROLE })`; **the pool issues `SET ROLE "aivoryx_app"` on every physical connection before any query, and that `SET ROLE` must persist for the life of that physical connection** (`packages/db/src/client.ts`/`tx.ts`) |

- Migration **`0003`** runs as `U` and creates the `aivoryx_app` role
  (`NOSUPERUSER NOBYPASSRLS`), grants `U` membership into it, and sets the DML
  grants / default privileges. Idempotent.
- **`db:migrate` must run before the API starts**, on any host (see "Database
  migration order" above).
- The runtime API DB user must never be a superuser / `BYPASSRLS` role — RLS
  is the last line of tenant isolation and a bypass role defeats it,
  regardless of which provider hosts Postgres.

### Supabase connection mode — release-blocking verification

**Use Supabase's direct connection string (port `5432`), not the pooled
(PgBouncer, port `6543`, transaction-mode) one, for `DATABASE_URL`.**

Why, specifically: `SET ROLE "aivoryx_app"` is issued once per physical
connection and is read by `pg`'s connection pool (`packages/db/src/client.ts`)
to stay in effect for every query that connection runs afterward — the code
depends on session-level state surviving across multiple queries on the same
physical connection. Supabase's transaction-mode pooler (PgBouncer) can hand
different client requests to different physical backend connections
_between_ transactions, which does not guarantee a `SET ROLE` issued on one
borrowed connection is still in effect the next time that same client
"connection" is used — PgBouncer's own documentation describes session state
(including `SET ROLE`) as unsafe to rely on in transaction-pooling mode. The
direct connection string gives this app's own connection pool (not
PgBouncer's) authority over physical-connection lifetime, which is what the
existing code already assumes.

This has **not** been tested against a live Supabase instance (none is
provisioned) — it is a conclusion from reading the pooler's documented
behavior against this codebase's actual connection-role code, not a live
verification. Treat it as a strong recommendation to follow, and re-confirm
with a real connection-role regression test (see below) the first time a real
Supabase project exists, before trusting it with real tenant data.

A focused regression test (`packages/db/src/client.test.ts`, added in this
phase) proves the `SET ROLE` actually persists across connection reuse in
this codebase's own pool wrapper — it does not and cannot prove PgBouncer's
pooling behavior itself, since that requires a live transaction-mode pooler
to observe against.

## Configuration & secrets

All config via environment variables, validated at boot with a Zod schema
(`packages/config/src/server-env.ts` / `web-env.ts`); the process refuses to
start on a missing/invalid var. Secrets live in Render's and Vercel's own
environment-variable panels — never in the repo. `.env.example` lists keys
with dummy/placeholder values only. `NEXT_PUBLIC_*` is limited to
non-sensitive values and is inlined into the browser bundle at build time —
treat anything with that prefix as public the moment it's set.

## Data lifecycle

- Supabase's own automated backup/retention policy applies (tier-dependent) —
  a **restore test** against a real Supabase backup remains a pre-pilot gate,
  unchanged in principle from the original Railway plan, just against a
  different provider's backup tooling.
- Redis (Upstash) is treated as ephemeral/cache + queue; nothing is the sole
  system of record in Redis. BullMQ requires Redis persistence for queued
  jobs to survive a restart — confirm Upstash's persistence/durability
  settings for the chosen plan before relying on queued jobs surviving a
  Redis-side restart.

## CI/CD

- GitHub Actions (`.github/workflows/ci.yml`) runs on push/PR to `main`:
  format check, build, lint, typecheck, then the unit **and** integration
  test suites against real `postgres:16-alpine` + `redis:7-alpine` service
  containers (see `fix/ci-integration-and-redis` — at time of writing this is
  a pushed, unmerged branch; merge it before relying on CI as a release gate),
  then a Playwright smoke check. Secret scanning (gitleaks) runs as a
  separate job.
- **Deployment itself is not automated yet.** Render and Vercel can each be
  configured to auto-deploy on push to `main` once the services exist — that
  wiring is an external dashboard step (see "Staging provisioning status"),
  not a GitHub Actions job, and intentionally does not run migrations
  automatically on every push; migrations are a deliberate pre-deploy step
  (see above), not CI-triggered.
- Rollback: Vercel's instant rollback for web; Render's "redeploy a previous
  deploy" for the API. Migrations are forward-only and additive — there is no
  automatic migration rollback, by design (ADR-aligned across every module in
  this codebase; confirmed no destructive migration exists anywhere in the
  current migration history).

## Regions

Single region initially. Choose the Render/Supabase/Upstash region closest to
the client (India) when provisioning — not yet selected, since nothing is
provisioned. Multi-region is out of scope for v1.

## Same-origin API proxy — required for this exact domain pair

The session is an HTTP-only cookie issued by the API, with **no explicit
`Domain` attribute set anywhere in this codebase** (confirmed by inspecting
the session-cookie code) — it is a host-only cookie, scoped to the exact
hostname that issued it. `staging.aivoryx.com` and `staging-api.aivoryx.com`
share the same _registrable_ domain (`aivoryx.com`), but because the cookie
is host-only, it is **not** automatically shared between those two exact
hostnames — the browser still treats a request from the web origin to the API
origin as cross-site for cookie purposes. The practical effect is identical to
the original `*.vercel.app` vs `*.onrender.com` scenario this section
originally described: iOS Safari (ITP), privacy-hardened and some in-app
browsers will drop the cookie silently, producing a login that returns 2xx
followed by an immediate 401 on the next request.

- **Required fix (already implemented, not yet configured for this domain
  pair):** set on the Vercel project, as **build-time** environment variables
  (both are read inside `apps/web/next.config.mjs`'s `rewrites()`, which Next
  evaluates during `next build`):
  ```
  NEXT_PUBLIC_API_PROXY=true
  API_PROXY_TARGET=https://staging-api.aivoryx.com
  ```
  The browser then calls `/api/v1/*` on `staging.aivoryx.com` itself; Next
  rewrites it server-side to the Render API, and the cookie becomes first-party
  to `staging.aivoryx.com`. No CORS is involved for those calls. Do **not**
  weaken `Secure`/`HttpOnly`, and do not move the session to localStorage.
- **Alternative not chosen here:** set an explicit `Domain=aivoryx.com` on the
  session cookie so it's shared across both subdomains without a proxy. Not
  recommended without a deliberate decision — it would widen the cookie's
  scope to every current and future `*.aivoryx.com` subdomain, which is a
  bigger blast radius than the proxy for the same problem.
- The login page already verifies the cookie round-trips (`GET /auth/me`)
  before navigating and shows an explicit error instead of silently bouncing
  to `/login` if it doesn't.
- `CORS_ALLOWED_ORIGINS` (server env) still needs `https://staging.aivoryx.com`
  listed, even with the proxy in place, for any request path that doesn't go
  through the rewrite (e.g. a direct API call during development against the
  staging API).

## Redis — Upstash connection requirements

**Use Upstash's Redis (TCP) connection string, not its REST API URL.**
BullMQ (`apps/api/src/queue/`, `apps/api/src/redis/redis.module.ts`) uses
`ioredis`, which speaks the native Redis protocol over a TCP socket —
Upstash's separate REST-over-HTTPS product is a different API surface
entirely and is not a drop-in substitute; using it would require rewriting
the queue/cache layer, which is explicitly out of scope here.

`REDIS_URL` must therefore be Upstash's `rediss://default:<password>@<host>:<port>`
string (note the double "s" — TLS). `ioredis` detects TLS automatically from
the `rediss://` scheme with zero code change (confirmed by reading
`redis.module.ts` — it passes the URL straight to `new Redis(url, {...})`
with no separate TLS flag to set). The existing Zod schema
(`REDIS_URL: z.string().url().startsWith('redis')`) already accepts both
`redis://` and `rediss://`.

## Staging provisioning status (verified, not assumed)

As of this writing: **no Vercel, Render, Supabase, or Upstash resources exist
for this project**, and no DNS records exist at BigRock for either staging
hostname. Nothing below has been created, and this document does not claim
otherwise. See the release report for the exact step-by-step checklist and
which steps require a human with provider credentials.

## History

This document originally specified Railway (API, worker, Postgres, Redis) +
Cloudflare R2. That plan was approved but never provisioned. The team has
since selected Vercel + Render + Supabase + Upstash + Supabase Storage as the
actual staging/production target (unchanged: no microservices, no new
compute paradigm — this is a hosting-provider choice, not an architecture
change to the application itself). Railway/R2 are not currently planned to be
used; if that changes again, update this document rather than letting a
second description drift out of sync with reality.
