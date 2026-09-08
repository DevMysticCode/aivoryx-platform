import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError, moduleForPermission, type ModuleKey, type PermissionKey } from '@aivoryx/shared';
import type { ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../config/config.module.js';
import { AuthService } from '../auth/auth.service.js';
import { RbacService } from '../auth/rbac.service.js';
import { SessionService } from '../auth/session.service.js';
import { EntitlementService } from '../entitlements/entitlement.service.js';
import { PlatformAdminService } from '../entitlements/platform-admin.service.js';
import {
  AUTH_ONLY_KEY,
  IS_PUBLIC_KEY,
  MODULE_KEY,
  PERMISSION_KEY,
  PLATFORM_ADMIN_KEY,
} from './security.decorators.js';
import type { SecurityContext } from './security-context.js';

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/**
 * The single global authentication + tenant-context + authorization gate
 * (ADR 0027 / 0028 / 0029, extended by ADR 0042).
 *
 * Order of failure, so the response is never more informative than it should be:
 *   1. no / bad session cookie ............ 401 AUTH_UNAUTHENTICATED
 *   2. revoked / expired session ......... 401 AUTH_SESSION_REVOKED|EXPIRED
 *   3. tenant route, no active membership  403 AUTH_NO_ACTIVE_TENANT
 *   4. active membership unusable ........ 403 AUTH_MEMBERSHIP_SUSPENDED / TENANT_SUSPENDED
 *   5. platform route, not a platform admin 403 PLATFORM_ADMIN_REQUIRED
 *   6. module not entitled for the tenant  403 ENTITLEMENT_MODULE_NOT_ENABLED
 *   7. authenticated, missing permission . 403 AUTH_FORBIDDEN
 *
 * Step 6 runs BEFORE step 7 and against the tenant's *entitlements*, so a
 * disabled module denies at the API boundary with a distinct code even when the
 * user's profile / permission sets carry the permission. Entitlement always
 * precedes user permission — the relationship is never inverted.
 */
@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
    private readonly rbac: RbacService,
    private readonly entitlements: EntitlementService,
    private readonly platformAdmins: PlatformAdminService,
    @Inject(SERVER_ENV) private readonly env: ServerEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { securityContext?: SecurityContext }>();

    const rawCookie = (req.cookies as Record<string, unknown> | undefined)?.[
      this.env.SESSION_COOKIE_NAME
    ];
    if (typeof rawCookie !== 'string' || rawCookie.length === 0) {
      throw new AppError('AUTH_UNAUTHENTICATED');
    }

    const { session, user } = await this.sessions.resolve(rawCookie);

    const authOnly = this.reflector.getAllAndOverride<boolean>(AUTH_ONLY_KEY, targets) ?? false;
    const platformAdminRequired =
      this.reflector.getAllAndOverride<boolean>(PLATFORM_ADMIN_KEY, targets) ?? false;
    const requiredPermission = this.reflector.getAllAndOverride<PermissionKey>(
      PERMISSION_KEY,
      targets,
    );
    const requiredModule = this.reflector.getAllAndOverride<ModuleKey>(MODULE_KEY, targets);

    // A platform route needs authentication + platform-admin, but NOT a tenant.
    const strictTenant =
      !platformAdminRequired &&
      (!authOnly || requiredPermission !== undefined || requiredModule !== undefined);

    const ctx: SecurityContext = {
      user,
      session: {
        id: session.id,
        activeMembershipId: session.activeMembershipId,
        expiresAt: session.expiresAt,
      },
      membership: null,
      tenantId: null,
      permissions: EMPTY_SET,
      entitledModules: EMPTY_SET,
      isPlatformAdmin: false,
    };

    // Platform-admin status is user-scoped and independent of any tenant.
    ctx.isPlatformAdmin = await this.platformAdmins.isPlatformAdmin(user.id);

    if (session.activeMembershipId) {
      try {
        const membership = await this.auth.resolveActiveTenant(user.id, session.activeMembershipId);
        ctx.membership = membership;
        ctx.tenantId = membership.tenantId;
        const rlsScope = {
          membershipId: membership.id,
          tenantId: membership.tenantId,
          userId: user.id,
        };
        const [permissions, entitledModules] = await Promise.all([
          this.rbac.permissionsForMembership(rlsScope),
          this.entitlements.getEnabledModules({
            tenantId: membership.tenantId,
            userId: user.id,
          }),
        ]);
        ctx.permissions = permissions;
        ctx.entitledModules = entitledModules;
      } catch (err) {
        // On a strict route a suspended membership / tenant is a hard failure;
        // on an auth-only route (e.g. /auth/me) we still answer, tenant-less.
        if (strictTenant) throw err;
      }
    }

    if (strictTenant && !ctx.tenantId) {
      const memberships = await this.auth.listMemberships(user.id);
      throw new AppError('AUTH_NO_ACTIVE_TENANT', {
        details: {
          memberships: memberships.map((m) => ({
            membershipId: m.id,
            tenantSlug: m.tenantSlug,
            tenantStatus: m.tenantStatus,
            membershipStatus: m.status,
          })),
        },
      });
    }

    if (platformAdminRequired && !ctx.isPlatformAdmin) {
      throw new AppError('PLATFORM_ADMIN_REQUIRED');
    }

    // --- module entitlement, BEFORE the permission check ---------------
    if (!platformAdminRequired) {
      const moduleToCheck: ModuleKey | null =
        requiredModule ?? (requiredPermission ? moduleForPermission(requiredPermission) : null);
      if (moduleToCheck && !ctx.entitledModules.has(moduleToCheck)) {
        throw new AppError('ENTITLEMENT_MODULE_NOT_ENABLED', {
          details: { module: moduleToCheck },
        });
      }
    }

    if (requiredPermission && !ctx.permissions.has(requiredPermission)) {
      throw new AppError('AUTH_FORBIDDEN', { details: { requiredPermission } });
    }

    req.securityContext = ctx;
    return true;
  }
}
