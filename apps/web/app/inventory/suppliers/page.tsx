'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useCreateSupplier, useSuppliers } from '@/lib/supply/use-supply';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, Field, PageHeader, Skeleton } from '@/components/admin/ui';
import { Table } from '@/components/supply/ui';

export default function SuppliersPage() {
  const perms = usePermissions();
  const canCreate = perms.includes('suppliers.create');

  const [q, setQ] = useState('');
  const suppliers = useSuppliers(q || undefined);
  const createSupplier = useCreateSupplier();
  const [form, setForm] = useState({
    code: '',
    name: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
  });

  return (
    <section className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Vendors you raise purchase orders against. Not an accounting ledger."
      />

      {canCreate ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">New supplier</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!form.code || !form.name) return;
              await createSupplier.mutateAsync({
                code: form.code,
                name: form.name,
                contactName: form.contactName || undefined,
                contactEmail: form.contactEmail || undefined,
                contactPhone: form.contactPhone || undefined,
              });
              setForm({ code: '', name: '', contactName: '', contactEmail: '', contactPhone: '' });
            }}
            className="grid gap-3 sm:grid-cols-3"
          >
            <Field
              label="Code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
            <Field
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <Field
              label="Contact name"
              value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })}
            />
            <Field
              label="Contact email"
              value={form.contactEmail}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            />
            <Field
              label="Contact phone"
              value={form.contactPhone}
              onChange={(e) => setForm({ ...form, contactPhone: e.target.value })}
            />
            <div className="flex items-end">
              <Button type="submit" disabled={createSupplier.isPending || !form.code || !form.name}>
                {createSupplier.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </form>
          <ErrorNote error={createSupplier.error} />
        </Card>
      ) : null}

      <Card>
        <Field
          label="Search"
          placeholder="Code or name"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </Card>

      {suppliers.isLoading ? (
        <Skeleton rows={5} />
      ) : suppliers.error ? (
        <ErrorNote error={suppliers.error} />
      ) : suppliers.data && suppliers.data.length > 0 ? (
        <Table
          head={
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Contact</th>
              <th className="px-3 py-2 font-medium">Active</th>
            </tr>
          }
        >
          {suppliers.data.map((s) => (
            <tr key={s.id} className="hover:bg-accent/40">
              <td className="px-3 py-2 font-mono text-xs">{s.code}</td>
              <td className="px-3 py-2 font-medium">{s.name}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {[s.contactName, s.contactEmail, s.contactPhone].filter(Boolean).join(' · ') || '—'}
              </td>
              <td className="px-3 py-2 text-xs">{s.isActive ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState>No suppliers yet.</EmptyState>
      )}
    </section>
  );
}
