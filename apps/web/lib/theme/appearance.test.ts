import { describe, expect, it } from 'vitest';
import { THEME_INIT_SCRIPT, isAppearancePreference, resolveAppearance } from './appearance';

describe('appearance', () => {
  it('System follows the OS; explicit choices ignore it', () => {
    expect(resolveAppearance('system', true)).toBe('dark');
    expect(resolveAppearance('system', false)).toBe('light');
    expect(resolveAppearance('light', true)).toBe('light');
    expect(resolveAppearance('dark', false)).toBe('dark');
  });

  it('rejects unknown stored values', () => {
    expect(isAppearancePreference('sepia')).toBe(false);
    expect(isAppearancePreference('dark')).toBe(true);
  });

  it('the no-flash init script is parseable, static, and applies the class synchronously', () => {
    expect(() => new Function(THEME_INIT_SCRIPT)).not.toThrow();
    expect(THEME_INIT_SCRIPT).toContain("classList.add('dark')");
    expect(THEME_INIT_SCRIPT).toContain('prefers-color-scheme: dark');
  });
});
