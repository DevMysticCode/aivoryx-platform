import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from '@aivoryx/shared';
import type { ServerEnv } from '@aivoryx/config';
import type { AuthService } from '../auth/auth.service.js';
import type { RbacService } from '../auth/rbac.service.js';
import type { SessionService } from '../auth/session.service.js';
import { AUTH_ONLY_KEY, IS_PUBLIC_KEY, PERMISSION_KEY } from './security.decorators.js';
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
  memberships?: Array<{ id: string; tenantSlug: string; tenantStatus: string; status: string }>;
  noCookie?: boolean;
  activeMembershipId?: string | null;
}

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
  const env = { SESSION_COOKIE_NAME: COOKIE } as ServerEnv;

  const guard = new SecurityGuard(reflector as never, sessions, auth, rbac, env);
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
});
