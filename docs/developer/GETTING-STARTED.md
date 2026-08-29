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
- Node.js LTS
- pnpm
- Docker if local PostgreSQL/Redis are used
- Git
- Claude Code
- Playwright browsers

## Workflow

Branch → implement vertical slice → test → review → PR → CI → merge.

## Communication

A ticket/PR must state:
- business outcome
- scope
- acceptance criteria
- screenshots for meaningful UI changes
- tests
- known limitations
