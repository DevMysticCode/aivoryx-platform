# Deployment Architecture

Status: Approved architecture. Infrastructure not provisioned yet; the
"Database roles & connection model" section below is implemented (ADR 0027).

Covers decisions 14, 15 and 16.

## Topology

| Component                   | Host                                 | Exposure                                        |
| --------------------------- | ------------------------------------ | ----------------------------------------------- |
| Next.js web app (SSR + PWA) | **Vercel**                           | Public HTTPS (app domain)                       |
| NestJS API (`/api/v1`)      | **Railway** service                  | Public HTTPS (api domain), behind rate limiting |
| BullMQ worker(s)            | **Railway** service (no public port) | Private only                                    |
| PostgreSQL                  | **Railway** managed                  | **Private networking only**                     |
| Redis                       | **Railway** managed                  | **Private networking only**                     |
| Object storage              | **Cloudflare R2** (S3-compatible)    | Private buckets; presigned URLs                 |

## Networking rules (decision 16)

- API, worker, PostgreSQL and Redis communicate over **Railway private
  networking**. Postgres and Redis have **no public endpoint** unless a specific,
  time-boxed, documented need arises (e.g. a one-off migration from a laptop),
  after which it is closed again.
- The only publicly reachable Aivoryx services are the Vercel web app and the
  Railway API.
- Vercel -> Railway API is public HTTPS (Vercel has no private link to Railway);
  it is protected by CORS allow-list, cookie `SameSite`, CSRF tokens, and rate
  limiting.
- Inbound integration webhooks terminate on the Railway API (or a dedicated
  ingestion route on it), never directly on a datastore.
- R2 access uses scoped API tokens stored in the secret manager; browser
  uploads/downloads use short-TTL presigned URLs.

## PDF / document generation (Phase 10, ADR 0039)

- PDF rendering (`DocumentPdfService`) uses **pdfmake** — pure JavaScript with
  built-in AFM fonts. It needs **no headless browser, no system libraries
  (`libnss3` / `libgbm` / fontconfig etc.), no font files, and no separate
  service**. It runs on the standard Railway Node API container as-is.
- PDFs are generated per request and streamed; they are **not** persisted to
  disk or object storage, so no bucket, lifecycle rule or cleanup job is
  required.
- **No new environment variables** are introduced by Phase 10. Tenant logos
  reuse the existing object-storage config (`OBJECT_STORAGE_*` / R2).

## Environments

`development` (local) -> `staging` (Vercel preview + Railway staging project)
-> `production` (Vercel production + Railway production project).

- Separate Railway projects per environment; separate databases, Redis,
  R2 buckets, and secrets. No shared credentials across environments.
- Vercel preview deployments point at the **staging** API, never production.

## Database roles & connection model (ADR 0027)

There are **two logical database connections**, and in the default deployment
they use the **same `DATABASE_URL`** (one PostgreSQL user, call it `U`):

| connection       | role in effect                                             | used by                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| migrator / owner | `U` (owns the schema; may create roles)                    | `db:migrate`, `db:seed` — `createDb()` with **no** `appRole`, so no `SET ROLE`                                                                           |
| API runtime      | `aivoryx_app` (`NOSUPERUSER`, `NOBYPASSRLS`, owns nothing) | the API — `getDb()` = `createDb({ appRole: DATABASE_APP_ROLE })`; the pool issues `SET ROLE "aivoryx_app"` on every physical connection before any query |

- Migration **`0003`** runs as `U` and executes
  `CREATE ROLE "aivoryx_app" … NOSUPERUSER NOBYPASSRLS`,
  `GRANT "aivoryx_app" TO current_user` (so `U` may `SET ROLE` into it), the DML
  grants, and `ALTER DEFAULT PRIVILEGES` for future tables. It is idempotent.
- **Ordering: `db:migrate` must run before the API starts.** The API pool
  `SET ROLE`s to `aivoryx_app`, which `0003` creates. This is already the
  release-step order (migrations before the new API version takes traffic).
- `U` may be a PostgreSQL superuser locally (docker). On Railway the provided
  `DATABASE_URL` user can `CREATE ROLE` / `GRANT`, so `0003` applies without any
  extra setup, and the **shared-`DATABASE_URL` model needs no special Railway
  variable arrangement** — set `DATABASE_URL` (+ `DATABASE_APP_ROLE` defaults to
  `aivoryx_app`) and run migrations first.
- **If a separate least-privilege DB user is provisioned for the API service**
  (a different `DATABASE_URL` than the migrator's), that user is not
  `current_user` when `0003` runs, so it is not granted membership in
  `aivoryx_app`. In that case, once, as an operator: `GRANT "aivoryx_app" TO
<api_db_user>;` — and the API user must **not** be a superuser or hold
  `BYPASSRLS`. `DATABASE_APP_ROLE` stays `aivoryx_app`.
- The runtime API DB user must never be a superuser / `BYPASSRLS` role. RLS
  (ADR 0027) is the last line of tenant isolation and a bypass role defeats it.

## Configuration & secrets

- All config via environment variables, validated at boot with a Zod schema;
  the process refuses to start on a missing/invalid var.
- Secrets in Railway/Vercel environment settings (a dedicated secret manager may
  be adopted later). Never in the repo; `.env.example` lists keys with dummy
  values only.
- `NEXT_PUBLIC_*` is limited to non-sensitive values (API base URL, build info).

## Data lifecycle

- Automated daily PostgreSQL backups (Railway) + retention policy; a **restore
  test** is a pre-pilot gate.
- R2 bucket versioning + lifecycle rules for raw-event bodies and attachments.
- Redis is treated as ephemeral/cache + queue; nothing is the sole system of
  record in Redis. BullMQ requires Redis persistence (AOF) enabled so queued
  jobs survive a restart.

## CI/CD (target shape)

- GitHub -> CI (typecheck, lint, unit/integration via Vitest, Playwright on
  golden journeys, migration validation, secret scan).
- On merge to `main` (the single release branch — ADR 0025): Vercel deploys web;
  Railway deploys API + worker; Drizzle migrations run as a release step with the
  migration role before the new API version takes traffic. `staging` and
  `production` are separate deployment environments off the same `main`, not
  separate branches.
- Rollback: Vercel instant rollback for web; Railway redeploy previous image for
  API/worker; migrations are forward-only and written to be
  backward-compatible for one release.

## Regions

Single region initially, chosen for proximity to the client (India) and R2
locality. Multi-region is out of scope for V1.
