import Link from 'next/link';
import type { ReactNode } from 'react';
import { Activity, LayoutDashboard, ShieldCheck } from 'lucide-react';
import { webEnv } from '@/lib/env';

const NAV = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/admin', label: 'Administration', icon: ShieldCheck },
  { href: '/health', label: 'System health', icon: Activity },
];

/**
 * Production-quality application shell: a fixed sidebar on desktop, a top bar on
 * mobile, and a constrained content column. Domain navigation is added per
 * module in later phases.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <header className="flex items-center justify-between border-b px-4 py-3 md:hidden">
        <Brand />
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
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 md:px-8">{children}</main>
        <footer className="border-t px-4 py-3 text-xs text-muted-foreground md:px-8">
          Aivoryx Platform · {webEnv.NEXT_PUBLIC_APP_ENV}
        </footer>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-md bg-primary text-primary-foreground">
        <span className="text-sm font-bold">A</span>
      </span>
      <span className="text-sm font-semibold tracking-tight">Aivoryx</span>
    </div>
  );
}
