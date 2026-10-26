import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AccessRole, AvailablePermission, EffectiveAccess, Member } from '@aivoryx/contracts';
import { ApiError } from '@/lib/api/client';

const member = (overrides: Partial<Member> = {}): Member => ({
  membershipId: 'mem-1',
  userId: 'user-1',
  email: 'alice@example.test',
  name: 'Alice Example',
  status: 'active',
  roles: [],
  joinedAt: '2026-01-01T00:00:00.000Z',
  invitationPending: false,
  invitationExpiresAt: null,
  ...overrides,
});

const role = (overrides: Partial<AccessRole> = {}): AccessRole => ({
  id: 'role-1',
  key: 'sales-exec',
  name: 'Sales Executive',
  description: null,
  kind: 'profile',
  permissionKeys: ['crm.leads.read'],
  assignedCount: 0,
  ...overrides,
});

const permission = (overrides: Partial<AvailablePermission> = {}): AvailablePermission => ({
  key: 'crm.leads.read',
  module: 'CRM',
  resource: 'leads',
  action: 'read',
  description: 'View leads',
  ...overrides,
});

const effective = (overrides: Partial<EffectiveAccess> = {}): EffectiveAccess => ({
  membershipId: 'mem-1',
  userName: 'Alice Example',
  userEmail: 'alice@example.test',
  profile: null,
  permissionSets: [],
  modules: [
    {
      moduleKey: 'CRM',
      displayName: 'CRM',
      entitled: true,
      dataScope: 'COMPANY',
      permissions: [
        {
          key: 'crm.leads.read',
          resource: 'leads',
          action: 'read',
          description: 'View leads',
          granted: true,
        },
      ],
    },
    {
      moduleKey: 'FINANCE',
      displayName: 'Finance',
      entitled: false,
      dataScope: null,
      permissions: [],
    },
  ],
  platformPermissions: [],
  ...overrides,
});

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const hooks = vi.hoisted(() => ({
  members: { isLoading: false, error: null as unknown, data: [] as Member[], refetch: vi.fn() },
  roles: { isLoading: false, error: null as unknown, data: [] as AccessRole[], refetch: vi.fn() },
  available: { isLoading: false, error: null as unknown, data: [] as AvailablePermission[] },
  effectiveAccess: {
    isLoading: false,
    error: null as unknown,
    data: null as EffectiveAccess | null,
    refetch: vi.fn(),
  },
  createRole: { mutateAsync: vi.fn(), isPending: false, error: null as unknown },
  updateRole: { mutateAsync: vi.fn(), isPending: false, error: null as unknown },
  deleteRole: { mutateAsync: vi.fn(), isPending: false, error: null as unknown },
  assignProfile: { mutateAsync: vi.fn(), isPending: false, error: null as unknown },
  addPermissionSet: { mutateAsync: vi.fn(), isPending: false, error: null as unknown },
  removePermissionSet: { mutateAsync: vi.fn(), isPending: false, error: null as unknown },
}));

vi.mock('@/lib/admin/use-admin', () => ({ useMembers: () => hooks.members }));
vi.mock('@/lib/access/use-access-admin', () => ({
  useAccessRoles: () => hooks.roles,
  useAvailablePermissions: () => hooks.available,
  useEffectiveAccess: () => hooks.effectiveAccess,
  useCreateAccessRole: () => hooks.createRole,
  useUpdateAccessRole: () => hooks.updateRole,
  useDeleteAccessRole: () => hooks.deleteRole,
  useAssignProfile: () => hooks.assignProfile,
  useAddPermissionSet: () => hooks.addPermissionSet,
  useRemovePermissionSet: () => hooks.removePermissionSet,
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));

import AccessPage from './page';

function resetHooks() {
  hooks.members = { isLoading: false, error: null, data: [], refetch: vi.fn() };
  hooks.roles = { isLoading: false, error: null, data: [], refetch: vi.fn() };
  hooks.available = { isLoading: false, error: null, data: [] };
  hooks.effectiveAccess = { isLoading: false, error: null, data: null, refetch: vi.fn() };
  hooks.createRole = { mutateAsync: vi.fn(), isPending: false, error: null };
  hooks.updateRole = { mutateAsync: vi.fn(), isPending: false, error: null };
  hooks.deleteRole = { mutateAsync: vi.fn(), isPending: false, error: null };
  hooks.assignProfile = { mutateAsync: vi.fn(), isPending: false, error: null };
  hooks.addPermissionSet = { mutateAsync: vi.fn(), isPending: false, error: null };
  hooks.removePermissionSet = { mutateAsync: vi.fn(), isPending: false, error: null };
  toast.success.mockClear();
  toast.error.mockClear();
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resetHooks();
});

describe('Access page', () => {
  it('shows a loading state, then an empty state, for the Users tab', () => {
    resetHooks();
    hooks.members.isLoading = true;
    const { rerender } = render(<AccessPage />);
    hooks.members = { ...hooks.members, isLoading: false, data: [] };
    rerender(<AccessPage />);
    expect(screen.getByText(/No members to configure yet/i)).toBeTruthy();
  });

  it('shows an error note when members fail to load', () => {
    resetHooks();
    hooks.members.error = new Error('network down');
    render(<AccessPage />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('selecting an active member shows their effective access, module-by-module', () => {
    resetHooks();
    hooks.members.data = [member(), member({ membershipId: 'mem-2', status: 'invited' })];
    hooks.effectiveAccess.data = effective();
    render(<AccessPage />);
    // invited members are excluded from the configurable list (only one entry, not two)
    expect(screen.getAllByText('Alice Example')).toHaveLength(1);
    expect(screen.getByText(/Effective access/).textContent).toContain('Alice Example');
    expect(screen.getByText('CRM')).toBeTruthy();
    expect(screen.getByText(/Not available for this company/i)).toBeTruthy();
    expect(screen.getByText(/leads · read/i)).toBeTruthy();
  });

  it('assigning a profile calls the API with the chosen role and data scope', async () => {
    resetHooks();
    hooks.members.data = [member()];
    hooks.effectiveAccess.data = effective();
    hooks.roles.data = [role()];
    render(<AccessPage />);
    const comboboxes = screen.getAllByRole('combobox');
    fireEvent.change(comboboxes[0]!, { target: { value: 'role-1' } });
    fireEvent.change(comboboxes[1]!, { target: { value: 'TEAM' } });
    fireEvent.click(screen.getByText('Apply'));
    await waitFor(() =>
      expect(hooks.assignProfile.mutateAsync).toHaveBeenCalledWith({
        roleId: 'role-1',
        dataScope: 'TEAM',
      }),
    );
  });

  it('Profiles tab: empty state, then creating one sends the picked permissions', async () => {
    resetHooks();
    hooks.available.data = [permission()];
    render(<AccessPage />);
    fireEvent.click(screen.getByText('Profiles'));
    expect(screen.getByText('No profiles yet')).toBeTruthy();

    fireEvent.click(screen.getByText('New profile'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('Sales Executive'), {
      target: { value: 'Field Agent' },
    });
    fireEvent.click(within(dialog).getByText('View leads'));
    fireEvent.click(within(dialog).getByText('Create profile'));
    await waitFor(() =>
      expect(hooks.createRole.mutateAsync).toHaveBeenCalledWith({
        name: 'Field Agent',
        description: undefined,
        permissionKeys: ['crm.leads.read'],
      }),
    );
  });

  it('rejects creating a role with no name, without calling the API', () => {
    resetHooks();
    render(<AccessPage />);
    fireEvent.click(screen.getByText('Profiles'));
    fireEvent.click(screen.getByText('New profile'));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Create profile'));
    expect(hooks.createRole.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText(/Give this profile a name/i)).toBeTruthy();
  });

  it('a permission outside the tenant entitlement is explained, not shown as a generic failure', async () => {
    resetHooks();
    hooks.available.data = [permission()];
    hooks.createRole.mutateAsync.mockRejectedValue(
      new ApiError(422, {
        error: {
          code: 'ACCESS_PERMISSION_NOT_AVAILABLE',
          message: 'not available',
          correlationId: 'AIV-1',
          details: { module: 'FINANCE' },
        },
      }),
    );
    render(<AccessPage />);
    fireEvent.click(screen.getByText('Profiles'));
    fireEvent.click(screen.getByText('New profile'));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('Sales Executive'), {
      target: { value: 'Finance Viewer' },
    });
    fireEvent.click(within(dialog).getByText('Create profile'));
    expect(
      await within(dialog).findByText(/FINANCE your company is not entitled to/i),
    ).toBeTruthy();
  });

  it('deleting a profile still in use is rejected by the server and surfaced as a toast', async () => {
    resetHooks();
    hooks.roles.data = [role({ assignedCount: 2 })];
    hooks.deleteRole.mutateAsync.mockRejectedValue(
      new ApiError(409, {
        error: {
          code: 'ACCESS_PROFILE_IN_USE',
          message: 'That profile is still assigned to one or more members.',
          correlationId: 'AIV-2',
        },
      }),
    );
    render(<AccessPage />);
    fireEvent.click(screen.getByText('Profiles'));
    fireEvent.click(screen.getByLabelText('Delete Sales Executive'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/assigned to 2 member/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByText('Delete'));
    await waitFor(() => expect(hooks.deleteRole.mutateAsync).toHaveBeenCalledWith('role-1'));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'That profile is still assigned to one or more members.',
      ),
    );
  });

  it('deleting an unused profile succeeds and shows a success toast', async () => {
    resetHooks();
    hooks.roles.data = [role({ assignedCount: 0 })];
    render(<AccessPage />);
    fireEvent.click(screen.getByText('Profiles'));
    fireEvent.click(screen.getByLabelText('Delete Sales Executive'));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Delete'));
    await waitFor(() => expect(hooks.deleteRole.mutateAsync).toHaveBeenCalledWith('role-1'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('profile deleted'));
  });

  it('Permission sets tab lists kind-appropriate copy and roles independently of Profiles', () => {
    resetHooks();
    hooks.roles.data = [role({ id: 'ps-1', name: 'Finance Read Only', kind: 'permission_set' })];
    render(<AccessPage />);
    fireEvent.click(screen.getByText('Permission sets'));
    expect(screen.getByText(/additive/i)).toBeTruthy();
    expect(screen.getByText('Finance Read Only')).toBeTruthy();
  });
});
