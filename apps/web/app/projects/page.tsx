'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useLeads } from '@/lib/crm/use-crm';
import { useCreateProject, useProjects } from '@/lib/supply/use-supply';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, PageHeader, Skeleton } from '@/components/admin/ui';
import { fmtDate, Pager, Select, SupplyStatusBadge, Table } from '@/components/supply/ui';

const STATUSES = [
  'DRAFT',
  'APPROVED',
  'PROCUREMENT',
  'READY_FOR_DISPATCH',
  'IN_PROGRESS',
  'COMPLETED',
  'ON_HOLD',
  'CANCELLED',
];

export default function ProjectsPage() {
  const router = useRouter();
  const perms = usePermissions();
  const canCreate = perms.includes('projects.create');

  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const projects = useProjects({
    status: status || undefined,
    q: q || undefined,
    page,
    pageSize,
  });

  const leads = useLeads({ pageSize: 100 });
  const createProject = useCreateProject();
  const [leadId, setLeadId] = useState('');
  const [customerName, setCustomerName] = useState('');

  const totalPages = projects.data ? Math.max(1, Math.ceil(projects.data.total / pageSize)) : 1;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Projects"
        description="Operational projects bridge a won CRM lead to procurement, inventory and delivery."
      />

      {canCreate ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">New project</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!leadId) return;
              const project = await createProject.mutateAsync({
                leadId,
                customerName: customerName || undefined,
              });
              setLeadId('');
              setCustomerName('');
              router.push(`/projects/${project.id}`);
            }}
            className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          >
            <Select label="CRM lead" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
              <option value="">Select a lead…</option>
              {(leads.data?.items ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name ?? l.phone ?? l.email ?? l.id.slice(0, 8)}
                </option>
              ))}
            </Select>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Customer name (optional)</span>
              <input
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </label>
            <Button type="submit" disabled={!leadId || createProject.isPending}>
              {createProject.isPending ? 'Creating…' : 'Create'}
            </Button>
          </form>
          <ErrorNote error={createProject.error} />
        </Card>
      ) : null}

      <Card className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Search</span>
          <input
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            placeholder="Project number or customer"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <div className="flex items-end text-sm text-muted-foreground">
          {projects.data ? `${projects.data.total} project(s)` : ''}
        </div>
      </Card>

      {projects.isLoading ? (
        <Skeleton rows={6} />
      ) : projects.error ? (
        <ErrorNote error={projects.error} />
      ) : projects.data && projects.data.items.length > 0 ? (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Site</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            }
          >
            {projects.data.items.map((p) => (
              <tr key={p.id} className="hover:bg-accent/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/projects/${p.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {p.number}
                  </Link>
                  <div className="text-xs text-muted-foreground">{p.leadName ?? 'Linked lead'}</div>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{p.customerName ?? '—'}</td>
                <td className="px-3 py-2">
                  <SupplyStatusBadge status={p.status} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {[p.siteCity, p.siteState].filter(Boolean).join(', ') || '—'}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(p.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </>
      ) : (
        <EmptyState>No projects match these filters yet.</EmptyState>
      )}
    </section>
  );
}
