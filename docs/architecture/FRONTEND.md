# Frontend Developer Guide

## Stack

Next.js, React, TypeScript, Tailwind, shadcn/ui, TanStack Query, React Hook Form, Zod, Lucide, PWA.

## Structure

`apps/web/app` contains routes.
`apps/web/features` contains domain UI and hooks.
`packages/ui` contains reusable design-system components.
`lib/api` contains generated/API access.
`lib/permissions` handles UI capability checks.

## Rules

- Prefer Server Components.
- Use Client Components only when state, browser APIs, or interaction requires them.
- Do not call backend APIs directly from arbitrary components.
- Use feature hooks backed by TanStack Query.
- Use generated API types/contracts.
- Use React Hook Form + Zod for complex forms.
- Use shared table, form, modal, status, skeleton and error components.

## Screen states

Every data screen must handle:
1. loading
2. success
3. empty
4. permission denied
5. validation error
6. network error
7. server error
8. stale/retrying state where relevant

## UX

Primary action should be obvious.
Avoid unnecessary modals.
Use drawers for quick inspection where appropriate.
Use detail pages for complex workflows.
For field users, optimize for touch, poor connectivity, GPS/camera access and minimal typing.

## Performance

Do not load maps, charts, editors, or large libraries globally.
Use dynamic/lazy loading.
Paginate lists.
Avoid rendering thousands of DOM rows.
Use optimistic UI only where rollback semantics are safe.

## Accessibility

Keyboard navigation, visible focus, semantic controls, labels, sufficient contrast and screen-reader-friendly states are required.

## Visual quality

Do not make every screen look like a CRUD admin panel. Use clear hierarchy, activity timelines, status badges, contextual actions and progressive disclosure.
