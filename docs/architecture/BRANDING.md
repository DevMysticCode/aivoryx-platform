# Tenant Branding & Onboarding

Phase 10 — ADR 0039. First-class, white-label company configuration for each
tenant, plus a resumable onboarding checklist and one reusable contextual-help
component set. Branding is **presentation only** — it is never a security,
tenancy or permission boundary.

## The white-label boundary

Branding **affects**: the authenticated app shell (workspace name + logo), the
`/auth/me` payload, generated documents (quotation / invoice / receipt / credit
note), and the notification-email wrapper.

Branding **never affects**: internal API identity, tenant ids, database
ownership, RLS, permission semantics, or infrastructure. Aivoryx branding is
never fully removed — a subtle "Powered by Aivoryx™" line stays in the app
footer, on every document footer, and in every branded email.

## Data model (`packages/db/src/schema/branding.ts`, migration 0012)

| Table                     | Shape                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tenant_company_profiles` | one row per tenant. Legal / display name, email / phone / website, generic address (line, city, region, country, postal), **generic** `tax_registration_label` + `tax_registration_number`, `document_footer`, `timezone`, `default_currency`, `primary_color`, `accent_color`. Hex + ISO-currency DB CHECKs. Composite `(id, tenant_id)` FK for `updated_by`. |
| `tenant_assets`           | one row per `(tenant_id, kind)` where `kind ∈ {logo, logo_light, logo_dark, favicon}`. Opaque `object_key`, sniffed `content_type`, `size_bytes` (CHECK > 0), `width`/`height`. Bytes live in object storage, never in Postgres.                                                                                                                               |
| `tenant_onboarding`       | one row per tenant, only `dismissed_at` / `dismissed_by`. The checklist steps and their completion are **derived**, not stored.                                                                                                                                                                                                                                |

All three: `tenant_id` + `ENABLE` + `FORCE` RLS + the ADR 0027 tenant-isolation
policy (`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`
in USING **and** WITH CHECK). Direct PostgreSQL RLS proof is in
`apps/api/test/rls.int.spec.ts`.

## Logos — reuse the object store, never trust the client

- Stored via the existing `ObjectStorageService` (`OBJECT_STORAGE` token) — no
  second file system. Keys are server-generated:
  `tenants/<tenantId>/branding/<kind>/<uuid>.<ext>`.
- `apps/api/src/settings/image-meta.ts` sniffs the format from magic bytes.
  **Only PNG / JPEG / WebP** are accepted. SVG is rejected (it can carry
  script). The declared `Content-Type` must match the sniffed format.
  Dimensions come from the header and are bounded 16–4000px; size ≤ 2 MB.
  Failures → `LOGO_INVALID` (422) with a machine reason.
- Download is an **authenticated** route (`GET /api/v1/settings/company/logo`),
  streamed with `StreamableFile` — never a public or signed URL, never an
  exposed object key. The web app fetches it with credentials and shows it via
  an object URL so it works cross-site in production.

## Brand colour — a token override, not CSS

Colour is stored as `#rrggbb` and validated server-side (`@Matches` + DB
CHECK). `apps/web/components/brand-provider.tsx` converts it to an HSL triple
and overrides **exactly two** design tokens — `--primary` and `--ring` — via a
single scoped `<style>` with no selectors and no other declarations. Lightness
is clamped to a readable band so the fixed near-white `--primary-foreground`
keeps contrast on primary surfaces. There is no path to inject arbitrary CSS or
JS.

## Permissions

`settings.company.read` and `settings.company.update` only. **Consuming**
branding (app shell, `/auth/me`, the logo stream, document + email branding)
needs **no** permission — every member sees their workspace identity.
`TENANT_ADMIN` has both keys; `FIELD_AGENT` has neither.

## Onboarding (`apps/api/src/settings/onboarding.service.ts`)

- A fixed typed `STEPS` array: company profile, branding, first team member,
  first customer, first lead source. No workflow engine, no arbitrary JSON.
- Each step's `done` is derived from real domain data on read (profile fields,
  logo row, membership / customer / lead-source counts).
- Steps are filtered to those the caller's RBAC permissions allow, so every
  link points at a screen the user can actually open. A member with no admin
  permissions gets an empty list.
- `show = has visible steps ∧ not complete ∧ not dismissed`. Dismissal is the
  only stored state.

## Contextual guidance (`apps/web/components/guidance.tsx`)

One component set — `GuidanceCard`, `HelpTip`, `LifecycleTrail` — not five
competing ones. Help copy lives in `apps/web/lib/help-content.ts`, versioned
with the code (no CMS). `LifecycleTrail` is **read-only**: it points at the
API's authoritative status value and never advances or infers state.

## API

| Route                                  | Permission                | Notes                                                       |
| -------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| `GET /api/v1/settings/company`         | `settings.company.read`   | full profile + `has*` logo flags                            |
| `PUT /api/v1/settings/company`         | `settings.company.update` | partial patch; hex + currency validated                     |
| `GET /api/v1/settings/branding`        | authenticated             | compact `{displayName, primaryColor, accentColor, hasLogo}` |
| `POST /api/v1/settings/company/logo`   | `settings.company.update` | multipart; `?kind=`                                         |
| `DELETE /api/v1/settings/company/logo` | `settings.company.update` | `?kind=`                                                    |
| `GET /api/v1/settings/company/logo`    | authenticated             | streamed image, `?kind=`                                    |
| `GET /api/v1/onboarding`               | authenticated             | derived, permission-filtered steps                          |
| `POST /api/v1/onboarding/dismiss`      | `settings.company.update` | stores `dismissed_at`                                       |

`GET /api/v1/auth/me` gains `active.branding` (`BrandingContextDto`).
