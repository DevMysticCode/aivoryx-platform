'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useCustomer, useUpdateCustomer } from '@/lib/commercial/use-commercial';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, Field, Skeleton } from '@/components/admin/ui';
import { fmtDate, Select, SupplyStatusBadge } from '@/components/supply/ui';
import { CustomerFinanceCard } from '@/components/finance/summary-card';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const perms = usePermissions();
  const canUpdate = perms.includes('customers.update');

  const customer = useCustomer(id);
  const update = useUpdateCustomer(id);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  if (customer.isLoading) return <Skeleton rows={6} />;
  if (customer.error) return <ErrorNote error={customer.error} />;
  if (!customer.data) return <EmptyState>Customer not found.</EmptyState>;
  const c = customer.data;

  const startEdit = () => {
    setForm({
      name: c.name,
      phone: c.phone ?? '',
      email: c.email ?? '',
      addressLine: c.addressLine ?? '',
      city: c.city ?? '',
      state: c.state ?? '',
      taxReference: c.taxReference ?? '',
      status: c.status,
    });
    setEdit(true);
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            <SupplyStatusBadge status={c.status} />
          </div>
          <p className="font-mono text-xs text-muted-foreground">{c.number}</p>
        </div>
        {canUpdate && !edit ? (
          <Button variant="outline" onClick={startEdit}>
            Edit
          </Button>
        ) : null}
      </div>

      {edit ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Edit customer</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await update.mutateAsync({
                name: form.name,
                phone: form.phone || undefined,
                email: form.email || undefined,
                addressLine: form.addressLine || undefined,
                city: form.city || undefined,
                state: form.state || undefined,
                taxReference: form.taxReference || undefined,
                status: form.status as 'prospect' | 'active' | 'inactive',
              });
              setEdit(false);
            }}
            className="grid gap-3 sm:grid-cols-3"
          >
            {(
              [
                ['name', 'Name'],
                ['phone', 'Phone'],
                ['email', 'Email'],
                ['addressLine', 'Address'],
                ['city', 'City'],
                ['state', 'State'],
                ['taxReference', 'Tax / GST ref'],
              ] as const
            ).map(([key, label]) => (
              <Field
                key={key}
                label={label}
                value={form[key] ?? ''}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
              />
            ))}
            <Select
              label="Status"
              value={form.status ?? 'prospect'}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {['prospect', 'active', 'inactive'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <div className="flex items-end gap-2 sm:col-span-3">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEdit(false)}>
                Cancel
              </Button>
            </div>
          </form>
          <ErrorNote error={update.error} />
        </Card>
      ) : (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Details</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <Detail label="Phone" value={c.phone} />
            <Detail label="Email" value={c.email} />
            <Detail label="Tax / GST ref" value={c.taxReference} />
            <Detail
              label="Address"
              value={[c.addressLine, c.city, c.state].filter(Boolean).join(', ') || null}
            />
            <Detail label="Created" value={fmtDate(c.createdAt)} />
          </dl>
          {c.notes ? (
            <p className="border-t pt-3 text-sm text-muted-foreground">{c.notes}</p>
          ) : null}
        </Card>
      )}

      <CustomerFinanceCard customerId={id} />

      <div className="grid gap-4 md:grid-cols-3">
        <LinkCard title="Leads" items={c.leads} hrefBase="/crm/leads" />
        <LinkCard title="Quotations" items={c.quotations} hrefBase="/quotations" />
        <LinkCard title="Projects" items={c.projects} hrefBase="/projects" />
      </div>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{value || '—'}</dd>
    </div>
  );
}

function LinkCard({
  title,
  items,
  hrefBase,
}: {
  title: string;
  items: { id: string; label: string; status: string | null }[];
  hrefBase: string;
}) {
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {items.length > 0 ? (
        <ul className="space-y-1.5 text-sm">
          {items.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2">
              <Link href={`${hrefBase}/${it.id}`} className="text-primary hover:underline">
                {it.label}
              </Link>
              {it.status ? <SupplyStatusBadge status={it.status} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">None.</p>
      )}
    </Card>
  );
}
