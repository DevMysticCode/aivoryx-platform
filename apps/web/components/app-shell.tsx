'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  Activity,
  Boxes,
  ClipboardList,
  Contact,
  FileText,
  FolderKanban,
  LayoutDashboard,
  Send,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import { webEnv } from '@/lib/env';
import { NotificationBell } from '@/components/notification-bell';
import { BrandProvider } from '@/components/brand-provider';
import { useMe } from '@/lib/admin/use-admin';
import { useLogoObjectUrl } from '@/lib/settings/use-settings';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/crm', label: 'CRM', icon: Users },
  { href: '/customers', label: 'Customers', icon: Contact },
  { href: '/quotations', label: 'Quotations', icon: FileText },
  { href: '/projects', label: 'Projects', icon: FolderKanban },
  { href: '/inventory/products', label: 'Inventory', icon: Boxes },
  { href: '/procurement/purchase-orders', label: 'Procurement', icon: ClipboardList },
  { href: '/logistics/dispatches', label: 'Logistics', icon: Send },
  { href: '/finance', label: 'Finance', icon: Wallet },
  { href: '/hr', label: 'HR & Workforce', icon: UserCog },
  { href: '/admin', label: 'Administration', icon: ShieldCheck },
  { href: '/settings/company', label: 'Settings', icon: Settings },
  { href: '/health', label: 'System health', icon: Activity },
];

/**
 * Production-quality application shell: a fixed sidebar on desktop, a top bar on
 * mobile, and a constrained content column. The workspace identity (name + logo)
 * comes from the tenant company profile (Phase 10, ADR 0039), falling back to
 * the Aivoryx mark when a workspace has not set its own — Aivoryx branding is
 * never fully removed.
 *
 * `/field/*` is a genuinely mobile-first PWA surface for field agents (Phase 4,
 * ADR 0033) with its own bottom-nav chrome (`app/field/layout.tsx`) — it opts
 * out of this desktop-oriented shell entirely rather than being squeezed into it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname?.startsWith('/field')) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <BrandProvider />
      <header className="flex items-center justify-between border-b px-4 py-3 md:hidden">
        <Brand />
        <NotificationBell />
      </header>

      <aside className="hidden w-60 shrink-0 border-r bg-secondary/30 p-4 md:block">
        <Brand />
        <nav className="mt-6 flex flex-col gap-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex flex-1 flex-col">
        <div className="hidden items-center justify-end border-b px-4 py-2 md:flex md:px-8">
          <NotificationBell />
        </div>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 md:px-8">{children}</main>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-xs text-muted-foreground md:px-8">
          <span>Aivoryx Platform · {webEnv.NEXT_PUBLIC_APP_ENV}</span>
          <span>Powered by Aivoryx™</span>
        </footer>
      </div>
    </div>
  );
}

function Brand() {
  const me = useMe();
  const branding = me.data?.active?.branding;
  const name = branding?.displayName?.trim() || 'Aivoryx';
  const logoUrl = useLogoObjectUrl(!!branding?.hasLogo, branding?.displayName ?? null);

  return (
    <div className="flex items-center gap-2">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={`${name} logo`}
          className="size-7 shrink-0 rounded-md object-contain"
        />
      ) : (
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"
          aria-hidden
        >
          <span className="text-sm font-bold">{name.charAt(0).toUpperCase()}</span>
        </span>
      )}
      <span className="truncate text-sm font-semibold tracking-tight">{name}</span>
    </div>
  );
}
