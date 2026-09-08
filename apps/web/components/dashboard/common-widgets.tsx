'use client';

import Link from 'next/link';
import { type Plus, Users, FileText, Wallet, CalendarClock } from 'lucide-react';
import { useAccess } from '@/lib/navigation/use-access';
import { WidgetCard } from './widget-card';

/** Fast entry points, each gated by module + permission (§4 "quick create"). */
export function QuickActionsWidget() {
  const access = useAccess();
  const actions: { label: string; href: string; icon: typeof Plus; show: boolean }[] = [
    {
      label: 'New lead',
      href: '/crm/leads?new=1',
      icon: Users,
      show: access.hasModule('CRM') && access.can('crm.leads.create'),
    },
    {
      label: 'New customer',
      href: '/customers?new=1',
      icon: Users,
      show: access.hasModule('CRM') && access.can('customers.create'),
    },
    {
      label: 'New quotation',
      href: '/quotations?new=1',
      icon: FileText,
      show: access.hasModule('COMMERCIAL') && access.can('quotations.create'),
    },
    {
      label: 'New invoice',
      href: '/finance/invoices?new=1',
      icon: Wallet,
      show: access.hasModule('FINANCE') && access.can('finance.invoices.create'),
    },
    {
      label: 'Schedule visit',
      href: '/crm/visits',
      icon: CalendarClock,
      show: access.hasModule('FIELD') && access.can('field.visits.create'),
    },
  ].filter((a) => a.show);

  if (actions.length === 0) return null;

  return (
    <WidgetCard title="Quick actions">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            <a.icon className="size-4" aria-hidden />
            {a.label}
          </Link>
        ))}
      </div>
    </WidgetCard>
  );
}
