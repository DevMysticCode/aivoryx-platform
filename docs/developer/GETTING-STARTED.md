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
- Node.js LTS (pinned via `.nvmrc` / `packageManager`)
- pnpm (workspace: pnpm workspaces + Turborepo)
- Docker for local PostgreSQL + Redis
- Drizzle CLI (via package scripts) for migrations
- an S3-compatible target for local object storage (Cloudflare R2 dev bucket or MinIO)
- Git
- Claude Code
- Playwright browsers

## Deployment targets

- Web app → Vercel. API, workers, PostgreSQL, Redis → Railway (private network).
- Object storage → Cloudflare R2. See `docs/architecture/DEPLOYMENT.md`.

## Workflow

Branch off `develop` → implement vertical slice → Vitest + (for critical paths)
Playwright → review → PR into `develop` → CI → merge. Releases promote `develop`
to the protected `main` branch. One ticket = one bounded outcome.

## Communication

A ticket/PR must state:
- business outcome
- scope
- acceptance criteria
- screenshots for meaningful UI changes
- tests
- known limitations
