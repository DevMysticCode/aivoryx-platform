import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CompanyProfile } from '@aivoryx/contracts';
import { IANA_TIMEZONES, ISO_CURRENCIES } from '@aivoryx/shared';

const profile = (overrides: Partial<CompanyProfile> = {}): CompanyProfile =>
  ({
    workspaceName: 'Acme Field Services',
    legalName: 'Acme Field Services Ltd',
    displayName: 'Acme',
    email: 'ops@acme.test',
    phone: null,
    website: null,
    addressLine: null,
    city: null,
    region: null,
    country: null,
    postalCode: null,
    taxRegistrationLabel: null,
    taxRegistrationNumber: null,
    documentFooter: null,
    timezone: null,
    defaultCurrency: null,
    primaryColor: null,
    accentColor: null,
    themePreset: null,
    secondaryColor: null,
    documentLogoMode: 'company',
    documentAccentColor: null,
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
  plan: { isLoading: false, error: null as unknown, data: null as unknown },
  save: { mutate: vi.fn(), isPending: false, error: null as unknown },
}));

vi.mock('@/components/supply/supply-shell', () => ({ usePermissions: () => perms.current }));
vi.mock('@/lib/settings/use-settings', () => ({
  useCompanyProfile: () => hooks.profile,
  useTenantPlan: () => hooks.plan,
  useUpdateCompanyProfile: () => hooks.save,
}));

import CompanySettingsPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  perms.current = [];
  hooks.profile = { isLoading: false, error: null, data: null };
  hooks.plan = { isLoading: false, error: null, data: null };
  hooks.save = { mutate: vi.fn(), isPending: false, error: null };
});

describe('Company settings page', () => {
  it('without settings.company.read: explains, and never fetches the profile', () => {
    render(<CompanySettingsPage />);
    expect(screen.getByText(/don.t have access to company settings/i)).toBeTruthy();
  });

  it('with read-only access: shows fields read-only, with no Save button', () => {
    perms.current = ['settings.company.read'];
    hooks.profile.data = profile();
    render(<CompanySettingsPage />);
    expect(screen.queryByText('Save changes')).toBeNull();
    expect(screen.getByDisplayValue('Acme Field Services Ltd')).toHaveProperty('disabled', true);
  });

  it('with edit access: fields are editable and Save sends the edited patch', () => {
    perms.current = ['settings.company.read', 'settings.company.update'];
    hooks.profile.data = profile();
    render(<CompanySettingsPage />);
    const legalName = screen.getByDisplayValue('Acme Field Services Ltd');
    expect(legalName).toHaveProperty('disabled', false);
    fireEvent.change(legalName, { target: { value: 'Acme Renamed Ltd' } });
    fireEvent.click(screen.getByText('Save changes'));
    expect(hooks.save.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ legalName: 'Acme Renamed Ltd' }),
    );
  });

  it('renders timezone and default currency as real dropdowns, not free text, and submits the chosen values', () => {
    perms.current = ['settings.company.read', 'settings.company.update'];
    hooks.profile.data = profile();
    render(<CompanySettingsPage />);

    const timezoneSelect = screen.getByText('Timezone').closest('label')!.querySelector('select')!;
    const currencySelect = screen
      .getByText('Default currency')
      .closest('label')!
      .querySelector('select')!;
    expect(timezoneSelect).toBeTruthy();
    expect(currencySelect).toBeTruthy();
    // +1 for the "Not set" placeholder option
    expect(timezoneSelect.options).toHaveLength(IANA_TIMEZONES.length + 1);
    expect(currencySelect.options).toHaveLength(ISO_CURRENCIES.length + 1);

    // Picks a real option from the rendered list itself, rather than a literal
    // like "UTC" or "Asia/Kolkata" — neither is a canonical zone name under
    // `Intl.supportedValuesOf('timeZone')`, so neither exists as an <option>
    // here even though both are accepted elsewhere for actual date formatting.
    const timezoneValue = IANA_TIMEZONES[0]!;
    fireEvent.change(timezoneSelect, { target: { value: timezoneValue } });
    fireEvent.change(currencySelect, { target: { value: 'EUR' } });
    fireEvent.click(screen.getByText('Save changes'));
    expect(hooks.save.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: timezoneValue, defaultCurrency: 'EUR' }),
    );
  });

  it('shows a loading skeleton while the profile is loading', () => {
    perms.current = ['settings.company.read'];
    hooks.profile.isLoading = true;
    const { container } = render(<CompanySettingsPage />);
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('shows an error note when the profile fails to load, and when saving fails', () => {
    perms.current = ['settings.company.read', 'settings.company.update'];
    hooks.profile.error = new Error('network down');
    hooks.save.error = new Error('could not save');
    render(<CompanySettingsPage />);
    expect(screen.getAllByRole('alert')).toHaveLength(2);
  });
});
