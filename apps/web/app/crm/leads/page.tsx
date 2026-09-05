'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useMembers } from '@/lib/admin/use-admin';
import { useCreateLead, useLeads } from '@/lib/crm/use-crm';
import {
  Card,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '@/components/admin/ui';

const STATUSES = ['NEW', 'ASSIGNED', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED'];

export default function LeadsPage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [assignedMembershipId, setAssignedMembershipId] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const members = useMembers();
  const leads = useLeads({
    q: q || undefined,
    status: status || undefined,
    assignedMembershipId: assignedMembershipId || undefined,
    page,
    pageSize,
  });

  const createLead = useCreateLead();
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const totalPages = leads.data ? Math.max(1, Math.ceil(leads.data.total / pageSize)) : 1;

  return (
    <section className="space-y-6">
      <PageHeader title="Leads" description="Search, filter, and work your pipeline." />

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">New lead</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const lead = await createLead.mutateAsync({
              name: newName || undefined,
              phone: newPhone || undefined,
            });
            setNewName('');
            setNewPhone('');
            router.push(`/crm/leads/${lead.id}`);
          }}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <Field label="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Field label="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
          <Button type="submit" disabled={createLead.isPending || (!newName && !newPhone)}>
            {createLead.isPending ? 'Creating…' : 'Add lead'}
          </Button>
        </form>
        <ErrorNote error={createLead.error} />
      </Card>

      <Card className="grid gap-3 sm:grid-cols-4">
        <Field
          label="Search"
          placeholder="Name, phone, or email"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Status</span>
          <select
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Assignee</span>
          <select
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            value={assignedMembershipId}
            onChange={(e) => {
              setAssignedMembershipId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Anyone</option>
            {(members.data ?? []).map((m) => (
              <option key={m.membershipId} value={m.membershipId}>
                {m.name ?? m.email}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end">
          <span className="text-sm text-muted-foreground">
            {leads.data ? `${leads.data.total} lead${leads.data.total === 1 ? '' : 's'}` : ''}
          </span>
        </div>
      </Card>

      {leads.isLoading ? (
        <Skeleton rows={6} />
      ) : leads.error ? (
        <ErrorNote error={leads.error} />
      ) : leads.data && leads.data.items.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-secondary/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Lead</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Assignee</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {leads.data.items.map((lead) => (
                  <tr key={lead.id} className="hover:bg-accent/40">
                    <td className="px-3 py-2">
                      <Link
                        href={`/crm/leads/${lead.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {lead.name ?? lead.phone ?? lead.email ?? 'Unnamed lead'}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {lead.phone ?? lead.email ?? ''}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {lead.sourceName ?? 'Manual'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {lead.assignee ? (lead.assignee.name ?? lead.assignee.email) : 'Unassigned'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(lead.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-sm">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <EmptyState>No leads match these filters yet.</EmptyState>
      )}
    </section>
  );
}
