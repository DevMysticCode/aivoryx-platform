import { describe, expect, it } from 'vitest';
import { themeCssFor } from './brand-provider';

describe('themeCssFor', () => {
  it('leaves the platform default untouched when the tenant configured nothing', () => {
    expect(themeCssFor({})).toBeNull();
  });

  it('a named preset produces light + dark token overrides and no status colours', () => {
    const css = themeCssFor({ themePreset: 'ocean' })!;
    expect(css).toContain('--primary:');
    expect(css).toContain('.dark{');
    expect(css).not.toMatch(/--(success|warning|danger|destructive|info)/);
  });

  it('legacy tenants (colour set, no preset) keep working as a custom theme', () => {
    expect(themeCssFor({ primaryColor: '#4f46e5' })).toContain('--primary:');
  });

  it('a preset wins over stored custom hexes', () => {
    const a = themeCssFor({ themePreset: 'ocean', primaryColor: '#ff0000' });
    const b = themeCssFor({ themePreset: 'ocean' });
    expect(a).toBe(b);
  });
});
