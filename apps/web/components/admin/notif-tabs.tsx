'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@aivoryx/ui';

const TABS = [
  { href: '/admin/notifications', label: 'Rules' },
  { href: '/admin/notifications/templates', label: 'Templates' },
  { href: '/admin/notifications/deliveries', label: 'Deliveries' },
];

export function NotifTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b">
      {TABS.map((t) => {
        const current = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              current
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
