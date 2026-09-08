'use client';

import { PageHeader } from '@/components/admin/ui';
import { ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { usePlatformModules } from '@/lib/platform/use-platform';

const CATEGORY_LABEL: Record<string, string> = {
  sales: 'Sales',
  operations: 'Operations',
  finance: 'Finance',
  people: 'People',
};

export default function PlatformModulesPage() {
  const modules = usePlatformModules();

  const grouped = (modules.data ?? [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .reduce<Record<string, typeof modules.data>>((acc, m) => {
      (acc[m.category] ??= []).push(m);
      return acc;
    }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="Module catalogue"
        description="The product modules Aivoryx can provision. The catalogue is fixed in code; entitlements are per company."
      />

      {modules.isLoading ? (
        <LoadingBlock />
      ) : modules.error ? (
        <ErrorBlock error={modules.error} onRetry={() => modules.refetch()} />
      ) : (
        Object.entries(grouped).map(([category, list]) => (
          <section key={category} className="rounded-lg border">
            <div className="border-b px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {CATEGORY_LABEL[category] ?? category}
            </div>
            <ul className="divide-y">
              {(list ?? []).map((m) => (
                <li key={m.key} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{m.displayName}</span>
                    <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {m.key}
                    </code>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{m.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{m.capabilitySummary}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {m.dependencies.length > 0
                      ? `Requires ${m.dependencies.join(', ')}`
                      : 'No dependencies'}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
