/**
 * Tenant lifecycle (Phase 14 §14). Four states, one linear-ish state machine —
 * not a second tenant model, just the vocabulary for `tenants.status`
 * (`packages/db/src/schema/identity.ts`) plus the transitions the platform
 * API is allowed to perform.
 *
 *   PROVISIONING -> ACTIVE
 *   ACTIVE       -> SUSPENDED | ARCHIVED
 *   SUSPENDED    -> ACTIVE | ARCHIVED
 *   ARCHIVED     -> (terminal — no destructive deletion or un-archiving yet)
 *
 * Enforcement lives in `TenantProvisioningService` (apps/api); this module is
 * the pure, unit-tested rule so the transition table is verified in isolation
 * from the database.
 */

export const TENANT_STATUSES = ['provisioning', 'active', 'suspended', 'archived'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<TenantStatus, readonly TenantStatus[]> = {
  provisioning: ['active'],
  active: ['suspended', 'archived'],
  suspended: ['active', 'archived'],
  archived: [],
};

export function isTenantStatus(value: unknown): value is TenantStatus {
  return typeof value === 'string' && (TENANT_STATUSES as readonly string[]).includes(value);
}

export function canTransitionTenantStatus(from: TenantStatus, to: TenantStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Every status this tenant could legally move to next, for a UI action list. */
export function nextTenantStatuses(from: TenantStatus): readonly TenantStatus[] {
  return ALLOWED_TRANSITIONS[from];
}
