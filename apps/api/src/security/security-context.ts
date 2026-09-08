import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The authenticated context for one request (ADR 0027 / 0029).
 *
 * Built by `SecurityGuard` from the session cookie only — never from client
 * headers/body. Exposed to controllers through param decorators and to deep
 * services through the AsyncLocalStorage below (same pattern as the correlation
 * id). There is no mutable global tenant state.
 */

export interface SecurityUser {
  id: string;
  email: string;
  status: 'active' | 'disabled';
}

export interface SecuritySession {
  id: string;
  activeMembershipId: string | null;
  expiresAt: Date;
}

export interface SecurityMembership {
  id: string;
  tenantId: string;
  tenantSlug: string;
  status: 'active' | 'suspended' | 'invited';
}

export interface SecurityContext {
  user: SecurityUser;
  session: SecuritySession;
  /** present once a tenant is resolved for the request */
  membership: SecurityMembership | null;
  tenantId: string | null;
  /** permission keys granted to the active membership; empty until a tenant is resolved */
  permissions: ReadonlySet<string>;
  /**
   * module keys the active tenant is ENTITLED to (Phase 13, ADR 0042). Empty
   * until a tenant is resolved. A permission is only effective if its owning
   * module is in this set — the guard enforces entitlement BEFORE permission.
   */
  entitledModules: ReadonlySet<string>;
  /** true if this user is an Aivoryx platform administrator (not tenant-scoped) */
  isPlatformAdmin: boolean;
}

const storage = new AsyncLocalStorage<SecurityContext>();

export function runWithSecurityContext<T>(ctx: SecurityContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** The current request's security context, or `undefined` for public/unbound code. */
export function getSecurityContext(): SecurityContext | undefined {
  return storage.getStore();
}

/** Like `getSecurityContext` but throws if there is none — use where auth is guaranteed. */
export function requireSecurityContext(): SecurityContext {
  const ctx = storage.getStore();
  if (!ctx) throw new Error('No security context bound to this execution');
  return ctx;
}
