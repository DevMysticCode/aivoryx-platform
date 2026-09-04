# Deployment Architecture

Status: Approved architecture. No application code or infrastructure exists yet.

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

## Environments

`development` (local) -> `staging` (Vercel preview + Railway staging project)
-> `production` (Vercel production + Railway production project).

- Separate Railway projects per environment; separate databases, Redis,
  R2 buckets, and secrets. No shared credentials across environments.
- Vercel preview deployments point at the **staging** API, never production.

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
