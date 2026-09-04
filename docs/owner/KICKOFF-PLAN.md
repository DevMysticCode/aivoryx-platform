# Kickoff Plan — Start Here

## Step 1 — Freeze scope

Write down the first two pilot journeys:

- CRM: Lead → Telecaller → Field → Survey → Quotation → Booking
- HR: Employee → Attendance → Leave → Expense

Anything else is lower priority unless it blocks these journeys.

## Step 2 — Get real samples

Do not build integrations from assumptions. Collect sanitized examples and current workflows from every provider.

## Step 3 — Create architecture baseline

Review and approve:

- system-map.mmd
- module-boundaries.mmd
- lead-to-booking.mmd
- integration-flow.mmd
- deployment.mmd
- ADRs

## Step 4 — Establish repository

Create GitHub repo, protect `main`, set up CI, create `.env.example`, and add this documentation before business coding. Work happens on short-lived `feature/*` branches merged into `main` via PR — no `develop` branch (ADR 0025).

## Step 5 — Establish environments

Development → staging → production.

Keep production secrets separate.

## Step 6 — Establish design system

Frontend developer creates shared primitives first. Do not build one-off buttons/tables/forms per screen.

## Step 7 — Establish observability

Correlation IDs, structured logs, error codes, integration event logs, and support reference IDs must exist before integrations.

## Step 8 — First Claude task

Ask Claude to audit the repository against this documentation and produce a gap report. Do not ask it to build CRM immediately.

## Step 9 — First implementation slice

Build:
Platform login → tenant context → RBAC → employee/user foundation.

Then begin CRM and HR in parallel.

## Step 10 — Weekly review

Every week review:

- completed client journeys
- blockers
- architecture changes
- defects
- integration status
- test coverage
- performance
- documentation drift

The goal is a stable client pilot, not maximum code volume.
