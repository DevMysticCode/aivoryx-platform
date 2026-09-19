import { describe, expect, it } from 'vitest';
import {
  THEME_PRESETS,
  buildThemeCss,
  contrastRatio,
  deriveTheme,
  documentAccent,
  resolveThemeColors,
} from './index.js';

describe('contrastRatio', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#777777', '#ffffff')).toBeGreaterThan(4.4);
    expect(contrastRatio('#777777', '#ffffff')).toBeLessThan(4.6);
    expect(contrastRatio('#ffffff', '#ffffff')).toBe(1);
  });
});

describe('deriveTheme', () => {
  it('every shipped preset yields AA text on its fill in both modes', () => {
    for (const p of THEME_PRESETS) {
      const t = deriveTheme(p.colors);
      expect(t.report.fillContrastLight, p.key).toBeGreaterThanOrEqual(4.5);
      expect(t.report.fillContrastDark, p.key).toBeGreaterThanOrEqual(4.5);
      expect(t.report.ok, p.key).toBe(true);
    }
  });

  it('rejects a colour too pale to be a light-mode fill, and suggests a usable one', () => {
    const t = deriveTheme({ primary: '#ffee66', secondary: '#231d45', accent: '#c18a38' });
    expect(t.report.ok).toBe(false);
    expect(t.report.suggestedPrimary).toMatch(/^#[0-9a-f]{6}$/);
    expect(contrastRatio(t.report.suggestedPrimary!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(t.report.problems[0]).toMatch(/too light/i);
  });

  it('accepts a very dark colour (dark mode lifts it instead)', () => {
    const t = deriveTheme({ primary: '#231d45', secondary: '#231d45', accent: '#c18a38' });
    expect(t.report.ok).toBe(true);
    expect(t.report.fillContrastDark).toBeGreaterThanOrEqual(4.5);
  });
});

describe('buildThemeCss', () => {
  it('overrides brand tokens only — never a status colour', () => {
    const css = buildThemeCss(THEME_PRESETS[2]!.colors);
    expect(css).toContain('--primary:');
    expect(css).toContain('.dark{');
    for (const forbidden of ['--destructive', '--success', '--warning', '--info', '--danger']) {
      expect(css).not.toContain(forbidden);
    }
  });

  it('is injection-safe: only hsl triples are emitted', () => {
    const css = buildThemeCss(resolveThemeColors({ preset: 'custom', primary: '#4f46e5' }));
    expect(css).toMatch(/^[:.a-z{}\-\d\s%;,()]+$/i);
    expect(css).not.toMatch(/[<>"'\\]/);
  });
});

describe('resolveThemeColors / documentAccent', () => {
  it('a preset wins over stored custom hexes; junk falls back to the brand', () => {
    expect(resolveThemeColors({ preset: 'ocean', primary: '#ff0000' }).primary).toBe('#0b7bb5');
    expect(resolveThemeColors({ preset: 'custom', primary: 'red' }).primary).toBe('#00a19a');
  });

  it('document accent is always print-safe on white paper', () => {
    expect(contrastRatio(documentAccent('#ffee66'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(documentAccent(null)).toBe('#1e3a8a');
  });
});
