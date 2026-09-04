# Aivoryx Platform

Modular-monolith business operating platform. This repository contains the
approved architecture documentation (`docs/`) and, as of Phase 1, the reusable
technical foundation — **no business modules yet**.

> Read `CLAUDE.md` and `docs/` before writing code. Architecture decisions are in
> `docs/adr/`; the technology baseline table is in
> `docs/architecture/ARCHITECTURE.md`.

## Stack

| Layer         | Choice                                                                                  |
| ------------- | --------------------------------------------------------------------------------------- |
| Monorepo      | pnpm workspaces + Turborepo                                                             |
| Web           | Next.js 15 (App Router, React 19), Tailwind, shadcn-style UI, TanStack Query, PWA shell |
| API           | NestJS 11, REST under `/api/v1`, code-first OpenAPI                                     |
| Database      | PostgreSQL + Drizzle ORM + Drizzle Kit, UUIDv7 keys                                     |
| Async         | Redis + BullMQ, transactional outbox (infra only in Phase 1)                            |
| Observability | Pino structured logs, correlation IDs, stable error codes                               |
| Config        | Zod-validated environment (`@aivoryx/config`)                                           |
| Tests         | Vitest (unit/integration) + Playwright (e2e)                                            |
| Deploy        | Web → Vercel · API/DB/Redis/workers → Railway (private networking)                      |

## Layout

```
apps/
  web/        Next.js app (Vercel)
  api/        NestJS API (Railway)
packages/
  shared/     error codes, error envelope, cross-cutting constants (leaf)
  config/     Zod environment schemas (server + web)
  db/         Drizzle client, schema, migrations, health probe, UUIDv7
  contracts/  code-first OpenAPI document + generated TS types
  ui/         shared design-system primitives + Tailwind preset
docs/         architecture, ADRs, diagrams, developer guides
```

## Prerequisites

- Node.js `22.20.0` (`.nvmrc`) — `nvm use` / `fnm use`
- pnpm `11` via Corepack: `corepack enable`
- Docker (for local PostgreSQL + Redis)

## Getting started

```bash
corepack enable
pnpm install

cp .env.example .env          # then edit — generate SESSION_SECRET:
#   node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

docker compose up -d          # PostgreSQL + Redis on 127.0.0.1
pnpm --filter @aivoryx/db db:generate   # create the first migration from schema
pnpm --filter @aivoryx/db db:migrate    # apply it

pnpm dev                      # web on :3000, api on :4000/api/v1
```

Open:

- http://localhost:3000 — app shell
- http://localhost:3000/health — live dependency health
- http://localhost:4000/api/v1/health — API readiness JSON
- http://localhost:4000/api/v1/docs — Swagger UI

## Common commands (run from the repo root)

| Command                                | What it does                                               |
| -------------------------------------- | ---------------------------------------------------------- |
| `pnpm dev`                             | run web + api in watch mode                                |
| `pnpm build`                           | build every package and app (Turbo)                        |
| `pnpm lint`                            | ESLint across the workspace (incl. module-boundary rules)  |
| `pnpm typecheck`                       | `tsc --noEmit` everywhere                                  |
| `pnpm test`                            | Vitest in every package/app                                |
| `pnpm --filter @aivoryx/web test:e2e`  | Playwright smoke tests                                     |
| `pnpm format`                          | Prettier write                                             |
| `pnpm contracts:generate`              | re-emit OpenAPI from the API + regenerate the client types |
| `pnpm db:generate` / `pnpm db:migrate` | Drizzle Kit generate / apply migrations                    |

## Environment variables

See `.env.example` for the full list and which are server-only.
**Server-only (never sent to the browser):** `DATABASE_URL`, `REDIS_URL`,
`SESSION_SECRET`, `OBJECT_STORAGE_*`, `CORS_ALLOWED_ORIGINS`.
**Browser-safe:** only `NEXT_PUBLIC_*`.

## Deployment (target — not wired yet)

- **Vercel** builds `apps/web`; give it only `NEXT_PUBLIC_*` variables.
- **Railway** runs `apps/api` (+ a worker service later), PostgreSQL and Redis on
  a private network; datastores are not publicly exposed. Server env vars are set
  as Railway service variables — no code change needed to connect them
  (`@aivoryx/config` reads `process.env`).

More detail: `docs/architecture/DEPLOYMENT.md`, `docs/developer/GETTING-STARTED.md`.
