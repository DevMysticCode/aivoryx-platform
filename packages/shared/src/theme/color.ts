/**
 * Pure colour maths shared by the API (validation, document accent) and the web
 * app (theme derivation, live preview). No I/O, no dependencies.
 */

export type Rgb = readonly [number, number, number];
export type Hsl = readonly [number, number, number];

const HEX = /^#([0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

export function hexToRgb(hex: string): Rgb | null {
  const m = HEX.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** `[h 0-360, s 0-100, l 0-100]` */
export function rgbToHsl([r8, g8, b8]: Rgb): Hsl {
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s * 100, l * 100];
}

export function hslToRgb([h, s100, l100]: Hsl): Rgb {
  const s = s100 / 100;
  const l = l100 / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export function hexToHsl(hex: string): Hsl | null {
  const rgb = hexToRgb(hex);
  return rgb ? rgbToHsl(rgb) : null;
}

export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl));
}

/** WCAG 2.x relative luminance. */
export function luminance([r8, g8, b8]: Rgb): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r8) + 0.7152 * lin(g8) + 0.0722 * lin(b8);
}

/** WCAG contrast ratio between two hex colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return 1;
  const la = luminance(ra);
  const lb = luminance(rb);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Whichever of near-white / near-black reads better on `bg`. */
export function readableOn(bg: string): '#ffffff' | '#14111f' {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#14111f') ? '#ffffff' : '#14111f';
}

/**
 * Move `hex` along the lightness axis (hue and saturation preserved) until it
 * reaches `minContrast` against `against`. `direction` is the way to move.
 * Returns the adjusted colour and how many lightness points it moved.
 */
export function adjustForContrast(
  hex: string,
  against: string,
  minContrast: number,
  direction: 'darker' | 'lighter',
): { hex: string; shift: number } | null {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  const [h, s, l0] = hsl;
  const step = direction === 'darker' ? -1 : 1;
  let l = l0;
  let out = hslToHex([h, s, l]);
  while (contrastRatio(out, against) < minContrast) {
    l += step;
    if (l < 0 || l > 100) return null;
    out = hslToHex([h, s, l]);
  }
  return { hex: out, shift: Math.abs(l - l0) };
}
