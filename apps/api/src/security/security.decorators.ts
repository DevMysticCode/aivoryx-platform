import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiCookieAuth } from '@nestjs/swagger';
import type { Request } from 'express';
import type { PermissionKey } from '@aivoryx/shared';
import type {
  SecurityContext,
  SecurityMembership,
  SecuritySession,
  SecurityUser,
} from './security-context.js';

/**
 * Route metadata read by `SecurityGuard`.
 *
 *  - default (no decorator): authenticated **and** a resolved active tenant.
 *  - `@Public()`:            no authentication at all (health, login).
 *  - `@AuthOnly()`:          authenticated, tenant not required (/auth/me,
 *                            /auth/logout, /auth/switch-tenant).
 *  - `@RequirePermission()`: authenticated + tenant + the given permission.
 */
export const IS_PUBLIC_KEY = 'security:isPublic';
export const AUTH_ONLY_KEY = 'security:authOnly';
export const PERMISSION_KEY = 'security:permission';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const AuthOnly = () => applyDecorators(SetMetadata(AUTH_ONLY_KEY, true), ApiCookieAuth());

export const RequirePermission = (permission: PermissionKey) =>
  applyDecorators(SetMetadata(PERMISSION_KEY, permission), ApiCookieAuth());

function contextFromRequest(ctx: ExecutionContext): SecurityContext {
  const req = ctx.switchToHttp().getRequest<Request & { securityContext?: SecurityContext }>();
  const sc = req.securityContext;
  if (!sc) {
    // Should never happen: the guard populates this before any handler runs.
    throw new Error('securityContext missing — is SecurityGuard registered?');
  }
  return sc;
}

/** Full security context. */
export const Security = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SecurityContext => contextFromRequest(ctx),
);

/** The authenticated user. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SecurityUser => contextFromRequest(ctx).user,
);

/** The current session. */
export const CurrentSession = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SecuritySession => contextFromRequest(ctx).session,
);

/** The active membership (present on tenant-scoped routes). */
export const ActiveMembership = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SecurityMembership | null =>
    contextFromRequest(ctx).membership,
);

/** The active tenant id (present on tenant-scoped routes). */
export const ActiveTenantId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | null => contextFromRequest(ctx).tenantId,
);
