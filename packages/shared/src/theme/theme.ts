import {
  adjustForContrast,
  contrastRatio,
  hexToHsl,
  hslToHex,
  isHexColor,
  readableOn,
} from './color.js';

/**
 * The Aivoryx theme engine (Phase 19). A tenant chooses a preset or a custom
 * Primary/Secondary/Accent; everything else (hover, active, soft tint, focus,
 * text-on-colour, and the dark-mode counterparts) is DERIVED here — one place,
 * used by the web app to paint and by the API to validate. Tenants can only
 * influence brand tokens: success / warning / danger / info are never derived
 * from a tenant colour, so status meaning is never lost.
 */

export const THEME_PRESET_KEYS = [
  'aivoryx-teal',
  'ocean',
  'indigo',
  'emerald',
  'royal',
  'warm',
  'custom',
] as const;
export type ThemePresetKey = (typeof THEME_PRESET_KEYS)[number];

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
}

export interface ThemePreset {
  key: Exclude<ThemePresetKey, 'custom'>;
  label: string;
  colors: ThemeColors;
}

/** The brand foundation: Teal #00A19A, Navy #231D45, Gold #C18A38. */
export const AIVORYX_BRAND = { teal: '#00a19a', navy: '#231d45', gold: '#c18a38' } as const;

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    key: 'aivoryx-teal',
    label: 'Aivoryx Teal',
    colors: { primary: '#00a19a', secondary: '#231d45', accent: '#c18a38' },
  },
  {
    key: 'ocean',
    label: 'Ocean',
    colors: { primary: '#0b7bb5', secondary: '#0f2a43', accent: '#12a4a4' },
  },
  {
    key: 'indigo',
    label: 'Indigo',
    colors: { primary: '#4f46e5', secondary: '#1e1b4b', accent: '#0ea5e9' },
  },
  {
    key: 'emerald',
    label: 'Emerald',
    colors: { primary: '#0f9d6b', secondary: '#0b3d2e', accent: '#c18a38' },
  },
  {
    key: 'royal',
    label: 'Royal',
    colors: { primary: '#7c3aed', secondary: '#2e1065', accent: '#c18a38' },
  },
  {
    key: 'warm',
    label: 'Warm',
    colors: { primary: '#c2410c', secondary: '#3b1d0e', accent: '#b45309' },
  },
];

export function isThemePresetKey(value: string): value is ThemePresetKey {
  return (THEME_PRESET_KEYS as readonly string[]).includes(value);
}

export function getThemePreset(key: string | null | undefined): ThemePreset | null {
  return THEME_PRESETS.find((p) => p.key === key) ?? null;
}

/** Resolve the effective colours: a preset wins over stored hexes; `custom` uses them. */
export function resolveThemeColors(input: {
  preset?: string | null;
  primary?: string | null;
  secondary?: string | null;
  accent?: string | null;
}): ThemeColors {
  const preset = getThemePreset(input.preset);
  if (preset) return preset.colors;
  const base = THEME_PRESETS[0]!.colors;
  return {
    primary:
      input.primary && isHexColor(input.primary) ? input.primary.toLowerCase() : base.primary,
    secondary:
      input.secondary && isHexColor(input.secondary)
        ? input.secondary.toLowerCase()
        : base.secondary,
    accent: input.accent && isHexColor(input.accent) ? input.accent.toLowerCase() : base.accent,
  };
}

// Reference surfaces the contrast rules are measured against. These mirror the
// platform tokens in packages/ui/src/styles.css.
const LIGHT_SURFACE = '#ffffff';
const DARK_SURFACE = hslToHex([249, 24, 12]);
const DARK_BACKGROUND = hslToHex([249, 30, 8]);

/** WCAG AA for normal text. */
export const MIN_TEXT_CONTRAST = 4.5;
/** A colour whose light-mode fill must move further than this is rejected. */
export const MAX_LIGHT_SHIFT = 30;

export interface ModeTokens {
  /** all values are `H S% L%` triples ready for `hsl(var(--x))` */
  primary: string;
  primaryForeground: string;
  primaryHover: string;
  primaryActive: string;
  primarySoft: string;
  /** text/icon colour on the sidebar's active tint (readable on `primarySoft`) */
  sidebarActiveForeground: string;
  ring: string;
  brand: string;
  brandForeground: string;
  brandAccent: string;
  chart: [string, string, string];
}

export interface ThemeReport {
  ok: boolean;
  /** contrast of the tenant's raw primary against the light / dark page surface */
  rawContrastLight: number;
  rawContrastDark: number;
  /** contrast of text placed on the derived fill (buttons, badges) */
  fillContrastLight: number;
  fillContrastDark: number;
  /** how far (lightness points) light mode had to move the raw colour */
  lightShift: number;
  /** the closest acceptable primary, when `ok` is false */
  suggestedPrimary: string | null;
  problems: string[];
}

export interface DerivedTheme {
  light: ModeTokens;
  dark: ModeTokens;
  report: ThemeReport;
}

const triple = (hex: string): string => {
  const hsl = hexToHsl(hex) ?? [0, 0, 0];
  return `${Math.round(hsl[0])} ${Math.round(hsl[1])}% ${Math.round(hsl[2])}%`;
};

const shade = (hex: string, dl: number): string => {
  const [h, s, l] = hexToHsl(hex) ?? [0, 0, 50];
  return hslToHex([h, s, Math.max(0, Math.min(100, l + dl))]);
};

const soft = (hex: string, mode: 'light' | 'dark'): string => {
  const [h, s] = hexToHsl(hex) ?? [0, 0, 50];
  return mode === 'light' ? hslToHex([h, Math.min(s, 70), 95]) : hslToHex([h, Math.min(s, 45), 18]);
};

/** Derive the full token set (light + dark) and an accessibility report. */
export function deriveTheme(colors: ThemeColors): DerivedTheme {
  const primary = colors.primary.toLowerCase();
  const problems: string[] = [];

  // light mode: text on the fill is white, and the fill must also read on the soft tint
  const lightSoft = soft(primary, 'light');
  const lightBase = adjustForContrast(primary, LIGHT_SURFACE, MIN_TEXT_CONTRAST, 'darker');
  const lightFit = lightBase
    ? adjustForContrast(lightBase.hex, lightSoft, MIN_TEXT_CONTRAST, 'darker')
    : null;
  const lightFill = lightFit?.hex ?? '#1f2937';
  const lightShift = lightBase ? hexToHsl(primary)![2] - hexToHsl(lightFill)![2] : 100;

  // dark mode: lift the fill until it reads on the dark surface, pick the readable foreground
  const darkBase = adjustForContrast(primary, DARK_SURFACE, MIN_TEXT_CONTRAST, 'lighter');
  const darkFill = darkBase?.hex ?? '#e5e7eb';
  const darkFg = readableOn(darkFill);

  const suggestedPrimary = lightShift > MAX_LIGHT_SHIFT ? lightFill : null;
  if (suggestedPrimary) {
    problems.push(
      `This colour is too light for white text and links on a light background (it would have to be darkened by ${Math.round(lightShift)} points). Try ${suggestedPrimary} or a deeper shade.`,
    );
  }

  const mk = (mode: 'light' | 'dark'): ModeTokens => {
    const fill = mode === 'light' ? lightFill : darkFill;
    const fg = mode === 'light' ? '#ffffff' : darkFg;
    const hoverStep = mode === 'light' ? -6 : 6;
    const sec = colors.secondary.toLowerCase();
    const acc = colors.accent.toLowerCase();
    const brand =
      mode === 'light'
        ? sec
        : (adjustForContrast(sec, DARK_BACKGROUND, 7, 'lighter')?.hex ?? '#e5e7eb');
    const accentText =
      mode === 'light'
        ? (adjustForContrast(acc, LIGHT_SURFACE, 3, 'darker')?.hex ?? acc)
        : (adjustForContrast(acc, DARK_SURFACE, 3, 'lighter')?.hex ?? acc);
    return {
      primary: triple(fill),
      primaryForeground: triple(fg),
      primaryHover: triple(shade(fill, hoverStep)),
      primaryActive: triple(shade(fill, hoverStep * 2)),
      primarySoft: triple(soft(fill, mode)),
      sidebarActiveForeground: triple(
        adjustForContrast(
          fill,
          soft(fill, mode),
          MIN_TEXT_CONTRAST,
          mode === 'light' ? 'darker' : 'lighter',
        )?.hex ?? fill,
      ),
      ring: triple(fill),
      brand: triple(brand),
      brandForeground: triple(readableOn(brand)),
      brandAccent: triple(accentText),
      chart: [triple(fill), triple(brand === fill ? accentText : brand), triple(accentText)],
    };
  };

  const fillContrastLight = contrastRatio(lightFill, '#ffffff');
  const fillContrastDark = contrastRatio(darkFill, darkFg);

  return {
    light: mk('light'),
    dark: mk('dark'),
    report: {
      ok:
        problems.length === 0 &&
        fillContrastLight >= MIN_TEXT_CONTRAST &&
        fillContrastDark >= MIN_TEXT_CONTRAST,
      rawContrastLight: contrastRatio(primary, LIGHT_SURFACE),
      rawContrastDark: contrastRatio(primary, DARK_BACKGROUND),
      fillContrastLight,
      fillContrastDark,
      lightShift: Math.max(0, lightShift),
      suggestedPrimary,
      problems,
    },
  };
}

/**
 * The CSS a tenant theme injects: token overrides only, for light and dark.
 * `.dark` matches the platform's class-based dark mode.
 */
export function buildThemeCss(colors: ThemeColors): string {
  const { light, dark } = deriveTheme(colors);
  const block = (t: ModeTokens) =>
    `--primary:${t.primary};--primary-foreground:${t.primaryForeground};` +
    `--primary-hover:${t.primaryHover};--primary-active:${t.primaryActive};` +
    `--primary-soft:${t.primarySoft};--sidebar-active-foreground:${t.sidebarActiveForeground};` +
    `--ring:${t.ring};--focus:${t.ring};` +
    `--brand-secondary:${t.brand};--brand-accent:${t.brandAccent};` +
    `--chart-1:${t.chart[0]};--chart-2:${t.chart[1]};--chart-3:${t.chart[2]};`;
  return `:root{${block(light)}}.dark{${block(dark)}}`;
}

/** A print-safe accent for generated documents (always ≥4.5:1 on white paper). */
export function documentAccent(hex: string | null | undefined, fallback = '#1e3a8a'): string {
  if (!hex || !isHexColor(hex)) return fallback;
  return adjustForContrast(hex, '#ffffff', MIN_TEXT_CONTRAST, 'darker')?.hex ?? fallback;
}
