'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@aivoryx/ui';
import { useAccess } from '@/lib/navigation/use-access';
import { useSources } from '@/lib/admin/use-integrations';
import { IntegrationEventsTable } from '@/components/admin/integration-events-table';
import { EmptyState, PageHeader, Skeleton } from '@/components/admin/ui';

function TopTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: '/admin/integrations', label: 'Connections' },
    { href: '/admin/integrations/events', label: 'Events' },
  ];
  return (
    <div className="flex gap-1 border-b">
      {tabs.map((t) => {
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

export default function IntegrationEventsPage() {
  const access = useAccess();
  const sources = useSources();

  if (access.isLoading) return <Skeleton rows={3} />;
  if (!access.can('crm.integrations.manage')) {
    return (
      <section className="space-y-6">
        <PageHeader title="Integrations" description="Inbound events for every connection." />
        <EmptyState title="You don't have access to integrations">
          Managing inbound connectors needs the &quot;Configure inbound lead connectors&quot;
          permission. Ask a workspace administrator to grant it.
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader title="Integrations" description="Inbound events for every connection." />
      <TopTabs />
      <IntegrationEventsTable sources={sources.data?.map((s) => ({ id: s.id, name: s.name }))} />
    </section>
  );
}
