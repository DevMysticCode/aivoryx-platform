import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { CompanyProfile } from '@aivoryx/contracts';

const profile = (overrides: Partial<CompanyProfile> = {}): CompanyProfile =>
  ({
    workspaceName: 'Acme Field Services',
    displayName: 'Acme',
    themePreset: 'aivoryx-teal',
    primaryColor: null,
    secondaryColor: null,
    accentColor: null,
    documentLogoMode: 'company',
    documentAccentColor: null,
    documentFooter: '',
    documentShowCustomerLogo: false,
    hasLogo: false,
    hasCompactLogo: false,
    hasLightLogo: false,
    hasDarkLogo: false,
    hasFavicon: false,
    hasLoginLogo: false,
    hasDocumentLogo: false,
    loginWelcome: null,
    loginDescription: null,
    loginShowPoweredBy: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as CompanyProfile;

const perms = vi.hoisted(() => ({ current: [] as string[] }));
const hooks = vi.hoisted(() => ({
  profile: { isLoading: false, error: null as unknown, data: null as CompanyProfile | null },
  save: { mutate: vi.fn(), isPending: false, error: null as unknown },
  upload: { mutate: vi.fn(), isPending: false, error: null as unknown },
  remove: { mutateAsync: vi.fn(), isPending: false, error: null as unknown },
}));

vi.mock('@/components/supply/supply-shell', () => ({ usePermissions: () => perms.current }));
vi.mock('@/components/theme-provider', () => ({ useAppearance: () => ({ resolved: 'light' }) }));
vi.mock('@/lib/admin/use-admin', () => ({
  useMe: () => ({
    data: { active: { membership: { tenantSlug: 'acme' } } },
  }),
}));
vi.mock('@/lib/settings/use-settings', () => ({
  useCompanyProfile: () => hooks.profile,
  useUpdateCompanyProfile: () => hooks.save,
  useUploadLogo: () => hooks.upload,
  useRemoveLogo: () => hooks.remove,
  useLogoObjectUrl: () => null,
}));

import BrandingSettingsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  perms.current = [];
  hooks.profile = { isLoading: false, error: null, data: null };
  hooks.save = { mutate: vi.fn(), isPending: false, error: null };
  hooks.upload = { mutate: vi.fn(), isPending: false, error: null };
  hooks.remove = { mutateAsync: vi.fn(), isPending: false, error: null };
});

describe('Branding settings page', () => {
  it('without settings.company.read: explains, and renders no branding controls', () => {
    render(<BrandingSettingsPage />);
    expect(screen.getByText(/don.t have access to branding settings/i)).toBeTruthy();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('shows a loading skeleton while the profile is loading', () => {
    perms.current = ['settings.company.read'];
    hooks.profile.isLoading = true;
    const { container } = render(<BrandingSettingsPage />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows an error note when the profile fails to load', () => {
    perms.current = ['settings.company.read'];
    hooks.profile.error = new Error('network down');
    render(<BrandingSettingsPage />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('read-only access: no Save/Cancel buttons, theme and colour controls disabled', () => {
    perms.current = ['settings.company.read'];
    hooks.profile.data = profile();
    render(<BrandingSettingsPage />);
    expect(screen.queryByText('Save changes')).toBeNull();
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toHaveProperty('disabled', true);
    }
  });

  it('edit access: picking a different preset marks the form dirty and enables Save', () => {
    perms.current = ['settings.company.read', 'settings.company.update'];
    hooks.profile.data = profile();
    render(<BrandingSettingsPage />);
    expect(screen.getByText('Save changes')).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('radio', { name: /Custom/i }));
    expect(screen.getByText('Save changes')).toHaveProperty('disabled', false);
  });

  it('rejects an invalid custom colour: contrast report fails and Save stays disabled', () => {
    perms.current = ['settings.company.read', 'settings.company.update'];
    hooks.profile.data = profile();
    render(<BrandingSettingsPage />);
    fireEvent.click(screen.getByRole('radio', { name: /Custom/i }));
    fireEvent.change(screen.getByLabelText('Primary colour'), {
      target: { value: 'not-a-colour' },
    });
    expect(screen.getByText(/must be a 6-digit hex value/i)).toBeTruthy();
    expect(screen.getByText('Save changes')).toHaveProperty('disabled', true);
  });

  it('a valid custom theme passes contrast and Save sends the custom colours', () => {
    perms.current = ['settings.company.read', 'settings.company.update'];
    hooks.profile.data = profile();
    render(<BrandingSettingsPage />);
    fireEvent.click(screen.getByRole('radio', { name: /Custom/i }));
    fireEvent.change(screen.getByLabelText('Primary colour'), { target: { value: '#1e40af' } });
    fireEvent.change(screen.getByLabelText('Secondary colour'), { target: { value: '#0f172a' } });
    fireEvent.change(screen.getByLabelText('Accent colour'), { target: { value: '#0ea5e9' } });
    fireEvent.click(screen.getByText('Save changes'));
    expect(hooks.save.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        themePreset: 'custom',
        primaryColor: '#1e40af',
        secondaryColor: '#0f172a',
        accentColor: '#0ea5e9',
      }),
    );
  });

  it('Cancel discards the draft back to the saved baseline', () => {
    perms.current = ['settings.company.read', 'settings.company.update'];
    hooks.profile.data = profile();
    render(<BrandingSettingsPage />);
    fireEvent.click(screen.getByRole('radio', { name: /Custom/i }));
    expect(screen.getByText('Save changes')).toHaveProperty('disabled', false);
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.getByText('Save changes')).toHaveProperty('disabled', true);
  });

  it('shows an error note when saving fails, and does not discard the unsaved edit', () => {
    perms.current = ['settings.company.read', 'settings.company.update'];
    hooks.profile.data = profile();
    hooks.save.error = new Error('could not save');
    render(<BrandingSettingsPage />);
    fireEvent.click(screen.getByRole('radio', { name: /Custom/i }));
    expect(screen.getByRole('alert')).toBeTruthy();
    // the failed save must not have reverted the user's in-progress selection
    expect(screen.getByRole('radio', { name: /Custom/i })).toHaveProperty('checked', true);
  });

  it('uploading a logo calls the upload mutation with the chosen file and kind', () => {
    perms.current = ['settings.company.read', 'settings.company.update'];
    hooks.profile.data = profile();
    render(<BrandingSettingsPage />);
    const file = new File(['img-bytes'], 'logo.png', { type: 'image/png' });
    const input = screen.getByLabelText('Upload Primary logo') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(hooks.upload.mutate).toHaveBeenCalledWith({ kind: 'logo', file });
  });

  it('removing an existing logo asks for confirmation before calling remove', async () => {
    perms.current = ['settings.company.read', 'settings.company.update'];
    hooks.profile.data = profile({ hasLogo: true });
    render(<BrandingSettingsPage />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByText('Remove'));
    expect(hooks.remove.mutateAsync).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByText('Remove'));
    expect(hooks.remove.mutateAsync).toHaveBeenCalledWith('logo');
  });
});
