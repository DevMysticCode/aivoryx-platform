'use client';

import type { ReactNode } from 'react';
import { platformAssetHref, usePlatformBranding } from '@/lib/branding/use-branding';
import { resolveBranding } from '@aivoryx/shared';

export interface AuthBrand {
  displayName: string;
  logoUrl: string | null;
  showPoweredBy: boolean;
  /** a tenant's own identity (monogram in the tenant primary) vs the platform's */
  tenantBranded?: boolean;
}

/**
 * The centred frame for the pre-authentication screens (sign in, accept
 * invitation). With no tenant known it carries neutral Aivoryx platform
 * branding (deliberately industry-agnostic — no imagery or copy that assumes a
 * vertical). When the workspace is known from the URL the caller passes a
 * `brand` and the tenant's own identity replaces it. Branding is presentation
 * only: it can never change how authentication behaves.
 */
export function AuthShell({
  title,
  description,
  brand,
  children,
  footer,
}: {
  title: string;
  description?: string;
  brand?: AuthBrand | null;
  children: ReactNode;
  footer?: ReactNode;
}) {
  // No explicit brand (e.g. accept-invitation): the PLATFORM identity, resolved
  // through the same shared resolver - never a hard-coded logo.
  const platform = usePlatformBranding();
  const resolved = resolveBranding(platform, null);
  const fallback: AuthBrand = {
    displayName: resolved.name,
    logoUrl: platformAssetHref(resolved.logo('login', 'light'), platform),
    showPoweredBy: false,
    tenantBranded: false,
  };
  const b = brand ?? fallback;
  const name = b.displayName;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background-muted px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          {b.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={b.logoUrl}
              alt={`${name} logo`}
              className="h-10 max-w-[12rem] object-contain"
            />
          ) : (
            <>
              <span
                className={`grid size-9 place-items-center rounded-lg text-base font-bold ${b.tenantBranded ? 'bg-primary text-primary-foreground' : 'bg-brand text-brand-foreground'}`}
                aria-hidden
              >
                {name.charAt(0).toUpperCase()}
              </span>
              <span className="text-lg font-semibold tracking-tight">{name}</span>
            </>
          )}
        </div>
        <section className="rounded-xl border bg-surface p-6 shadow-sm sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
          <div className="mt-5">{children}</div>
        </section>
        <div className="mt-4 space-y-1 text-center text-xs text-subtle">
          {footer ? <div>{footer}</div> : null}
          {b.showPoweredBy ? <div>Powered by Aivoryx™</div> : null}
        </div>
      </div>
    </div>
  );
}
