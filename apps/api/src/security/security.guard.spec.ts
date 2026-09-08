import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from '@aivoryx/shared';
import type { ServerEnv } from '@aivoryx/config';
import type { AuthService } from '../auth/auth.service.js';
import type { RbacService } from '../auth/rbac.service.js';
import type { SessionService } from '../auth/session.service.js';
import type { EntitlementService } from '../entitlements/entitlement.service.js';
import type { PlatformAdminService } from '../entitlements/platform-admin.service.js';
import {
  AUTH_ONLY_KEY,
  IS_PUBLIC_KEY,
  MODULE_KEY,
  PERMISSION_KEY,
  PLATFORM_ADMIN_KEY,
} from './security.decorators.js';
import { SecurityGuard } from './security.guard.js';

const COOKIE = 'aivoryx_session';

const baseUser = { id: 'user-1', email: 'u@x.test', status: 'active' as const };
const baseSession = {
  id: 'sess-1',
  userId: 'user-1',
  activeMembershipId: null as string | null,
  expiresAt: new Date(Date.now() + 3_600_000),
};
const activeMembership = {
  id: 'mem-1',
  tenantId: 'ten-1',
  tenantSlug: 'ten-1',
  status: 'active' as const,
};

interface Stubs {
  meta?: Record<string, unknown>;
  resolve?: () => Promise<{ session: typeof baseSession; user: typeof baseUser }>;
  resolveActiveTenant?: () => Promise<typeof activeMembership>;
  permissions?: Set<string>;
  /** module keys the tenant is entitled to; defaults to every module */
  entitledModules?: Set<string>;
  isPlatformAdmin?: boolean;
  memberships?: Array<{ id: string; tenantSlug: string; tenantStatus: string; status: string }>;
  noCookie?: boolean;
  activeMembershipId?: string | null;
}

const ALL_MODULES = new Set(['CRM', 'FIELD', 'SUPPLY', 'COMMERCIAL', 'EPC', 'FINANCE', 'HR']);

function makeGuard(stubs: Stubs = {}) {
  const req = {
    cookies: stubs.noCookie ? {} : { [COOKIE]: 'raw-token' },
    securityContext: undefined as unknown,
  };
  const reflector = {
    getAllAndOverride: (key: string) => (stubs.meta ?? {})[key],
  };
  const sessions = {
    resolve:
      stubs.resolve ??
      (async () => ({
        session: { ...baseSession, activeMembershipId: stubs.activeMembershipId ?? null },
        user: baseUser,
      })),
  } as unknown as SessionService;
  const auth = {
    resolveActiveTenant: stubs.resolveActiveTenant ?? (async () => activeMembership),
    listMemberships: async () => stubs.memberships ?? [],
  } as unknown as AuthService;
  const rbac = {
    permissionsForMembership: async () => stubs.permissions ?? new Set<string>(),
  } as unknown as RbacService;
  const entitlements = {
    getEnabledModules: async () => stubs.entitledModules ?? new Set(ALL_MODULES),
  } as unknown as EntitlementService;
  const platformAdmins = {
    isPlatformAdmin: async () => stubs.isPlatformAdmin ?? false,
  } as unknown as PlatformAdminService;
  const env = { SESSION_COOKIE_NAME: COOKIE } as ServerEnv;

  const guard = new SecurityGuard(
    reflector as never,
    sessions,
    auth,
    rbac,
    entitlements,
    platformAdmins,
    env,
  );
  const ctx = {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;

  return { guard, ctx, req };
}

async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toMatchObject({ code });
}

describe('SecurityGuard', () => {
  it('lets a @Public() route through without a cookie', async () => {
    const { guard, ctx } = makeGuard({ meta: { [IS_PUBLIC_KEY]: true }, noCookie: true });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects a missing session cookie with 401 AUTH_UNAUTHENTICATED', async () => {
    const { guard, ctx } = makeGuard({ noCookie: true });
    await expectCode(guard.canActivate(ctx), 'AUTH_UNAUTHENTICATED');
  });

  it('propagates a revoked/expired session error from resolve', async () => {
    const { guard, ctx } = makeGuard({
      resolve: async () => {
        throw new AppError('AUTH_SESSION_REVOKED');
      },
    });
    await expectCode(guard.canActivate(ctx), 'AUTH_SESSION_REVOKED');
  });

  it('passes an @AuthOnly() route with a valid session and no tenant', async () => {
    const { guard, ctx, req } = makeGuard({ meta: { [AUTH_ONLY_KEY]: true } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.securityContext as { tenantId: string | null }).tenantId).toBeNull();
    expect((req.securityContext as { user: { id: string } }).user.id).toBe('user-1');
  });

  it('rejects a tenant-scoped route when the session has no active membership', async () => {
    const { guard, ctx } = makeGuard({
      memberships: [{ id: 'mem-1', tenantSlug: 'ten-1', tenantStatus: 'active', status: 'active' }],
    });
    await expectCode(guard.canActivate(ctx), 'AUTH_NO_ACTIVE_TENANT');
  });

  it('resolves tenant + permissions and passes when the permission is held', async () => {
    const { guard, ctx, req } = makeGuard({
      meta: { [PERMISSION_KEY]: 'memberships.read' },
      activeMembershipId: 'mem-1',
      permissions: new Set(['memberships.read', 'roles.read']),
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.securityContext as { tenantId: string | null }).tenantId).toBe('ten-1');
  });

  it('returns 403 AUTH_FORBIDDEN when the required permission is missing', async () => {
    const { guard, ctx } = makeGuard({
      meta: { [PERMISSION_KEY]: 'roles.delete' },
      activeMembershipId: 'mem-1',
      permissions: new Set(['memberships.read']),
    });
    await expectCode(guard.canActivate(ctx), 'AUTH_FORBIDDEN');
  });

  it('a suspended membership fails a strict route but is swallowed on @AuthOnly()', async () => {
    const strict = makeGuard({
      activeMembershipId: 'mem-1',
      resolveActiveTenant: async () => {
        throw new AppError('AUTH_MEMBERSHIP_SUSPENDED');
      },
    });
    await expectCode(strict.guard.canActivate(strict.ctx), 'AUTH_MEMBERSHIP_SUSPENDED');

    const lenient = makeGuard({
      meta: { [AUTH_ONLY_KEY]: true },
      activeMembershipId: 'mem-1',
      resolveActiveTenant: async () => {
        throw new AppError('AUTH_MEMBERSHIP_SUSPENDED');
      },
    });
    await expect(lenient.guard.canActivate(lenient.ctx)).resolves.toBe(true);
    expect((lenient.req.securityContext as { tenantId: string | null }).tenantId).toBeNull();
  });

  it('distinguishes 401 (unauthenticated) from 403 (no permission) on a permission route', async () => {
    // unauthenticated -> 401
    const anon = makeGuard({ meta: { [PERMISSION_KEY]: 'memberships.read' }, noCookie: true });
    await expectCode(anon.guard.canActivate(anon.ctx), 'AUTH_UNAUTHENTICATED');
    // authenticated, no permission -> 403
    const authed = makeGuard({
      meta: { [PERMISSION_KEY]: 'memberships.read' },
      activeMembershipId: 'mem-1',
      permissions: new Set<string>(),
    });
    await expectCode(authed.guard.canActivate(authed.ctx), 'AUTH_FORBIDDEN');
  });

  // --- Phase 13 (ADR 0042): module entitlement + platform admin -----

  it('denies a module permission the tenant is NOT entitled to, BEFORE the permission check', async () => {
    const { guard, ctx } = makeGuard({
      meta: { [PERMISSION_KEY]: 'hr.employee.read' },
      activeMembershipId: 'mem-1',
      permissions: new Set(['hr.employee.read']), // user HAS the permission
      entitledModules: new Set(['CRM']), // …but HR is not entitled
    });
    await expectCode(guard.canActivate(ctx), 'ENTITLEMENT_MODULE_NOT_ENABLED');
  });

  it('allows a module permission when the module IS entitled and the permission is held', async () => {
    const { guard, ctx, req } = makeGuard({
      meta: { [PERMISSION_KEY]: 'crm.leads.read' },
      activeMembershipId: 'mem-1',
      permissions: new Set(['crm.leads.read']),
      entitledModules: new Set(['CRM']),
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect([...(req.securityContext as { entitledModules: Set<string> }).entitledModules]).toEqual([
      'CRM',
    ]);
  });

  it('entitlement failure is distinguishable from permission failure', async () => {
    // entitled, but no permission -> AUTH_FORBIDDEN
    const noPerm = makeGuard({
      meta: { [PERMISSION_KEY]: 'crm.leads.read' },
      activeMembershipId: 'mem-1',
      permissions: new Set<string>(),
      entitledModules: new Set(['CRM']),
    });
    await expectCode(noPerm.guard.canActivate(noPerm.ctx), 'AUTH_FORBIDDEN');
    // has permission, but not entitled -> ENTITLEMENT_MODULE_NOT_ENABLED
    const noEnt = makeGuard({
      meta: { [PERMISSION_KEY]: 'crm.leads.read' },
      activeMembershipId: 'mem-1',
      permissions: new Set(['crm.leads.read']),
      entitledModules: new Set<string>(),
    });
    await expectCode(noEnt.guard.canActivate(noEnt.ctx), 'ENTITLEMENT_MODULE_NOT_ENABLED');
  });

  it('platform / identity permissions are never gated by entitlement', async () => {
    const { guard, ctx } = makeGuard({
      meta: { [PERMISSION_KEY]: 'roles.read' },
      activeMembershipId: 'mem-1',
      permissions: new Set(['roles.read']),
      entitledModules: new Set<string>(), // nothing entitled
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('@RequireModule() gates a route by entitlement alone', async () => {
    const denied = makeGuard({
      meta: { [MODULE_KEY]: 'FINANCE' },
      activeMembershipId: 'mem-1',
      entitledModules: new Set(['CRM']),
    });
    await expectCode(denied.guard.canActivate(denied.ctx), 'ENTITLEMENT_MODULE_NOT_ENABLED');

    const allowed = makeGuard({
      meta: { [MODULE_KEY]: 'FINANCE' },
      activeMembershipId: 'mem-1',
      entitledModules: new Set(['CRM', 'FINANCE']),
    });
    await expect(allowed.guard.canActivate(allowed.ctx)).resolves.toBe(true);
  });

  it('@PlatformAdmin() denies a non-platform-admin and needs no tenant', async () => {
    const denied = makeGuard({
      meta: { [PLATFORM_ADMIN_KEY]: true },
      isPlatformAdmin: false,
    });
    await expectCode(denied.guard.canActivate(denied.ctx), 'PLATFORM_ADMIN_REQUIRED');

    const allowed = makeGuard({
      meta: { [PLATFORM_ADMIN_KEY]: true },
      isPlatformAdmin: true, // no active membership at all
    });
    await expect(allowed.guard.canActivate(allowed.ctx)).resolves.toBe(true);
    expect((allowed.req.securityContext as { isPlatformAdmin: boolean }).isPlatformAdmin).toBe(
      true,
    );
  });

  it('a tenant user cannot reach a @PlatformAdmin() route even with every permission', async () => {
    const { guard, ctx } = makeGuard({
      meta: { [PLATFORM_ADMIN_KEY]: true },
      isPlatformAdmin: false,
      activeMembershipId: 'mem-1',
      permissions: new Set(['platform.modules.provision', 'roles.read']),
    });
    await expectCode(guard.canActivate(ctx), 'PLATFORM_ADMIN_REQUIRED');
  });
});
