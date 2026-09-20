# Deployment Architecture

Status: Approved architecture. Infrastructure not provisioned yet; the
"Database roles & connection model" section below is implemented (ADR 0027).

Covers decisions 14, 15 and 16.

## Topology

| Component                   | Host                                 | Exposure                                                                              |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Next.js web app (SSR + PWA) | **Vercel**                           | Public HTTPS (app domain)                                                             |
| NestJS API (`/api/v1`)      | **Railway** service                  | Public HTTPS (api domain), behind rate limiting                                       |
| BullMQ worker(s)            | **Railway** service (no public port) | Private only                                                                          |
| PostgreSQL                  | **Railway** managed                  | **Private networking only**                                                           |
| Redis                       | **Railway** managed                  | **Private networking only**                                                           |
| Object storage              | **Cloudflare R2** (S3-compatible)    | Private bucket; downloads via authenticated API route (no presigned URLs — see below) |

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
- R2 access uses a scoped API token (Object Read & Write on one bucket) stored
  as Railway service variables. Uploads and downloads both go through the
  Railway API, not directly from the browser to R2 — the same authenticated
  route pattern the local filesystem adapter always used. **Presigned URLs are
  not implemented**: they would reduce API load for large downloads but were
  judged out of scope for the adapter itself (a download-security change, not
  a storage-provider swap) — tracked as deferred future work, not a gap
  introduced silently.

## Object storage — provider selection & Cloudflare R2 setup (deployment hardening)

Implemented (previously this document described only the target architecture;
this section describes what actually ships). `ObjectStorageService`
(`apps/api/src/storage/`) is the single interface every attachment consumer
depends on — tenant logos, CRM/field visit photos, quotation attachments, EPC
execution attachments, HR employee documents, HR expense receipts. No caller
knows or cares which adapter is active.

**Provider selection** — one environment variable, one authoritative wiring
point (`storage.module.ts`'s `selectObjectStorageProvider`):

| `OBJECT_STORAGE_PROVIDER` | Adapter                                         | Use                                                                                                                                                                                 |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local` (default)         | `LocalFilesystemObjectStorageService`           | Local development only — writes under `OBJECT_STORAGE_LOCAL_DIR`. **Never use on Railway**: container disks are ephemeral (wiped on every redeploy) and not shared across replicas. |
| `s3`                      | `S3ObjectStorageService` (`@aws-sdk/client-s3`) | Staging and production. Works with any S3-compatible endpoint — Cloudflare R2 is the first target, not a special case.                                                              |

Required configuration when `OBJECT_STORAGE_PROVIDER=s3` (the API refuses to
boot if any are missing — see `packages/config/src/server-env.ts`):

```
OBJECT_STORAGE_PROVIDER=s3
OBJECT_STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
OBJECT_STORAGE_REGION=auto
OBJECT_STORAGE_BUCKET=<bucket name>
OBJECT_STORAGE_ACCESS_KEY_ID=<R2 API token access key id>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<R2 API token secret>
```

Never put real values in this file or any other committed doc — the block
above is a shape, not a template to fill in with production credentials.

**Security properties preserved by the adapter, not re-decided per deployment:**

- The bucket stays **private**. The adapter never generates or returns a
  public object URL; it never marks an object public on write.
- Credentials (`OBJECT_STORAGE_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY`) are
  server-only — never sent to the browser, never logged (the adapter logs
  only `{ operation, provider, bytes, durationMs, correlationId }` on success
  and `{ operation, provider, err: { name, message } }` on failure).
- Downloads still go through the existing authenticated application routes
  (e.g. `GET /hr/employees/:id/documents/:documentId/download`) — the object
  key is never exposed to or accepted from the browser. Presigned URLs would
  reduce API load for large files but are explicitly **not** implemented here
  — see "Deferred" in the corresponding feature's final report.
- Object keys remain tenant/entity-namespaced opaque UUIDs
  (`buildEntityAttachmentKey`) — unchanged by the adapter swap. Authorization
  is still resolved from the database (which membership can see which
  entity), never from key secrecy.

### Cloudflare R2 setup (operator steps — not automatable from code)

1. Cloudflare dashboard → R2 → **Create bucket**. Name it per environment
   (e.g. `aivoryx-staging`, `aivoryx-production`) — never share one bucket
   across environments.
2. Leave the bucket **private** (R2's default) — do not enable the public
   development URL or connect a custom domain to it.
3. R2 → **Manage API tokens** → create a token scoped to **Object Read &
   Write** on that one bucket only (not account-wide "Admin Read & Write").
   Cloudflare shows the Access Key ID and Secret Access Key exactly once —
   store them in Railway's variable panel immediately, never in a file.
4. `OBJECT_STORAGE_ENDPOINT` is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   — the account ID is shown on the same R2 dashboard page, not inside the
   bucket itself.
5. `OBJECT_STORAGE_REGION=auto` — R2's own convention; the adapter passes it
   straight through and does not interpret it.
6. Set all five `OBJECT_STORAGE_*` variables (plus `OBJECT_STORAGE_PROVIDER=s3`)
   as Railway service variables on the API service. Redeploy.
7. Verify with a real upload through the running application (e.g. set a
   tenant logo) — then confirm in the R2 dashboard that the object appears
   under `tenants/<tenantId>/...` and that downloading it still requires
   going through the API, not R2's dashboard preview link.

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

## Session cookie across web and API origins (login-loop fix)

The session is an HTTP-only cookie issued by the API. When the web app and the API sit on **different
registrable domains** (staging: `*.vercel.app` web, `*.onrender.com` API) the cookie is a
_third-party_ cookie in the browser. Chrome desktop/Android usually allow it; iOS Safari (ITP),
privacy-hardened and some in-app browsers drop it silently. Symptom: login returns 2xx, the next
request has no cookie, `/auth/me` is 401, the shell redirects to `/login`.

- **Fix (recommended, opt-in):** set `NEXT_PUBLIC_API_PROXY=true` (+ `API_PROXY_TARGET`) on the web
  project. `apps/web/next.config.mjs` rewrites `/api/v1/*` to the API, the browser only talks to its own
  origin, and the cookie becomes first-party (host-only, HttpOnly, `Secure` outside development).
  No CORS is involved for those calls. Do **not** weaken `Secure`/`HttpOnly`, and do not move tokens to
  localStorage.
- **Alternative:** put web and API under one registrable domain (`app.example.com` / `api.example.com`).
- The login page now verifies the cookie round-trips (`GET /auth/me`) before navigating and shows
  "Sign-in succeeded, but we couldn't establish your session…" instead of bouncing to `/login`.
- Diagnostics (no secrets): API logs `session cookie issued` (attributes only) and
  `unauthenticated request without a session cookie` (origin, path, whether any cookie header arrived).
