import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/client';

const api = vi.hoisted(() => ({ login: vi.fn(), getMe: vi.fn(), switchTenant: vi.fn() }));
vi.mock('@/lib/api/admin', () => api);

import { SIGN_IN_MESSAGES, classifySignInFailure, signIn } from './sign-in';

const apiError = (status: number, code: string) =>
  new ApiError(status, { error: { code, message: 'x', correlationId: 'AIV-REF1' } } as never);

const membership = (over = {}) => ({
  id: 'm1',
  tenantId: 't1',
  status: 'active',
  tenantStatus: 'active',
  ...over,
});
const me = (over = {}) => ({
  user: { id: 'u' },
  isPlatformAdmin: false,
  memberships: [membership()],
  active: { membership: membership() },
  ...over,
});

afterEach(() => vi.resetAllMocks());

describe('signIn', () => {
  it('valid login: verifies the session with /auth/me and reports the resolved workspace', async () => {
    api.login.mockResolvedValue(me());
    api.getMe.mockResolvedValue(me());
    const r = await signIn('a@b.test', 'pw');
    expect(api.getMe).toHaveBeenCalledTimes(1);
    expect(r.hasWorkspace).toBe(true);
  });

  it('THE LOGIN LOOP: login 200 but /auth/me 401 (cookie dropped) -> session_not_established, never a silent success', async () => {
    api.login.mockResolvedValue(me());
    api.getMe.mockRejectedValue(apiError(401, 'AUTH_UNAUTHENTICATED'));
    await expect(signIn('a@b.test', 'pw')).rejects.toMatchObject({
      kind: 'session_not_established',
      correlationId: 'AIV-REF1',
    });
  });

  it('wrong password / unknown user -> invalid_credentials', async () => {
    api.login.mockRejectedValue(apiError(401, 'AUTH_INVALID_CREDENTIALS'));
    await expect(signIn('a@b.test', 'bad')).rejects.toMatchObject({ kind: 'invalid_credentials' });
    expect(api.getMe).not.toHaveBeenCalled();
  });

  it('auto-selects the only usable membership when none is active', async () => {
    api.login.mockResolvedValue(me());
    api.getMe.mockResolvedValue(me({ active: null }));
    api.switchTenant.mockResolvedValue(me());
    const r = await signIn('a@b.test', 'pw');
    expect(api.switchTenant).toHaveBeenCalledWith('m1');
    expect(r.hasWorkspace).toBe(true);
  });

  it('a tenant user with no usable workspace gets a workspace error, not a bounce', async () => {
    api.login.mockResolvedValue(me());
    api.getMe.mockResolvedValue(me({ active: null, memberships: [] }));
    await expect(signIn('a@b.test', 'pw')).rejects.toMatchObject({ kind: 'no_workspace' });
  });

  it('a suspended-only membership -> workspace_unavailable', async () => {
    const m = membership({ status: 'suspended' });
    api.login.mockResolvedValue(me());
    api.getMe.mockResolvedValue(me({ active: null, memberships: [m] }));
    await expect(signIn('a@b.test', 'pw')).rejects.toMatchObject({ kind: 'workspace_unavailable' });
  });

  it('a platform admin with no workspace is allowed through (lands in /platform)', async () => {
    api.login.mockResolvedValue(me());
    api.getMe.mockResolvedValue(me({ active: null, memberships: [], isPlatformAdmin: true }));
    const r = await signIn('a@b.test', 'pw');
    expect(r).toMatchObject({ hasWorkspace: false });
  });
});

describe('classifySignInFailure', () => {
  it.each([
    [apiError(403, 'AUTH_FORBIDDEN'), 'forbidden'],
    [apiError(429, 'RATE_LIMITED'), 'rate_limited'],
    [apiError(500, 'INTERNAL_ERROR'), 'server'],
    [apiError(503, 'SERVICE_UNAVAILABLE'), 'server'],
    [apiError(403, 'AUTH_MEMBERSHIP_SUSPENDED'), 'workspace_unavailable'],
    [apiError(403, 'TENANT_SUSPENDED'), 'workspace_unavailable'],
    [apiError(400, 'AUTH_NO_ACTIVE_TENANT'), 'no_workspace'],
    [new TypeError('Failed to fetch'), 'network'],
    [new SyntaxError('Unexpected token < in JSON'), 'unexpected'],
  ])('%#', (err, kind) => {
    expect(classifySignInFailure(err).kind).toBe(kind);
  });

  it('every kind has distinct user-facing copy and never leaks internals', () => {
    const texts = Object.values(SIGN_IN_MESSAGES);
    for (const t of texts) expect(t).not.toMatch(/AUTH_|stack|SQL|token|Failed to fetch/i);
    expect(SIGN_IN_MESSAGES.invalid_credentials).not.toBe(SIGN_IN_MESSAGES.session_not_established);
    expect(SIGN_IN_MESSAGES.network).not.toBe(SIGN_IN_MESSAGES.server);
  });
});
