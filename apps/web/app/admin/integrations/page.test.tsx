import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const access = vi.hoisted(() => ({
  current: { isLoading: false, can: (_p: string | undefined) => false } as {
    isLoading: boolean;
    can: (p: string | undefined) => boolean;
  },
}));
const hooks = vi.hoisted(() => ({
  useSources: vi.fn(() => ({ isLoading: false, data: [], error: null })),
  useProviders: vi.fn(() => ({ isLoading: false, data: [], error: null })),
  mutation: () => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false, error: null }),
}));

vi.mock('@/lib/navigation/use-access', () => ({ useAccess: () => access.current }));
vi.mock('@/lib/admin/use-integrations', () => ({
  useSources: hooks.useSources,
  useProviders: hooks.useProviders,
  useCreateSource: hooks.mutation,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/admin/integrations' }));

import IntegrationsAdminPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Integrations connections page permission gate', () => {
  it('without crm.integrations.manage: explains, and never calls the connector APIs', () => {
    access.current = { isLoading: false, can: (p) => p === 'memberships.read' };
    render(<IntegrationsAdminPage />);
    expect(screen.getByText(/don't have access to integrations/i)).toBeTruthy();
    expect(hooks.useSources).not.toHaveBeenCalled();
    expect(screen.queryByText('Connect a source')).toBeNull();
  });

  it('with crm.integrations.manage: renders the connector center', () => {
    access.current = { isLoading: false, can: (p) => p === 'crm.integrations.manage' };
    render(<IntegrationsAdminPage />);
    expect(screen.getByText('Connect a source')).toBeTruthy();
    expect(hooks.useSources).toHaveBeenCalled();
  });

  it('while the session is loading it shows neither the page nor the no-access message', () => {
    access.current = { isLoading: true, can: () => false };
    render(<IntegrationsAdminPage />);
    expect(screen.queryByText(/don't have access/i)).toBeNull();
    expect(screen.queryByText('Connect a source')).toBeNull();
  });

  it('links each connection to its detail page, never rendering credential fields inline', () => {
    access.current = { isLoading: false, can: (p) => p === 'crm.integrations.manage' };
    hooks.useSources.mockReturnValue({
      isLoading: false,
      error: null,
      data: [
        {
          id: 'src-1',
          key: 'website',
          name: 'Website form',
          connectorType: 'pabbly_bridge',
          status: 'active',
          fieldMapping: {},
          publicLookupKey: null,
          hasCredentials: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    render(<IntegrationsAdminPage />);
    const link = screen.getByRole('link', { name: /Website form/i });
    expect(link.getAttribute('href')).toBe('/admin/integrations/sources/src-1');
    expect(screen.queryByLabelText(/app secret/i)).toBeNull();
  });
});
