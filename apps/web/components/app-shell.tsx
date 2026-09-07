'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { ChevronRight, Menu as MenuIcon, Search } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import { webEnv } from '@/lib/env';
import { NotificationBell } from '@/components/notification-bell';
import { BrandProvider } from '@/components/brand-provider';
import { AccountMenu } from '@/components/account-menu';
import { CommandPalette } from '@/components/ui/command-palette';
import { Sheet } from '@/components/ui/overlays';
import { useMe } from '@/lib/admin/use-admin';
import { useLogoObjectUrl } from '@/lib/settings/use-settings';
import { useNavigation } from '@/lib/navigation/use-navigation';
import { PLATFORM_NAV, MOBILE_PRIMARY_KEYS, type NavEntry } from '@/lib/navigation/registry';

/** Routes that render their own chrome (no shell). */
const BARE_PREFIXES = ['/field', '/login', '/accept-invitation'];

/**
 * The Aivoryx application shell (Phase 13B, ADR 0042). One product, three
 * form factors:
 *   - desktop: branded sidebar + top bar + constrained content column
 *   - tablet:  the same, sidebar collapsible
 *   - mobile:  top bar + bottom navigation + a "More" sheet
 *
 * Navigation comes from the centralized registry filtered by platform role,
 * tenant entitlements and effective permissions (`useNavigation`). Nothing here
 * is a security boundary — the backend guard is authoritative (§58).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  if (BARE_PREFIXES.some((p) => pathname.startsWith(p))) {
    return <>{children}</>;
  }

  const platformRoute = pathname.startsWith('/platform');

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <BrandProvider />

      {/* mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur md:hidden">
        <Brand platformRoute={platformRoute} />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Open command palette"
            className="rounded-md p-2 text-muted-foreground hover:bg-accent"
          >
            <Search className="size-4" />
          </button>
          <NotificationBell />
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-2 text-muted-foreground hover:bg-accent"
          >
            <MenuIcon className="size-4" />
          </button>
        </div>
      </header>

      <DesktopSidebar platformRoute={platformRoute} pathname={pathname} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* desktop top bar */}
        <div className="sticky top-0 z-20 hidden items-center justify-between border-b bg-background/95 px-4 py-2 backdrop-blur md:flex md:px-6">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
          >
            <Search className="size-4" />
            <span>Search or jump to…</span>
            <kbd className="ml-2 rounded border px-1.5 py-0.5 text-[10px]">⌘K</kbd>
          </button>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <AccountMenu />
          </div>
        </div>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-6 md:px-6 md:py-8">
          {children}
        </main>

        <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground md:px-6">
          <span>
            {platformRoute ? 'Aivoryx Platform' : 'Aivoryx'} · {webEnv.NEXT_PUBLIC_APP_ENV}
          </span>
          <span>Powered by Aivoryx™</span>
        </footer>
      </div>

      <MobileBottomNav
        pathname={pathname}
        platformRoute={platformRoute}
        onMore={() => setMoreOpen(true)}
      />

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Navigation">
        <MobileMoreNav pathname={pathname} platformRoute={platformRoute} />
        <div className="mt-3 border-t pt-3">
          <AccountMenu />
        </div>
      </Sheet>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function useShellNav(platformRoute: boolean) {
  const nav = useNavigation();
  if (platformRoute) return { isLoading: false, platformMode: true, entries: PLATFORM_NAV };
  return nav;
}

function isActive(pathname: string, href?: string): boolean {
  if (!href) return false;
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function DesktopSidebar({ platformRoute, pathname }: { platformRoute: boolean; pathname: string }) {
  const { platformMode, entries } = useShellNav(platformRoute);
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-secondary/20 md:flex">
      <div className="border-b px-4 py-3.5">
        <Brand platformRoute={platformMode} />
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {entries.map((entry) => (
          <SidebarEntry key={entry.key} entry={entry} pathname={pathname} />
        ))}
      </nav>
      {platformMode ? (
        <div className="border-t px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Platform administration
        </div>
      ) : null}
    </aside>
  );
}

function SidebarEntry({ entry, pathname }: { entry: NavEntry; pathname: string }) {
  const hasChildren = !!entry.children?.length;
  const active = isActive(pathname, entry.href);
  const childActive = entry.children?.some((c) => isActive(pathname, c.href));
  const [open, setOpen] = useState<boolean>(!!childActive);
  const Icon = entry.icon;

  if (!hasChildren) {
    return (
      <Link
        href={entry.href ?? '#'}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
          active
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        )}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        {entry.label}
      </Link>
    );
  }

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={entry.href ?? '#'}
          className={cn(
            'flex flex-1 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
            active || childActive
              ? 'font-medium text-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          {entry.label}
        </Link>
        <button
          type="button"
          aria-label={open ? `Collapse ${entry.label}` : `Expand ${entry.label}`}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />
        </button>
      </div>
      {open ? (
        <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-3">
          {entry.children!.map((child) => {
            const ca = isActive(pathname, child.href);
            return (
              <Link
                key={child.key}
                href={child.href ?? '#'}
                aria-current={ca ? 'page' : undefined}
                className={cn(
                  'block rounded-md px-3 py-1.5 text-sm transition-colors',
                  ca
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {child.label}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function flatten(entries: NavEntry[]): NavEntry[] {
  return entries.flatMap((e) => (e.children?.length ? [e, ...e.children] : [e]));
}

function MobileBottomNav({
  pathname,
  platformRoute,
  onMore,
}: {
  pathname: string;
  platformRoute: boolean;
  onMore: () => void;
}) {
  const { entries } = useShellNav(platformRoute);
  const flat = flatten(entries);
  const primary = platformRoute
    ? entries.slice(0, 4)
    : (MOBILE_PRIMARY_KEYS.map((k) => flat.find((e) => e.key === k)).filter(Boolean) as NavEntry[]);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t bg-background/95 backdrop-blur md:hidden">
      {primary.map((entry) => {
        const active = isActive(pathname, entry.href);
        const Icon = entry.icon;
        return (
          <Link
            key={entry.key}
            href={entry.href ?? '#'}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon className="size-5" aria-hidden />
            <span className="truncate">{entry.label.split(' ')[0]}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground"
      >
        <MenuIcon className="size-5" aria-hidden />
        <span>More</span>
      </button>
    </nav>
  );
}

function MobileMoreNav({ pathname, platformRoute }: { pathname: string; platformRoute: boolean }) {
  const { entries } = useShellNav(platformRoute);
  return (
    <div className="space-y-0.5">
      {flatten(entries).map((entry) => {
        const active = isActive(pathname, entry.href);
        const Icon = entry.icon;
        return (
          <Link
            key={entry.key}
            href={entry.href ?? '#'}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm',
              active
                ? 'bg-primary/10 font-medium text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {entry.label}
          </Link>
        );
      })}
    </div>
  );
}

function Brand({ platformRoute }: { platformRoute?: boolean }) {
  const me = useMe();
  const branding = me.data?.active?.branding;
  const platformMode = platformRoute || (me.data?.isPlatformAdmin && !me.data.active);
  const name = platformMode ? 'Aivoryx Platform' : branding?.displayName?.trim() || 'Aivoryx';
  const logoUrl = useLogoObjectUrl(
    !platformMode && !!branding?.hasLogo,
    branding?.displayName ?? null,
  );

  return (
    <Link href={platformMode ? '/platform' : '/'} className="flex items-center gap-2">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={`${name} logo`}
          className="size-7 shrink-0 rounded-md object-contain"
        />
      ) : (
        <span
          className={cn(
            'grid size-7 shrink-0 place-items-center rounded-md text-sm font-bold',
            platformMode ? 'bg-foreground text-background' : 'bg-primary text-primary-foreground',
          )}
          aria-hidden
        >
          {name.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="truncate text-sm font-semibold tracking-tight">{name}</span>
    </Link>
  );
}
