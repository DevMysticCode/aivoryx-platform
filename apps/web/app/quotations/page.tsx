'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useLeads } from '@/lib/crm/use-crm';
import { useCreateQuotation, useCustomers, useQuotations } from '@/lib/commercial/use-commercial';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, PageHeader, Skeleton } from '@/components/admin/ui';
import { fmtDate, fmtMoney, Pager, Select, SupplyStatusBadge, Table } from '@/components/supply/ui';

const STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'BOOKED', 'CANCELLED', 'EXPIRED'];

export default function QuotationsPage() {
  const router = useRouter();
  const perms = usePermissions();
  const canCreate = perms.includes('quotations.create');

  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const quotations = useQuotations({
    status: status || undefined,
    q: q || undefined,
    page,
    pageSize,
  });
  const totalPages = quotations.data ? Math.max(1, Math.ceil(quotations.data.total / pageSize)) : 1;

  const leads = useLeads({ pageSize: 100 });
  const customers = useCustomers({ pageSize: 100 });
  const createQuotation = useCreateQuotation();
  const [leadId, setLeadId] = useState('');
  const [customerId, setCustomerId] = useState('');

  return (
    <section className="space-y-6">
      <PageHeader
        title="Quotations"
        description="Draft, send, accept and book. Booking activates the operational project."
      />

      {canCreate ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">New quotation</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!leadId) return;
              const created = await createQuotation.mutateAsync({
                leadId,
                customerId: customerId || undefined,
              });
              setLeadId('');
              setCustomerId('');
              router.push(`/quotations/${created.id}`);
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
            <Select
              label="Customer (optional)"
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Promote at booking</option>
              {(customers.data?.items ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.number})
                </option>
              ))}
            </Select>
            <Button type="submit" disabled={!leadId || createQuotation.isPending}>
              {createQuotation.isPending ? 'Creating…' : 'Create'}
            </Button>
          </form>
          <ErrorNote error={createQuotation.error} />
        </Card>
      ) : null}

      <Card className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Search</span>
          <input
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            placeholder="Quotation number"
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
              {s}
            </option>
          ))}
        </Select>
        <div className="flex items-end text-sm text-muted-foreground">
          {quotations.data ? `${quotations.data.total} quotation(s)` : ''}
        </div>
      </Card>

      {quotations.isLoading ? (
        <Skeleton rows={6} />
      ) : quotations.error ? (
        <ErrorNote error={quotations.error} />
      ) : quotations.data && quotations.data.items.length > 0 ? (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 font-medium">Quotation</th>
                <th className="px-3 py-2 font-medium">Customer / lead</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Valid until</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            }
          >
            {quotations.data.items.map((qt) => (
              <tr key={qt.id} className="hover:bg-accent/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/quotations/${qt.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {qt.number}
                  </Link>
                  <div className="text-xs text-muted-foreground">rev {qt.currentRevisionNo}</div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {qt.customerName ?? qt.leadName ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <SupplyStatusBadge status={qt.status} />
                </td>
                <td className="px-3 py-2 text-right">{fmtMoney(qt.total)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {fmtDate(qt.validityDate)}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(qt.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </>
      ) : (
        <EmptyState>No quotations match these filters yet.</EmptyState>
      )}
    </section>
  );
}
