'use client';

import { useMe } from '@/lib/admin/use-admin';

/**
 * Applies the tenant's brand colour to the app by overriding two design
 * tokens — `--primary` and `--ring` — with an HSL triple (Phase 10, ADR 0039).
 *
 * This is a TOKEN override, never arbitrary CSS: the only thing that can reach
 * the page is a colour parsed from a server-validated `#rrggbb` value. The
 * lightness is clamped so that the fixed near-white `--primary-foreground`
 * stays readable on primary-coloured surfaces (buttons, badges) — a tenant
 * cannot pick a colour that breaks contrast.
 */
export function BrandProvider() {
  const me = useMe();
  const primary = me.data?.active?.branding?.primaryColor ?? null;
  const css = primary ? buildBrandCss(primary) : null;
  if (!css) return null;
  // A single scoped custom-property override. No selectors, no declarations
  // other than the two tokens.
  return <style data-aivoryx-brand="">{css}</style>;
}

function buildBrandCss(hex: string): string | null {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  const [h, s, l] = hsl;
  const safeL = Math.min(62, Math.max(28, l));
  const triple = `${Math.round(h)} ${Math.round(s)}% ${Math.round(safeL)}%`;
  return `:root{--primary:${triple};--ring:${triple};}`;
}

/** `#rrggbb` → `[h (0-360), s (0-100), l (0-100)]`, or null if malformed. */
function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1]!, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
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
