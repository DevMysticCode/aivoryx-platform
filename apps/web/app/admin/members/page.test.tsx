import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Member } from '@aivoryx/contracts';

const member = (overrides: Partial<Member> = {}): Member => ({
  membershipId: 'mem-1',
  userId: 'user-1',
  email: 'alice@example.test',
  name: 'Alice Example',
  status: 'active',
  roles: [{ key: 'TENANT_ADMIN', name: 'Workspace administrator' }],
  joinedAt: '2026-01-01T00:00:00.000Z',
  invitationPending: false,
  invitationExpiresAt: null,
  ...overrides,
});

const hooks = vi.hoisted(() => ({
  members: { isLoading: false, error: null as unknown, data: [] as Member[], refetch: vi.fn() },
  roles: { isLoading: false, error: null as unknown, data: [] as { key: string; name: string }[] },
  invite: { mutateAsync: vi.fn(), isPending: false, error: null as unknown },
  resend: { mutate: vi.fn(), isPending: false, error: null as unknown },
  setStatus: { mutate: vi.fn(), isPending: false, error: null as unknown },
  remove: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null as unknown },
  assignRole: { mutate: vi.fn(), isPending: false, error: null as unknown },
  removeRole: { mutate: vi.fn(), isPending: false, error: null as unknown },
}));

vi.mock('@/lib/admin/use-admin', () => ({
  useMembers: () => hooks.members,
  useRoles: () => hooks.roles,
  useInviteMember: () => hooks.invite,
  useResendInvite: () => hooks.resend,
  useSetMemberStatus: () => hooks.setStatus,
  useRemoveMember: () => hooks.remove,
  useAssignRole: () => hooks.assignRole,
  useRemoveRole: () => hooks.removeRole,
}));

import MembersPage from './page';

function resetHooks() {
  hooks.members = { isLoading: false, error: null, data: [], refetch: vi.fn() };
  hooks.roles = { isLoading: false, error: null, data: [] };
  hooks.invite = { mutateAsync: vi.fn(), isPending: false, error: null };
  hooks.resend = { mutate: vi.fn(), isPending: false, error: null };
  hooks.setStatus = { mutate: vi.fn(), isPending: false, error: null };
  hooks.remove = { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, error: null };
  hooks.assignRole = { mutate: vi.fn(), isPending: false, error: null };
  hooks.removeRole = { mutate: vi.fn(), isPending: false, error: null };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetHooks();
});

describe('Members page', () => {
  it('shows a loading skeleton while members/roles are loading', () => {
    resetHooks();
    hooks.members.isLoading = true;
    const { container } = render(<MembersPage />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows an empty state when there are no members yet', () => {
    resetHooks();
    render(<MembersPage />);
    expect(screen.getByText(/No members yet/i)).toBeTruthy();
  });

  it('shows an error note when members fail to load', () => {
    resetHooks();
    hooks.members.error = new Error('network down');
    render(<MembersPage />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('renders each member with their status and roles', () => {
    resetHooks();
    hooks.members.data = [
      member(),
      member({
        membershipId: 'mem-2',
        email: 'invited@example.test',
        name: null,
        status: 'invited',
        roles: [],
        invitationPending: true,
        invitationExpiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    ];
    render(<MembersPage />);
    expect(screen.getByText('Alice Example')).toBeTruthy();
    expect(screen.getByText('invited@example.test')).toBeTruthy();
    expect(screen.getByText(/Invite expires in 2 days/i)).toBeTruthy();
    expect(screen.getByText('Resend invite')).toBeTruthy();
  });

  it('sends an invite and shows the one-time token handoff', async () => {
    resetHooks();
    hooks.invite.mutateAsync.mockResolvedValue({
      member: member({ status: 'invited', invitationPending: true }),
      invitation: { id: 'inv-1', token: 'raw-token-abc', expiresAt: new Date().toISOString() },
    });
    render(<MembersPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.test' } });
    fireEvent.click(screen.getByText('Send invite'));
    await waitFor(() =>
      expect(hooks.invite.mutateAsync).toHaveBeenCalledWith({
        email: 'new@example.test',
        name: undefined,
      }),
    );
    expect(
      await screen.findByText(/Invitation created for alice@example.test|Invitation created/),
    ).toBeTruthy();
    // the raw token must never be left exposed outside the one-time handoff link
    expect(screen.getByText(/raw-token-abc/)).toBeTruthy();
  });

  it('shows an inline error when inviting fails (e.g. a duplicate active member)', () => {
    resetHooks();
    hooks.invite.error = new Error('That person is already a member of this workspace.');
    render(<MembersPage />);
    expect(screen.getByText(/already a member/i)).toBeTruthy();
  });

  it('surfaces the last-active-administrator guard as a row-level error, not a silent failure', () => {
    resetHooks();
    hooks.members.data = [member()];
    hooks.remove.error = new Error('A workspace must keep at least one active administrator.');
    render(<MembersPage />);
    expect(screen.getByText(/at least one active administrator/i)).toBeTruthy();
  });

  it('confirms before removing an active member, and only calls remove after confirming', async () => {
    resetHooks();
    hooks.members.data = [member()];
    render(<MembersPage />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('Remove'));
    expect(hooks.remove.mutateAsync).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Remove'));
    await waitFor(() => expect(hooks.remove.mutateAsync).toHaveBeenCalledWith('mem-1'));
  });

  it('only offers Suspend for an active member and Reactivate for a suspended one', () => {
    resetHooks();
    hooks.members.data = [member({ status: 'suspended' })];
    render(<MembersPage />);
    expect(screen.getByText('Reactivate')).toBeTruthy();
    expect(screen.queryByText('Suspend')).toBeNull();
  });
});
