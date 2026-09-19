'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useCreateWarehouse, useWarehouses } from '@/lib/supply/use-supply';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, Field, PageHeader, Skeleton } from '@/components/admin/ui';
import {
  ActiveBadge,
  FormDisclosure,
  JumpToFormButton,
  Select,
  Table,
} from '@/components/supply/ui';

const TYPES = ['main', 'regional', 'transit', 'site'] as const;

export default function WarehousesPage() {
  const perms = usePermissions();
  const canCreate = perms.includes('warehouses.create');

  const warehouses = useWarehouses();
  const createWarehouse = useCreateWarehouse();
  const [form, setForm] = useState<{
    code: string;
    name: string;
    type: (typeof TYPES)[number];
    city: string;
  }>({
    code: '',
    name: '',
    type: 'main',
    city: '',
  });

  return (
    <section className="space-y-6">
      <PageHeader
        title="Warehouses"
        description="Stock-holding locations. Receipts, allocations and dispatches all reference a warehouse."
      >
        {canCreate ? (
          <JumpToFormButton targetId="new-warehouse">New warehouse</JumpToFormButton>
        ) : null}
      </PageHeader>

      {canCreate ? (
        <FormDisclosure id="new-warehouse">
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">New warehouse</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!form.code || !form.name) return;
                await createWarehouse.mutateAsync({
                  code: form.code,
                  name: form.name,
                  type: form.type,
                  city: form.city || undefined,
                });
                setForm({ code: '', name: '', type: 'main', city: '' });
              }}
              className="grid gap-3 sm:grid-cols-4"
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
              <Select
                label="Type"
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as (typeof TYPES)[number] })
                }
              >
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <Field
                label="City"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
              <div className="sm:col-span-4">
                <Button
                  type="submit"
                  disabled={createWarehouse.isPending || !form.code || !form.name}
                >
                  {createWarehouse.isPending ? 'Creating…' : 'Create warehouse'}
                </Button>
              </div>
            </form>
            <ErrorNote error={createWarehouse.error} />
          </Card>
        </FormDisclosure>
      ) : null}

      {warehouses.isLoading ? (
        <Skeleton rows={4} />
      ) : warehouses.error ? (
        <ErrorNote error={warehouses.error} />
      ) : warehouses.data && warehouses.data.length > 0 ? (
        <Table
          head={
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">City</th>
              <th className="px-3 py-2 font-medium">Active</th>
            </tr>
          }
        >
          {warehouses.data.map((w) => (
            <tr key={w.id} className="hover:bg-surface-hover">
              <td className="px-3 py-2 font-medium">{w.name}</td>
              <td className="px-3 py-2 font-mono text-xs">{w.code}</td>
              <td className="px-3 py-2 capitalize text-muted-foreground">{w.type}</td>
              <td className="px-3 py-2 text-muted-foreground">{w.city ?? '—'}</td>
              <td className="px-3 py-2">
                <ActiveBadge active={w.isActive} />
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <EmptyState
          title="No warehouses yet"
          action={
            canCreate ? (
              <JumpToFormButton targetId="new-warehouse">Add a warehouse</JumpToFormButton>
            ) : undefined
          }
        >
          Warehouses are the locations where stock is held. Add one before receiving goods or
          dispatching materials.
        </EmptyState>
      )}
    </section>
  );
}
