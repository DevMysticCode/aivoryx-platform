import { describe, expect, it } from 'vitest';
import { DEFAULT_PLATFORM_NAME, hasTheme, resolveBranding } from './resolve.js';

const platform = {
  name: 'Aivoryx Cloud',
  tagline: 'Run your business',
  themePreset: 'indigo',
  loginHeading: 'Welcome',
  loginText: 'Sign in to continue.',
  assets: { logoLight: true, logoDark: true, mark: true, favicon: true, loginLogo: false },
};

describe('resolveBranding precedence', () => {
  it('falls back to the hard-coded Aivoryx identity when nothing is configured', () => {
    const b = resolveBranding(null, null);
    expect(b.name).toBe(DEFAULT_PLATFORM_NAME);
    expect(b.theme).toBeNull();
    expect(b.logo('full', 'light')).toBeNull(); // never a broken image: caller draws a monogram
    expect(b.logo('compact', 'light')).toBeNull();
    expect(b.favicon()).toBeNull();
    expect(b.login).toEqual({ heading: null, text: null, showPoweredBy: true });
  });

  it('platform branding is the default when no tenant is known', () => {
    const b = resolveBranding(platform, null);
    expect(b.name).toBe('Aivoryx Cloud');
    expect(b.theme).toMatchObject({ themePreset: 'indigo', source: 'platform' });
    expect(b.logo('full', 'dark')).toEqual({ source: 'platform', kind: 'logo_dark' });
    expect(b.logo('full', 'light')).toEqual({ source: 'platform', kind: 'logo_light' });
    expect(b.logo('compact', 'light')).toEqual({ source: 'platform', kind: 'mark' });
    expect(b.login.heading).toBe('Welcome');
    expect(b.favicon()).toEqual({ source: 'platform', kind: 'favicon' });
    expect(b.tenantBranded).toBe(false);
  });

  it('a tenant with no logo/theme still gets the platform logo and theme', () => {
    const b = resolveBranding(platform, { displayName: 'Acme' });
    expect(b.name).toBe('Acme');
    expect(b.logo('full', 'light')).toEqual({ source: 'platform', kind: 'logo_light' });
    expect(b.theme?.source).toBe('platform');
  });

  it('tenant logo without a tenant theme = tenant logo + platform theme', () => {
    const b = resolveBranding(platform, { displayName: 'Acme', hasLogo: true });
    expect(b.logo('full', 'light')).toEqual({ source: 'tenant', kind: 'logo' });
    expect(b.theme).toMatchObject({ source: 'platform', themePreset: 'indigo' });
  });

  it('tenant theme overrides the platform theme', () => {
    const b = resolveBranding(platform, { themePreset: 'ocean' });
    expect(b.theme).toMatchObject({ source: 'tenant', themePreset: 'ocean' });
    expect(resolveBranding(platform, { primaryColor: '#123456' }).theme?.source).toBe('tenant');
  });

  it('light/dark tenant logos win on their surface; the plain logo backs both', () => {
    const b = resolveBranding(platform, { hasLogo: true, hasDarkLogo: true });
    expect(b.logo('full', 'dark')).toEqual({ source: 'tenant', kind: 'logo_dark' });
    expect(b.logo('full', 'light')).toEqual({ source: 'tenant', kind: 'logo' });
  });

  it('never mixes identities in the collapsed rail: a branded tenant without a mark gets a monogram', () => {
    expect(resolveBranding(platform, { hasLogo: true }).logo('compact', 'light')).toBeNull();
    expect(resolveBranding(platform, { hasCompactLogo: true }).logo('compact', 'light')).toEqual({
      source: 'tenant',
      kind: 'logo_compact',
    });
  });

  it('sign-in: tenant login logo, then tenant logo, then platform login logo, then platform logo', () => {
    const p = { ...platform, assets: { ...platform.assets, loginLogo: true } };
    expect(
      resolveBranding(p, { hasLoginLogo: true, hasLogo: true }).logo('login', 'light'),
    ).toEqual({ source: 'tenant', kind: 'logo_login' });
    expect(resolveBranding(p, { hasLogo: true }).logo('login', 'light')).toEqual({
      source: 'tenant',
      kind: 'logo',
    });
    expect(resolveBranding(p, null).logo('login', 'light')).toEqual({
      source: 'platform',
      kind: 'login_logo',
    });
    expect(resolveBranding(platform, null).logo('login', 'dark')).toEqual({
      source: 'platform',
      kind: 'logo_dark',
    });
  });

  it('sign-in copy and the powered-by flag come from the tenant first, then the platform', () => {
    const b = resolveBranding(platform, { welcomeMessage: 'Hi Acme', showPoweredBy: false });
    expect(b.login).toEqual({
      heading: 'Hi Acme',
      text: 'Sign in to continue.',
      showPoweredBy: false,
    });
  });

  it('ignores blank / invalid values instead of treating them as configuration', () => {
    expect(hasTheme({ primaryColor: 'red', themePreset: 'nope' })).toBe(false);
    expect(resolveBranding(platform, { displayName: '   ' }).name).toBe('Aivoryx Cloud');
  });
});
