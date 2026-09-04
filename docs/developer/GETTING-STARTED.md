# Developer Getting Started

## Before writing business code

1. Read `CLAUDE.md`.
2. Read `docs/architecture/ARCHITECTURE.md`.
3. Read your stream guide:
   - backend: `docs/architecture/BACKEND.md`
   - frontend: `docs/architecture/FRONTEND.md`
4. Read `docs/architecture/WORKFLOWS.md`.
5. Check relevant Mermaid diagrams.
6. Check ADRs before changing architecture.

## Local environment

Required:

- Node.js `22.20.0` (pinned via `.nvmrc`; `packageManager` pins pnpm)
- pnpm `11` via Corepack (`corepack enable`) — workspace: pnpm workspaces + Turborepo
- Docker for local PostgreSQL + Redis (`docker-compose.yml`)
- Drizzle Kit via package scripts for migrations (`pnpm db:generate` / `pnpm db:migrate`)
- Git
- Claude Code
- Playwright browser: `pnpm --filter @aivoryx/web exec playwright install chromium`

Object storage is deferred in Phase 1 (`OBJECT_STORAGE_*` may be left blank).
When it is needed, point it at a Cloudflare R2 dev bucket or a local MinIO.

## First-time setup

```bash
corepack enable
pnpm install
cp .env.example .env          # edit; generate SESSION_SECRET with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
docker compose up -d
pnpm --filter @aivoryx/db db:generate
pnpm --filter @aivoryx/db db:migrate
pnpm dev
```

Verify:

- API readiness: `curl http://localhost:4000/api/v1/health`
- Swagger UI: http://localhost:4000/api/v1/docs
- Web shell: http://localhost:3000 · health page: http://localhost:3000/health

## Repository layout

- `apps/web` — Next.js (Vercel). `apps/api` — NestJS (`/api/v1`, Railway).
- `packages/shared` — error codes + error envelope (leaf, no internal deps).
- `packages/config` — Zod env schemas (`@aivoryx/config` server / `/web`).
- `packages/db` — Drizzle client, schema, migrations, `checkDatabaseHealth`, UUIDv7.
- `packages/contracts` — code-first OpenAPI doc + generated TS types.
- `packages/ui` — shared primitives + Tailwind preset.

Module boundaries are enforced by ESLint (`eslint.config.mjs`,
`no-restricted-imports` groups). `packages/*` may not import `apps/*`; the two
apps may not import each other (use `@aivoryx/contracts`); `apps/web` may not
import the DB/queue packages or NestJS.

## Config access

Never read `process.env` directly. Inject `SERVER_ENV` in the API; import
`webEnv` from `apps/web/lib/env.ts` in the web app. Both are validated once by
`@aivoryx/config` and fail fast on a bad environment.

## OpenAPI + client types

The API is the source of truth (`@nestjs/swagger`, code-first). Regenerate the
committed contract + web client types after changing an endpoint:

```bash
pnpm contracts:generate   # api openapi:extract  ->  contracts generate
```

## Deployment targets

- Web app → Vercel (only `NEXT_PUBLIC_*` vars). API, workers, PostgreSQL, Redis →
  Railway on a private network; datastores not publicly exposed.
- Object storage → Cloudflare R2. See `docs/architecture/DEPLOYMENT.md`.
- `@aivoryx/config` reads `process.env`, so Railway/Vercel service variables
  connect without any code change.

## Workflow

Branch off `main` as `feature/<short-name>` → implement one vertical slice →
Vitest + (for critical paths) Playwright → review → **Pull Request into `main`**
→ CI green → merge. Keep branches short-lived; one ticket = one bounded outcome.
There is no `develop` branch — environment separation is handled by deployment
environments, not long-lived branches (ADR 0025).

## Communication

A ticket/PR must state:

- business outcome
- scope
- acceptance criteria
- screenshots for meaningful UI changes
- tests
- known limitations
