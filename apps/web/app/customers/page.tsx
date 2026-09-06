'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useCreateCustomer, useCustomers } from '@/lib/commercial/use-commercial';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, Field, PageHeader, Skeleton } from '@/components/admin/ui';
import { fmtDate, Pager, Select, SupplyStatusBadge, Table } from '@/components/supply/ui';

const STATUSES = ['prospect', 'active', 'inactive'];

export default function CustomersPage() {
  const perms = usePermissions();
  const canCreate = perms.includes('customers.create');

  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const customers = useCustomers({
    q: q || undefined,
    status: status || undefined,
    page,
    pageSize,
  });
  const totalPages = customers.data ? Math.max(1, Math.ceil(customers.data.total / pageSize)) : 1;

  const createCustomer = useCreateCustomer();
  const [form, setForm] = useState({ name: '', phone: '', email: '', taxReference: '' });

  return (
    <section className="space-y-6">
      <PageHeader
        title="Customers"
        description="The reusable commercial party. A qualified lead is promoted to a customer at booking."
      />

      {canCreate ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">New customer</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!form.name) return;
              await createCustomer.mutateAsync({
                name: form.name,
                phone: form.phone || undefined,
                email: form.email || undefined,
                taxReference: form.taxReference || undefined,
              });
              setForm({ name: '', phone: '', email: '', taxReference: '' });
            }}
            className="grid gap-3 sm:grid-cols-4"
          >
            <Field
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Field
              label="Phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <Field
              label="Email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
            <Field
              label="Tax / GST ref"
              value={form.taxReference}
              onChange={(e) => setForm({ ...form, taxReference: e.target.value })}
            />
            <div className="sm:col-span-4">
              <Button type="submit" disabled={createCustomer.isPending || !form.name}>
                {createCustomer.isPending ? 'Creating…' : 'Create customer'}
              </Button>
            </div>
          </form>
          <ErrorNote error={createCustomer.error} />
        </Card>
      ) : null}

      <Card className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Search"
          placeholder="Name, number, phone or email"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
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
          {customers.data ? `${customers.data.total} customer(s)` : ''}
        </div>
      </Card>

      {customers.isLoading ? (
        <Skeleton rows={6} />
      ) : customers.error ? (
        <ErrorNote error={customers.error} />
      ) : customers.data && customers.data.items.length > 0 ? (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Contact</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            }
          >
            {customers.data.items.map((c) => (
              <tr key={c.id} className="hover:bg-accent/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/customers/${c.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {c.name}
                  </Link>
                  <div className="font-mono text-xs text-muted-foreground">{c.number}</div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {[c.phone, c.email].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="px-3 py-2">
                  <SupplyStatusBadge status={c.status} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(c.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </>
      ) : (
        <EmptyState>No customers match these filters yet.</EmptyState>
      )}
    </section>
  );
}
