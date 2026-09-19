'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { HelpCircle, Menu as MenuIcon, Search } from 'lucide-react';
import { IconButton, Tooltip, cn } from '@aivoryx/ui';
import { webEnv } from '@/lib/env';
import { NotificationBell } from '@/components/notification-bell';
import { BrandProvider } from '@/components/brand-provider';
import { BrandMark } from '@/components/brand-mark';
import { AccountMenu } from '@/components/account-menu';
import { CommandPalette } from '@/components/ui/command-palette';
import { Sheet } from '@/components/ui/overlays';
import { HelpCenter } from '@/components/help/help-center';
import { FeatureTourHost } from '@/components/help/feature-tour';
import { Sidebar, useSidebarCollapsed } from '@/components/navigation/sidebar';
import { useNavigation } from '@/lib/navigation/use-navigation';
import {
  PLATFORM_NAV,
  MOBILE_PRIMARY_KEYS,
  entryMatchesPath,
  type NavEntry,
} from '@/lib/navigation/registry';

/** Routes that render their own chrome (no shell). */
const BARE_PREFIXES = ['/field', '/login', '/accept-invitation'];

/**
 * The Aivoryx application shell (Phase 13B, ADR 0042; UI 2.0 in Phase 19,
 * ADR 0046). One product, three form factors:
 *   - desktop: adaptive sidebar (collapsible to an icon rail) + quiet header
 *   - tablet:  the same
 *   - mobile:  top bar + bottom navigation + a "More" sheet (unchanged pattern)
 *
 * Navigation comes from the centralized registry filtered by platform role,
 * tenant entitlements and effective permissions (`useNavigation`). Nothing here
 * is a security boundary — the backend guard is authoritative (§58).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  // Bare routes (sign-in, invitation, the Field PWA) must not touch the session
  // query before the user has signed in: a cached `/auth/me` from a previous
  // sign-in would otherwise show the wrong identity right after login.
  if (BARE_PREFIXES.some((p) => pathname.startsWith(p))) {
    return (
      <>
        <BrandProvider
          disabled={pathname.startsWith('/login') || pathname.startsWith('/accept-invitation')}
        />
        {children}
      </>
    );
  }
  return <ShellFrame pathname={pathname}>{children}</ShellFrame>;
}

function ShellFrame({ pathname, children }: { pathname: string; children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [collapsed, setCollapsed] = useSidebarCollapsed();

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

  const platformRoute = pathname.startsWith('/platform');
  const { entries, platformMode } = useShellNav(platformRoute);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <BrandProvider platformOnly={platformRoute} />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur md:hidden">
        <BrandMark platformRoute={platformRoute} />
        <div className="flex items-center gap-0.5">
          <IconButton aria-label="Search" onClick={() => setPaletteOpen(true)}>
            <Search className="size-4" aria-hidden />
          </IconButton>
          <NotificationBell />
          <IconButton aria-label="Open navigation" onClick={() => setMoreOpen(true)}>
            <MenuIcon className="size-4" aria-hidden />
          </IconButton>
        </div>
      </header>

      <Sidebar
        entries={entries}
        pathname={pathname}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed(!collapsed)}
        platformRoute={platformMode}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <DesktopHeader onSearch={() => setPaletteOpen(true)} onHelp={() => setHelpOpen(true)} />

        <main
          id="main"
          className="mx-auto w-full max-w-[84rem] flex-1 px-4 pb-24 pt-5 md:px-6 md:pb-10 md:pt-7"
        >
          {children}
        </main>

        <footer className="mt-auto hidden flex-wrap items-center justify-between gap-2 border-t border-border-subtle px-4 py-3 text-xs text-subtle md:flex md:px-6">
          <span>
            {platformRoute ? 'Aivoryx Platform' : 'Aivoryx'} · {webEnv.NEXT_PUBLIC_APP_ENV}
          </span>
          <span>Powered by Aivoryx™</span>
        </footer>
      </div>

      <MobileBottomNav
        entries={entries}
        pathname={pathname}
        platformRoute={platformRoute}
        onMore={() => setMoreOpen(true)}
      />

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="Navigation">
        <MobileMoreNav entries={entries} pathname={pathname} />
        <div className="mt-3 space-y-1 border-t pt-3">
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false);
              setHelpOpen(true);
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
          >
            <HelpCircle className="size-4" aria-hidden />
            Help
          </button>
          <AccountMenu />
        </div>
      </Sheet>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <HelpCenter open={helpOpen} onClose={() => setHelpOpen(false)} />
      <FeatureTourHost />
    </div>
  );
}

function useShellNav(platformRoute: boolean) {
  const nav = useNavigation();
  if (platformRoute) return { isLoading: false, platformMode: true, entries: PLATFORM_NAV };
  return nav;
}

/** Quiet desktop header: workspace context, search, then help / notifications / account. */
function DesktopHeader({ onSearch, onHelp }: { onSearch: () => void; onHelp: () => void }) {
  return (
    <div className="sticky top-0 z-20 hidden h-14 items-center gap-3 border-b border-border-subtle bg-background/90 px-4 backdrop-blur md:flex md:px-6">
      <button
        type="button"
        data-tour="search"
        onClick={onSearch}
        className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-subtle hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus md:max-w-md"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="truncate">Search or jump to…</span>
        <kbd className="ml-auto hidden whitespace-nowrap rounded border bg-background-muted px-1.5 py-0.5 text-[10px] lg:block">
          Ctrl K
        </kbd>
      </button>
      <div className="ml-auto flex items-center gap-1">
        <Tooltip label="Help">
          <IconButton data-tour="help" aria-label="Help" onClick={onHelp}>
            <HelpCircle className="size-4" aria-hidden />
          </IconButton>
        </Tooltip>
        <NotificationBell />
        <div data-tour="account">
          <AccountMenu />
        </div>
      </div>
    </div>
  );
}

function flatten(entries: NavEntry[]): NavEntry[] {
  return entries.flatMap((e) => (e.children?.length ? [e, ...e.children] : [e]));
}

function MobileBottomNav({
  entries,
  pathname,
  platformRoute,
  onMore,
}: {
  entries: NavEntry[];
  pathname: string;
  platformRoute: boolean;
  onMore: () => void;
}) {
  const flat = flatten(entries);
  const primary = platformRoute
    ? entries.slice(0, 4)
    : (MOBILE_PRIMARY_KEYS.map((k) => flat.find((e) => e.key === k)).filter(Boolean) as NavEntry[]);

  const isActive = (entry: NavEntry) =>
    entry.children?.length
      ? entry.children.some((c) => entryMatchesPath(c, pathname))
      : entryMatchesPath(entry, pathname);

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {primary.map((entry) => {
        const active = isActive(entry);
        const Icon = entry.icon;
        return (
          <Link
            key={entry.key}
            href={entry.href ?? '#'}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
              active ? 'font-medium text-primary' : 'text-muted-foreground',
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
        className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
      >
        <MenuIcon className="size-5" aria-hidden />
        <span>More</span>
      </button>
    </nav>
  );
}

function MobileMoreNav({ entries, pathname }: { entries: NavEntry[]; pathname: string }) {
  return (
    <nav aria-label="All navigation" className="space-y-0.5">
      {flatten(entries).map((entry) => {
        const Icon = entry.icon;
        if (entry.children?.length) {
          return (
            <p
              key={entry.key}
              className="flex items-center gap-2.5 px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-subtle"
            >
              <Icon className="size-3.5" aria-hidden />
              {entry.label}
            </p>
          );
        }
        const isSection = entry.key.includes('.');
        const active = entryMatchesPath(entry, pathname);
        return (
          <Link
            key={entry.key}
            href={entry.href ?? '#'}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm',
              isSection && 'ml-4',
              active
                ? 'bg-primary-soft font-medium text-primary'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}
