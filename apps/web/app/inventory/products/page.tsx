'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import {
  useCategories,
  useCreateProduct,
  useProducts,
  useUnits,
  useUpsertCategory,
  useUpsertUnit,
} from '@/lib/supply/use-supply';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, Field, PageHeader, Skeleton } from '@/components/admin/ui';
import { fmtQty, Pager, Select, Table } from '@/components/supply/ui';

export default function ProductsPage() {
  const perms = usePermissions();
  const canCreate = perms.includes('products.create');

  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const products = useProducts({
    q: q || undefined,
    categoryId: categoryId || undefined,
    page,
    pageSize,
  });
  const units = useUnits();
  const categories = useCategories();
  const totalPages = products.data ? Math.max(1, Math.ceil(products.data.total / pageSize)) : 1;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Products"
        description="Provider-neutral item master used across procurement, inventory and dispatch."
      />

      {canCreate ? <MasterDataForms /> : null}
      {canCreate ? (
        <NewProductForm units={units.data ?? []} categories={categories.data ?? []} />
      ) : null}

      <Card className="grid gap-3 sm:grid-cols-3">
        <Field
          label="Search"
          placeholder="SKU or name"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <Select
          label="Category"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All categories</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <div className="flex items-end text-sm text-muted-foreground">
          {products.data ? `${products.data.total} product(s)` : ''}
        </div>
      </Card>

      {products.isLoading ? (
        <Skeleton rows={6} />
      ) : products.error ? (
        <ErrorNote error={products.error} />
      ) : products.data && products.data.items.length > 0 ? (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Unit</th>
                <th className="px-3 py-2 text-right font-medium">Reorder level</th>
                <th className="px-3 py-2 font-medium">Active</th>
              </tr>
            }
          >
            {products.data.items.map((p) => (
              <tr key={p.id} className="hover:bg-accent/40">
                <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{p.name}</div>
                  {p.brand || p.model ? (
                    <div className="text-xs text-muted-foreground">
                      {[p.brand, p.model].filter(Boolean).join(' ')}
                    </div>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{p.categoryName ?? '—'}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.unitCode}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">
                  {fmtQty(p.reorderLevel)}
                </td>
                <td className="px-3 py-2 text-xs">{p.isActive ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </>
      ) : (
        <EmptyState>No products yet.</EmptyState>
      )}
    </section>
  );
}

function MasterDataForms() {
  const upsertUnit = useUpsertUnit();
  const upsertCategory = useUpsertCategory();
  const [unit, setUnit] = useState({ code: '', name: '' });
  const [cat, setCat] = useState({ code: '', name: '' });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Add unit</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!unit.code || !unit.name) return;
            await upsertUnit.mutateAsync(unit);
            setUnit({ code: '', name: '' });
          }}
          className="grid gap-2 sm:grid-cols-[100px_1fr_auto] sm:items-end"
        >
          <Field
            label="Code"
            value={unit.code}
            onChange={(e) => setUnit({ ...unit, code: e.target.value })}
          />
          <Field
            label="Name"
            value={unit.name}
            onChange={(e) => setUnit({ ...unit, name: e.target.value })}
          />
          <Button type="submit" disabled={upsertUnit.isPending}>
            Save
          </Button>
        </form>
        <ErrorNote error={upsertUnit.error} />
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Add category</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!cat.code || !cat.name) return;
            await upsertCategory.mutateAsync(cat);
            setCat({ code: '', name: '' });
          }}
          className="grid gap-2 sm:grid-cols-[100px_1fr_auto] sm:items-end"
        >
          <Field
            label="Code"
            value={cat.code}
            onChange={(e) => setCat({ ...cat, code: e.target.value })}
          />
          <Field
            label="Name"
            value={cat.name}
            onChange={(e) => setCat({ ...cat, name: e.target.value })}
          />
          <Button type="submit" disabled={upsertCategory.isPending}>
            Save
          </Button>
        </form>
        <ErrorNote error={upsertCategory.error} />
      </Card>
    </div>
  );
}

function NewProductForm({
  units,
  categories,
}: {
  units: { id: string; code: string; name: string }[];
  categories: { id: string; name: string }[];
}) {
  const createProduct = useCreateProduct();
  const [form, setForm] = useState({
    sku: '',
    name: '',
    unitId: '',
    categoryId: '',
    brand: '',
    model: '',
    reorderLevel: '',
  });

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">New product</h2>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.sku || !form.name || !form.unitId) return;
          await createProduct.mutateAsync({
            sku: form.sku,
            name: form.name,
            unitId: form.unitId,
            categoryId: form.categoryId || undefined,
            brand: form.brand || undefined,
            model: form.model || undefined,
            reorderLevel: form.reorderLevel || undefined,
          });
          setForm({
            sku: '',
            name: '',
            unitId: '',
            categoryId: '',
            brand: '',
            model: '',
            reorderLevel: '',
          });
        }}
        className="grid gap-3 sm:grid-cols-3"
      >
        <Field
          label="SKU"
          value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
        />
        <Field
          label="Name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Select
          label="Unit"
          value={form.unitId}
          onChange={(e) => setForm({ ...form, unitId: e.target.value })}
        >
          <option value="">Select unit…</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.code} — {u.name}
            </option>
          ))}
        </Select>
        <Select
          label="Category (optional)"
          value={form.categoryId}
          onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
        >
          <option value="">None</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Field
          label="Brand (optional)"
          value={form.brand}
          onChange={(e) => setForm({ ...form, brand: e.target.value })}
        />
        <Field
          label="Model (optional)"
          value={form.model}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
        />
        <Field
          label="Reorder level (optional)"
          value={form.reorderLevel}
          inputMode="decimal"
          onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
        />
        <div className="sm:col-span-3">
          <Button
            type="submit"
            disabled={createProduct.isPending || !form.sku || !form.name || !form.unitId}
          >
            {createProduct.isPending ? 'Creating…' : 'Create product'}
          </Button>
        </div>
      </form>
      <ErrorNote error={createProduct.error} />
    </Card>
  );
}
