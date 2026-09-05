import { AppError } from '@aivoryx/shared';
import type { SecurityContext } from '../security/security-context.js';

/** Tenant + actor identity, always derived from the authenticated context. */
export interface TenantScope {
  tenantId: string;
  userId: string;
  actorMembershipId: string;
}

/** Build the scope from the security context — the client never supplies tenant/actor. */
export function scope(ctx: SecurityContext): TenantScope {
  if (!ctx.tenantId || !ctx.membership) throw new AppError('AUTH_NO_ACTIVE_TENANT');
  return { tenantId: ctx.tenantId, userId: ctx.user.id, actorMembershipId: ctx.membership.id };
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageBounds(page?: number, pageSize?: number): { page: number; pageSize: number } {
  return {
    page: Math.max(1, page ?? 1),
    pageSize: Math.min(Math.max(1, pageSize ?? 20), 100),
  };
}

/** Map a Postgres unique-violation on a *_code_uq / *_number_uq constraint to a stable code. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
