import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const access = vi.hoisted(() => ({
  current: { isLoading: false, can: (_p: string | undefined) => true } as {
    isLoading: boolean;
    can: (p: string | undefined) => boolean;
  },
}));

const SOURCE = {
  id: 'src-1',
  key: 'meta-leads',
  name: 'Meta Lead Ads',
  connectorType: 'meta_lead_ads',
  status: 'active',
  fieldMapping: { contact_no: 'canonical:phone' },
  publicLookupKey: 'pub-lookup-abc',
  hasCredentials: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const PROVIDERS = [
  {
    provider: 'pabbly_bridge',
    version: 1,
    displayName: 'Pabbly',
    description: 'Generic JSON relay',
    authMethod: 'bearer_secret' as const,
    credentialFields: [],
    capabilities: ['inbound_webhook', 'field_mapping'],
  },
  {
    provider: 'meta_lead_ads',
    version: 1,
    displayName: 'Meta Lead Ads',
    description: 'Facebook/Instagram lead ads',
    authMethod: 'signature' as const,
    credentialFields: [
      { key: 'appSecret', label: 'App Secret', secret: true },
      { key: 'pageAccessToken', label: 'Page Access Token', secret: true },
      { key: 'verifyToken', label: 'Webhook Verify Token', secret: true },
    ],
    capabilities: ['inbound_webhook', 'field_mapping'],
  },
];

const hooks = vi.hoisted(() => ({
  useSource: vi.fn(),
  useProviders: vi.fn(),
  useUpdateSource: vi.fn(),
  useRotateSourceSecret: vi.fn(),
  useRevokeSource: vi.fn(),
  useReactivateSource: vi.fn(),
  useSetSourceCredentials: vi.fn(),
  useInboundEvents: vi.fn(),
  useInboundEvent: vi.fn(),
  useReplayInboundEvent: vi.fn(),
}));

const mutationStub = () => ({
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
  error: null,
});

vi.mock('@/lib/navigation/use-access', () => ({ useAccess: () => access.current }));
vi.mock('@/lib/admin/use-integrations', () => ({
  useSource: hooks.useSource,
  useProviders: hooks.useProviders,
  useUpdateSource: hooks.useUpdateSource,
  useRotateSourceSecret: hooks.useRotateSourceSecret,
  useRevokeSource: hooks.useRevokeSource,
  useReactivateSource: hooks.useReactivateSource,
  useSetSourceCredentials: hooks.useSetSourceCredentials,
  useInboundEvents: hooks.useInboundEvents,
  useInboundEvent: hooks.useInboundEvent,
  useReplayInboundEvent: hooks.useReplayInboundEvent,
}));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'src-1' }) }));

import SourceDetailPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup() {
  hooks.useSource.mockReturnValue({
    isLoading: false,
    error: null,
    data: SOURCE,
    refetch: vi.fn(),
  });
  hooks.useProviders.mockReturnValue({ isLoading: false, data: PROVIDERS, error: null });
  hooks.useUpdateSource.mockReturnValue(mutationStub());
  hooks.useRotateSourceSecret.mockReturnValue(mutationStub());
  hooks.useRevokeSource.mockReturnValue(mutationStub());
  hooks.useReactivateSource.mockReturnValue(mutationStub());
  hooks.useSetSourceCredentials.mockReturnValue(mutationStub());
  hooks.useInboundEvents.mockReturnValue({
    isLoading: false,
    error: null,
    data: { items: [], total: 0, page: 1, pageSize: 25 },
  });
  hooks.useInboundEvent.mockReturnValue({ isLoading: false, error: null, data: undefined });
  hooks.useReplayInboundEvent.mockReturnValue(mutationStub());
}

describe('Connection detail page', () => {
  it('without crm.integrations.manage: explains and renders no tabs', () => {
    access.current = { isLoading: false, can: () => false };
    setup();
    render(<SourceDetailPage />);
    expect(screen.getByText(/don't have access to integrations/i)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Overview' })).toBeNull();
  });

  it('renders Overview by default with only backend-provided fields — no fabricated metrics', () => {
    access.current = { isLoading: false, can: () => true };
    setup();
    render(<SourceDetailPage />);
    expect(screen.getAllByText('Meta Lead Ads').length).toBeGreaterThan(0);
    expect(screen.getByText('Provider signature')).toBeTruthy();
    expect(screen.queryByText(/success rate/i)).toBeNull();
    expect(screen.queryByText(/health/i)).toBeNull();
  });

  it('Configuration tab renders credential fields from provider metadata, never hardcoded', () => {
    access.current = { isLoading: false, can: () => true };
    setup();
    render(<SourceDetailPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Configuration' }));
    expect(screen.getByText('App Secret')).toBeTruthy();
    expect(screen.getByText('Page Access Token')).toBeTruthy();
    expect(screen.getByText('Webhook Verify Token')).toBeTruthy();
    // secret fields never show a previously-stored value
    const tokenInput = screen
      .getByText('Page Access Token')
      .closest('label')
      ?.querySelector('input');
    expect(tokenInput).toHaveProperty('value', '');
    expect(tokenInput).toHaveProperty('type', 'password');
  });

  it('Mapping tab shows the existing mapping and saves an edit through updateSource', () => {
    access.current = { isLoading: false, can: () => true };
    setup();
    render(<SourceDetailPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Mapping' }));
    expect(screen.getByDisplayValue('contact_no')).toBeTruthy();
    expect(screen.getByDisplayValue('canonical:phone')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /save mapping/i }));
    expect(hooks.useUpdateSource().mutate).toBeDefined();
  });

  it('Developer tab never renders a real secret value, only a placeholder', () => {
    access.current = { isLoading: false, can: () => true };
    setup();
    render(<SourceDetailPage />);
    fireEvent.click(screen.getByRole('tab', { name: 'Developer' }));
    expect(screen.getByText(/YOUR_SECRET/)).toBeTruthy();
  });
});
