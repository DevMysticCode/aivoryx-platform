'use client';

import type { CSSProperties } from 'react';
import { Users, Gauge, FileText } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import { type ThemeColors, deriveTheme, documentAccent, isHexColor } from '@aivoryx/shared';
import { Badge } from '@/components/ui/status-badge';

/** Token overrides for ONE mode, scoped to the preview root (never the real page). */
function tokenStyle(colors: ThemeColors, mode: 'light' | 'dark'): CSSProperties {
  const t = deriveTheme(colors)[mode];
  const vars: Record<string, string> = {
    '--primary': t.primary,
    '--primary-foreground': t.primaryForeground,
    '--primary-hover': t.primaryHover,
    '--primary-active': t.primaryActive,
    '--primary-soft': t.primarySoft,
    '--ring': t.ring,
    '--focus': t.ring,
    '--brand-secondary': t.brand,
    '--brand-accent': t.brandAccent,
    '--chart-1': t.chart[0],
    '--chart-2': t.chart[1],
    '--chart-3': t.chart[2],
    // these are `var(--primary-*)` at :root and would not re-resolve here
    '--sidebar-active': t.primarySoft,
    '--sidebar-active-foreground': t.sidebarActiveForeground,
  };
  return vars as CSSProperties;
}

/**
 * A miniature of the real product painted with the DRAFT theme — sidebar, page
 * header, buttons, a table with status badges, a card and a document — so a
 * tenant sees exactly what they are about to save. It reuses the real
 * components and tokens (scoped to this subtree), not a second styling system.
 */
export function BrandingPreview({
  colors,
  mode,
  displayName,
  logoUrl,
  documentLogoUrl,
  documentAccentColor,
  footer,
  showCustomerLogo,
  loginLogoUrl,
  loginWelcome,
  loginDescription,
  loginShowPoweredBy,
  show = ['app', 'login', 'document'],
}: {
  colors: ThemeColors;
  mode: 'light' | 'dark';
  displayName: string;
  logoUrl: string | null;
  documentLogoUrl: string | null;
  documentAccentColor: string | null;
  footer: string;
  showCustomerLogo: boolean;
  loginLogoUrl: string | null;
  loginWelcome: string;
  loginDescription: string;
  loginShowPoweredBy: boolean;
  /** which mock-ups to draw (platform branding has no documents) */
  show?: ('app' | 'login' | 'document')[];
}) {
  const safe: ThemeColors = {
    primary: isHexColor(colors.primary) ? colors.primary : '#00a19a',
    secondary: isHexColor(colors.secondary) ? colors.secondary : '#231d45',
    accent: isHexColor(colors.accent) ? colors.accent : '#c18a38',
  };
  const accent = documentAccent(documentAccentColor ?? safe.primary);

  return (
    <div className="space-y-4">
      {show.includes('app') ? (
        <div
          className={cn(
            'overflow-hidden rounded-lg border bg-background text-foreground',
            mode === 'dark' && 'dark',
          )}
          style={tokenStyle(safe, mode)}
          aria-label={`Theme preview, ${mode} mode`}
          role="img"
        >
          <div className="flex h-56">
            <div className="flex w-32 shrink-0 flex-col gap-1 border-r border-sidebar-border bg-sidebar p-2 text-[11px] text-sidebar-foreground">
              <div className="mb-1 flex items-center gap-1.5 px-1 py-1">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="h-5 max-w-[5rem] object-contain" />
                ) : (
                  <span className="grid size-5 place-items-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
                    {displayName.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="truncate font-semibold">{displayName}</span>
              </div>
              <span className="relative flex items-center gap-1.5 rounded bg-sidebar-active px-2 py-1 font-medium text-sidebar-active-foreground before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full before:bg-primary">
                <Gauge className="size-3" aria-hidden /> Overview
              </span>
              <span className="flex items-center gap-1.5 px-2 py-1 text-sidebar-muted">
                <Users className="size-3" aria-hidden /> Leads
              </span>
              <span className="flex items-center gap-1.5 px-2 py-1 text-sidebar-muted">
                <FileText className="size-3" aria-hidden /> Quotations
              </span>
            </div>
            <div className="min-w-0 flex-1 space-y-2.5 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold tracking-tight">Leads</span>
                <span className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground">
                  New lead
                </span>
              </div>
              <div className="flex gap-1.5">
                <span className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11px]">
                  Secondary
                </span>
                <span className="rounded-md px-2 py-0.5 text-[11px] text-primary">Link action</span>
              </div>
              <div className="overflow-hidden rounded-md border bg-surface text-[11px]">
                {[
                  ['Ravi Menon', 'Qualified', 'primary'],
                  ['Asha Verma', 'Follow-up', 'warning'],
                  ['Kunal Rao', 'Converted', 'success'],
                  ['Site 12', 'Blocked', 'danger'],
                ].map(([n, s, tone]) => (
                  <div
                    key={n}
                    className="flex items-center justify-between border-b border-border-subtle px-2 py-1 last:border-0"
                  >
                    <span>{n}</span>
                    <Badge tone={tone as 'primary' | 'warning' | 'success' | 'danger'}>{s}</Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {show.includes('login') ? (
        <div
          className={cn(
            'rounded-lg border bg-background-muted p-3 text-foreground',
            mode === 'dark' && 'dark',
          )}
          style={tokenStyle(safe, mode)}
          role="img"
          aria-label={`Sign-in page preview, ${mode} mode`}
        >
          <div className="mx-auto max-w-[13rem] space-y-2 text-center">
            {loginLogoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={loginLogoUrl} alt="" className="mx-auto h-6 max-w-[7rem] object-contain" />
            ) : (
              <p className="flex items-center justify-center gap-1.5 text-xs font-semibold">
                <span className="grid size-5 place-items-center rounded bg-primary text-[10px] text-primary-foreground">
                  {displayName.charAt(0).toUpperCase()}
                </span>
                {displayName}
              </p>
            )}
            <div className="space-y-1.5 rounded-md border bg-surface p-2.5 text-left">
              <p className="text-[11px] font-semibold">{loginWelcome.trim() || 'Sign in'}</p>
              <p className="text-[10px] text-muted-foreground">
                {loginDescription.trim() || `Sign in to ${displayName}.`}
              </p>
              <div className="h-4 rounded border border-input bg-background" />
              <div className="h-4 rounded border border-input bg-background" />
              <div className="rounded bg-primary py-1 text-center text-[10px] font-medium text-primary-foreground">
                Sign in
              </div>
            </div>
            {loginShowPoweredBy ? (
              <p className="text-[9px] text-subtle">Powered by Aivoryx&trade;</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {show.includes('document') ? (
        <>
          <div className="rounded-lg border bg-white p-3 text-[10px] leading-snug text-neutral-800 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              {documentLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={documentLogoUrl} alt="" className="h-7 max-w-[6rem] object-contain" />
              ) : (
                <span className="text-xs font-bold">{displayName}</span>
              )}
              <div className="text-right">
                <p className="text-xs font-bold tracking-wide" style={{ color: accent }}>
                  QUOTATION
                </p>
                <p>Q-000123</p>
              </div>
            </div>
            <div className="my-2 h-0.5" style={{ background: accent }} />
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">Bill to</p>
                <p>Sample Customer Pvt Ltd</p>
              </div>
              {showCustomerLogo ? (
                <span className="grid h-6 w-14 place-items-center rounded border border-dashed border-neutral-300 text-[8px] text-neutral-500">
                  customer logo
                </span>
              ) : null}
            </div>
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 border-t border-neutral-200 pt-1.5">
              <span>5 kW rooftop system</span>
              <span className="tabular-nums">4,20,000.00</span>
            </div>
            <p className="mt-2 border-t border-neutral-200 pt-1 text-neutral-500">
              {footer.trim() ? `${footer.trim()} · ` : ''}Powered by Aivoryx™
            </p>
          </div>
          <p className="text-[11px] text-subtle">
            Documents are always printed on white paper; the accent is adjusted so it stays
            readable.
          </p>
        </>
      ) : null}
    </div>
  );
}
