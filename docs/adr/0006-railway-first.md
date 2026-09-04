# ADR 0006 — Initial Hosting: Vercel + Railway

Status: Accepted (supersedes the original "Railway First")

## Decision

- **Vercel** hosts the Next.js web app (SSR + PWA). Preview deployments target
  the staging API only.
- **Railway** hosts the NestJS API, the BullMQ worker service, PostgreSQL and
  Redis.
- API ↔ worker ↔ PostgreSQL ↔ Redis communicate over **Railway private
  networking**. PostgreSQL and Redis have **no public endpoint** unless a
  specific, time-boxed, documented need arises.
- Only the Vercel web app and the Railway API are publicly reachable.
- Object storage is Cloudflare R2 (ADR 0015).
- Separate Railway projects and separate secrets per environment.

## Reason

The team needs simple managed deployment while requirements are still being
validated. Vercel is the natural home for Next.js; Railway keeps the API,
workers and stateful services together on one private network. Migration to AWS
(or similar) remains possible later. Details in `docs/architecture/DEPLOYMENT.md`.
