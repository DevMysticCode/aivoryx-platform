'use client';

import Link from 'next/link';
import { cn } from '@aivoryx/ui';
import { useMe } from '@/lib/admin/use-admin';
import { useLogoObjectUrl } from '@/lib/settings/use-settings';
import { platformAssetHref, useResolvedBranding } from '@/lib/branding/use-branding';
import { useAppearance } from '@/components/theme-provider';
import type { LogoKind } from '@/lib/api/settings';

/**
 * The identity in the shell. Which logo shows is decided by the shared branding
 * resolver: the tenant's own logo (compact in the collapsed rail, light/dark
 * variant matching the appearance) when it has one, otherwise the PLATFORM
 * (Aivoryx) logo, otherwise a monogram - never a broken image. Platform-admin
 * mode ignores the tenant layer and keeps the fixed navy Aivoryx monogram as a
 * cue that this is platform identity, not a tenant workspace.
 */
export function BrandMark({
  platformRoute,
  compact,
  className,
  href,
}: {
  platformRoute?: boolean;
  compact?: boolean;
  className?: string;
  /** where the mark links; defaults to the workspace (or platform) home */
  href?: string;
}) {
  const me = useMe();
  const { resolved } = useAppearance();
  const platformMode = platformRoute || (me.data?.isPlatformAdmin && !me.data.active);
  const { branding, platform } = useResolvedBranding({ ignoreTenant: !!platformMode });

  const platformName = platform?.name?.trim() || 'Aivoryx';
  const name = platformMode
    ? /platform/i.test(platformName)
      ? platformName
      : `${platformName} Platform`
    : branding.name;

  const ref = branding.logo(compact ? 'compact' : 'full', resolved);
  const tenantUrl = useLogoObjectUrl(
    ref?.source === 'tenant',
    name,
    (ref?.source === 'tenant' ? ref.kind : 'logo') as LogoKind,
  );
  const logoUrl = ref?.source === 'platform' ? platformAssetHref(ref, platform) : tenantUrl;

  return (
    <Link
      href={href ?? (platformMode ? '/platform' : '/')}
      aria-label={compact ? `${name} home` : undefined}
      className={cn('flex min-w-0 items-center gap-2', className)}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={compact ? '' : `${name} logo`}
          className={cn(
            'shrink-0 object-contain',
            compact ? 'size-8 rounded-md' : 'h-7 max-w-[8rem]',
          )}
        />
      ) : (
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-md text-sm font-bold',
            platformMode ? 'bg-brand text-brand-foreground' : 'bg-primary text-primary-foreground',
          )}
          aria-hidden
        >
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      {compact ? null : (
        <span className="truncate text-sm font-semibold tracking-tight">
          {logoUrl && ref?.source === 'tenant' ? <span className="sr-only">{name}</span> : name}
        </span>
      )}
    </Link>
  );
}
