# Product UX

_Phase 13B · ADR 0042. See also `PLATFORM-ACCESS.md`, `AUTHORIZATION.md`,
`MODULE-ENTITLEMENTS.md`, `BRANDING.md`, `FRONTEND.md`._

Phase 13B makes Aivoryx feel like one **premium, fast, access-aware SaaS
product** rather than a set of CRUD screens. CRM is the **reference
implementation** — the visual and interaction standard later applied to HR,
Field, Supply, Commercial, EPC and Finance.

## Design principles

- **Fast and calm.** Server-side pagination and filters, debounced search,
  TanStack Query caching + targeted invalidation, skeletons for structure (never
  a full-page spinner), optimistic updates only where a rollback is safe.
- **Information-dense where it helps.** Compact tables, tabular numerals for
  counts, restrained type scale — a business app needs readable density, not
  oversized headings.
- **Predictable.** One component vocabulary, consistent status semantics, the
  same page anatomy (`PageHeader` → content → sticky actions) everywhere.
- **Accessible.** Semantic HTML, visible focus, focus-trapped dialogs, real
  button/menu semantics, `prefers-reduced-motion` respected, ≥44px touch
  targets, no hover-only interactions.
- **Aivoryx identity, tenant-first.** The tenant's name/logo/colour lead; the
  Aivoryx mark is subtle ("Powered by Aivoryx™"). A platform admin sees
  "Aivoryx Platform".
- **Restraint.** Subtle motion on overlays only; no decorative gradients, giant
  cards, or animation that slows interaction.

## The application shell

`apps/web/components/app-shell.tsx` — one shell, three form factors:

|             | Desktop (`md+`)                                      | Tablet            | Mobile                                 |
| ----------- | ---------------------------------------------------- | ----------------- | -------------------------------------- |
| Primary nav | branded left sidebar, groups expand                  | same, collapsible | bottom nav (5 pinned) + "More" sheet   |
| Top bar     | search/⌘K trigger · notification bell · account menu | same              | brand · search · bell · menu           |
| Content     | centred `max-w-6xl` column                           | fluid             | full-width, `pb-20` for the bottom bar |

`/field/*`, `/login` and `/accept-invitation` opt out of the shell entirely
(the Field PWA keeps its purpose-built bottom-nav chrome — Phase 13B does not
touch it).

## Module-aware navigation (centralized registry)

`apps/web/lib/navigation/registry.ts` — `TENANT_NAV` and `PLATFORM_NAV`. Each
entry: `{ key, label, href?, icon, module?, permission?, order, children? }`.

`useNavigation()` filters the registry by:

1. **platform role** — a platform admin with no active workspace gets
   `PLATFORM_NAV`; every `/platform/*` route forces it;
2. **tenant entitlements** — an entry with a `module` is dropped unless
   `entitledModules` contains it;
3. **effective permissions** — an entry with a `permission` is dropped unless
   the user holds it (effective = already entitlement-filtered).

A parent group renders only if a child survives. **Unauthorised links are not
rendered** — navigation, the command palette, dashboard widgets and search all
consult the same `useAccess()` view, so Company B (CRM + Supply) never shows HR,
Field, Finance or EPC anywhere. `useAccess()` derives everything from
`/auth/me` — the frontend invents no authorization (ADR 0042 §58).

## Platform admin experience

A visually distinct console (dark brand mark, "Platform administration" footer):

- `/platform` — overview: company counts, module catalogue with dependencies,
  recent companies. Loading / error / empty / populated states.
- `/platform/tenants` — a searchable, sortable, filterable company table
  (mobile: cards).
- `/platform/tenants/:tenantId` — company detail + **module entitlement
  management**: each module shows state, dependencies, enable/disable. Enabling
  is blocked (button disabled + hint) until dependencies are on; disabling is
  blocked while an enabled module depends on it (`Lock` hint) and always
  **confirmed** — Aivoryx never cascades. Dependency-rejection errors from the
  API are shown verbatim in a toast.
- `/platform/modules` — the read-only catalogue grouped by category.

## Tenant admin — access experience

`/admin/access` (three tabs, plain-language, no raw permission keys as the
primary surface):

- **Users** — pick a member → assign a **profile + data scope**, add/remove
  **permission sets**, and read **effective access** per module: entitlement,
  granted permissions (human labels), and the data scope where it applies.
  Helper text explains the model in one sentence.
- **Profiles** / **Permission sets** — create/edit with a **module-grouped
  permission picker** fed by `GET /admin/access/available-permissions`, which
  the server filters to entitled modules. A permission that belongs to a
  non-entitled module cannot be selected, and the API's
  `ACCESS_PERMISSION_NOT_AVAILABLE` is surfaced inline.

## CRM flagship (the standard)

- **`/crm` overview** — real KPIs from the existing `GET /crm/leads` endpoint
  (total, open, qualified, conversion), a leads-by-status bar chart that links
  into filtered lists, and recent leads. Quick "New lead" action.
- **Module sub-nav** — Overview · Leads · Customers · Visits, itself
  entitlement/permission-filtered.
- **Command palette (⌘/Ctrl-K)** — navigate, create (only commands the user is
  authorised for — "Create Lead" needs CRM + `crm.leads.read`/`crm.leads.create`),
  and debounced search over leads + customers, grouped by type, full keyboard
  nav.
- **Quick create** — `/crm/leads?new=1` focuses the inline create form;
  `?status=` deep-links a filtered list.

## Feedback, states, motion

- **Toasts** (`components/ui/toast.tsx`) for transient confirmations; important
  errors stay in context (`ErrorBlock`, with a Ref id, a Try-again affordance,
  and distinct copy for entitlement vs permission failures — never a stack
  trace).
- **Empty states** are actionable ("No leads yet … Create Lead").
- **Confirmations** (`Confirm`) for module disable, access removal, deletes.
- Overlays (`Dialog`, `Sheet`, `Menu`, command palette) are focus-trapped,
  Esc-dismissible, and the only place motion is used.

## Component system

`apps/web/components/ui/*` (overlays, toast, command palette, kit) +
`components/admin/ui.tsx` (page primitives) + `packages/ui` (`Button`, tokens,
Tailwind preset). No second styling system; tokens are the HSL CSS variables in
`packages/ui/src/styles.css`, with the tenant brand colour a safe two-token
(`--primary`, `--ring`) override (Phase 10 `BrandProvider`, contrast-clamped).

**Recommended next step:** adopt Radix primitives under `components/ui/*` for
the menu/dialog/tooltip internals (kept dependency-free in 13B) and promote the
shared kit into `packages/ui` as the vocabulary stabilises.

## Route protection

Frontend guards are UX, not security. `/platform/*` redirects a
non–platform-admin home; module layouts still render the API's stable
`ENTITLEMENT_MODULE_NOT_ENABLED` message instead of data when a tenant lacks the
module. The backend guard + RLS remain authoritative.

## Future UX rollout

Apply the CRM standard, in order, to: HR self-service → Field → Finance →
Commercial → Supply → EPC. Each module gets: an overview with real KPIs, an
entitlement/permission-filtered sub-nav, list→detail with a mobile card view, a
consistent detail workspace, and command-palette create actions. A role-aware
dashboard framework (`/`) and CRM saved-views/kanban/bulk are the first
follow-ups (see ROADMAP "Deferred UX work").
