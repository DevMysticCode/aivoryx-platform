'use client';

import Link from 'next/link';
import { cn } from '@aivoryx/ui';
import { useMe } from '@/lib/admin/use-admin';
import { useLogoObjectUrl } from '@/lib/settings/use-settings';
import { useAppearance } from '@/components/theme-provider';
import type { LogoKind } from '@/lib/api/settings';

interface BrandingAssets {
  displayName?: string;
  hasLogo?: boolean;
  hasLightLogo?: boolean;
  hasDarkLogo?: boolean;
  hasCompactLogo?: boolean;
}

/**
 * The workspace identity in the shell: the tenant's logo (compact in the
 * collapsed rail, light/dark variant matching the appearance) or, without one, a
 * monogram, plus the display name. Platform-admin mode keeps a fixed Aivoryx navy
 * mark — a deliberate cue that this is platform identity, not a tenant workspace.
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
  const branding = me.data?.active?.branding as BrandingAssets | undefined;
  const platformMode = platformRoute || (me.data?.isPlatformAdmin && !me.data.active);
  const name = platformMode ? 'Aivoryx Platform' : branding?.displayName?.trim() || 'Aivoryx';

  const kind: LogoKind | null = platformMode
    ? null
    : compact
      ? branding?.hasCompactLogo
        ? 'logo_compact'
        : null
      : resolved === 'dark' && branding?.hasDarkLogo
        ? 'logo_dark'
        : resolved === 'light' && branding?.hasLightLogo
          ? 'logo_light'
          : branding?.hasLogo
            ? 'logo'
            : null;

  const logoUrl = useLogoObjectUrl(!!kind, name, kind ?? 'logo');

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
          {logoUrl && !platformMode ? <span className="sr-only">{name}</span> : name}
        </span>
      )}
    </Link>
  );
}
