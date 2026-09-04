# ADR 0025 — Git Branch Strategy: short-lived feature branches onto `main`

Status: Accepted (Phase 1 gate — technical lead)

## Context

Earlier documentation (`KICKOFF-PLAN.md`, `GETTING-STARTED.md`) assumed a
long-lived `develop` branch with releases promoting `develop` to `main`
(git-flow style). The repository never created `develop`, and CI referenced it.
This is unnecessary overhead for a small team shipping continuously, and it left
the docs and CI internally inconsistent.

## Decision

Use a **trunk-based model with short-lived feature branches**:

- `main` is the single long-lived branch. It is protected and always
  releasable.
- `feature/*` branches are cut from `main`, kept short-lived (hours to a few
  days), and merged back via **Pull Request** with CI green and review.
- No `develop` branch. No `release/*` branches. No long-lived integration
  branch of any kind.
- Flow: `feature/* → Pull Request → main`.
- **Environment separation is handled by deployment environments**
  (`development` / `staging` / `production` per `DEPLOYMENT.md`), not by
  long-lived Git branches. Merging to `main` is what triggers the
  staging/production deploy pipeline.
- Hotfixes use the same path (`feature/…` or `fix/…` → PR → `main`), expedited.

## Consequences

- CI triggers on pushes to `main` and on all pull requests only.
- Docs and `KICKOFF-PLAN.md` that mention `develop` are corrected.
- Release/promotion wording in `DEPLOYMENT.md` refers to `main` as the release
  branch.
- Contributors keep branches small; large changes are split rather than parked
  on a shared branch.
