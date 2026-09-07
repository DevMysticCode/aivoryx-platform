'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { PageHeader, StatusBadge } from '@/components/admin/ui';
import { ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { usePlatformTenants } from '@/lib/platform/use-platform';

type SortKey = 'name' | 'members' | 'modules' | 'created';

export default function PlatformTenantsPage() {
  const tenants = usePlatformTenants();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'suspended'>('all');
  const [sort, setSort] = useState<SortKey>('name');

  const rows = useMemo(() => {
    let list = tenants.data ?? [];
    const query = q.trim().toLowerCase();
    if (query)
      list = list.filter((t) => t.name.toLowerCase().includes(query) || t.slug.includes(query));
    if (status !== 'all') list = list.filter((t) => t.status === status);
    return [...list].sort((a, b) => {
      if (sort === 'members') return b.memberCount - a.memberCount;
      if (sort === 'modules') return b.enabledModuleCount - a.enabledModuleCount;
      if (sort === 'created') return b.createdAt.localeCompare(a.createdAt);
      return a.name.localeCompare(b.name);
    });
  }, [tenants.data, q, status, sort]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Companies"
        description="Every Aivoryx workspace. Open one to manage its module entitlements."
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search companies…"
            className="h-9 w-full rounded-md border bg-transparent pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          aria-label="Status filter"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          aria-label="Sort"
        >
          <option value="name">Sort: Name</option>
          <option value="members">Sort: Members</option>
          <option value="modules">Sort: Modules</option>
          <option value="created">Sort: Newest</option>
        </select>
      </div>

      {tenants.isLoading ? (
        <LoadingBlock />
      ) : tenants.error ? (
        <ErrorBlock error={tenants.error} onRetry={() => tenants.refetch()} />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No companies match your filters.
        </p>
      ) : (
        <>
          {/* desktop table */}
          <div className="hidden overflow-hidden rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Company</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Members</th>
                  <th className="px-4 py-2.5 text-right font-medium">Modules</th>
                  <th className="px-4 py-2.5 font-medium">Created</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((t) => (
                  <tr key={t.id} className="hover:bg-accent/40">
                    <td className="px-4 py-3">
                      <Link
                        href={`/platform/tenants/${t.id}`}
                        className="font-medium hover:underline"
                      >
                        {t.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{t.slug}</span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.memberCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.enabledModuleCount}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/platform/tenants/${t.id}`}
                        className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                      >
                        Manage <ChevronRight className="size-3.5" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* mobile cards */}
          <ul className="space-y-2 md:hidden">
            {rows.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/platform/tenants/${t.id}`}
                  className="block rounded-lg border p-3 hover:bg-accent/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{t.name}</span>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t.slug} · {t.memberCount} members · {t.enabledModuleCount} modules
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
