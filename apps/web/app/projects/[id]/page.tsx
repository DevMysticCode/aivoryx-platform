'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Fragment, useState } from 'react';
import { Button } from '@aivoryx/ui';
import { useProducts, useWarehouses } from '@/lib/supply/use-supply';
import {
  useAddMaterial,
  useAllocateMaterial,
  useApproveProject,
  useProject,
  useProjectActivities,
  useReleaseMaterial,
  useRemoveMaterial,
  useSetProjectStatus,
} from '@/lib/supply/use-supply';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, Skeleton } from '@/components/admin/ui';
import { ProjectFinanceCard } from '@/components/finance/summary-card';
import { fmtQty, Select, SupplyStatusBadge, Table } from '@/components/supply/ui';
import type { ProjectMaterial } from '@aivoryx/contracts';

const NEXT_STATUSES: Record<string, string[]> = {
  APPROVED: ['PROCUREMENT', 'ON_HOLD', 'CANCELLED'],
  PROCUREMENT: ['READY_FOR_DISPATCH', 'ON_HOLD', 'CANCELLED'],
  READY_FOR_DISPATCH: ['IN_PROGRESS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['PROCUREMENT', 'READY_FOR_DISPATCH', 'IN_PROGRESS', 'CANCELLED'],
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const perms = usePermissions();
  const canUpdate = perms.includes('projects.update');
  const canApprove = perms.includes('projects.approve');
  const canAllocate = perms.includes('inventory.allocate');

  const project = useProject(id);
  const activities = useProjectActivities(id);
  const approve = useApproveProject(id);
  const setStatus = useSetProjectStatus(id);

  if (project.isLoading) return <Skeleton rows={8} />;
  if (project.error) return <ErrorNote error={project.error} />;
  if (!project.data) return <EmptyState>Project not found.</EmptyState>;

  const p = project.data;
  const nextStatuses = NEXT_STATUSES[p.status] ?? [];

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{p.number}</h1>
            <SupplyStatusBadge status={p.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {p.customerName ?? p.leadName ?? 'Project'} ·{' '}
            <Link href={`/crm/leads/${p.leadId}`} className="text-primary hover:underline">
              View CRM lead
            </Link>
          </p>
          {[p.siteAddressLine, p.siteCity, p.siteState].some(Boolean) ? (
            <p className="text-xs text-muted-foreground">
              Site: {[p.siteAddressLine, p.siteCity, p.siteState].filter(Boolean).join(', ')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {p.status !== 'DRAFT' ? (
            <Link
              href={`/projects/${p.id}/execution`}
              className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-accent"
            >
              Execution workspace
            </Link>
          ) : null}
          {p.status === 'DRAFT' && canApprove ? (
            <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
              {approve.isPending ? 'Approving…' : 'Approve project'}
            </Button>
          ) : null}
          {canUpdate && nextStatuses.length > 0 ? (
            <Select
              value=""
              onChange={(e) => {
                if (e.target.value) setStatus.mutate({ status: e.target.value as never });
              }}
              className="w-48"
            >
              <option value="">Change status…</option>
              {nextStatuses.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      </div>
      <ErrorNote error={approve.error || setStatus.error} />

      <MaterialsCard
        projectId={id}
        materials={p.materials}
        canUpdate={canUpdate}
        canAllocate={canAllocate}
        projectStatus={p.status}
      />

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Timeline</h2>
        {activities.isLoading ? (
          <Skeleton rows={3} />
        ) : activities.data && activities.data.length > 0 ? (
          <ol className="space-y-2 text-sm">
            {activities.data.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-4">
                <span className="capitalize">{a.type.replace(/_/g, ' ')}</span>
                <span className="text-xs text-muted-foreground">
                  {a.actorName ? `${a.actorName} · ` : ''}
                  {new Date(a.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        )}
      </Card>

      <ProjectFinanceCard projectId={id} />
    </section>
  );
}

function MaterialsCard({
  projectId,
  materials,
  canUpdate,
  canAllocate,
  projectStatus,
}: {
  projectId: string;
  materials: ProjectMaterial[];
  canUpdate: boolean;
  canAllocate: boolean;
  projectStatus: string;
}) {
  const products = useProducts({ isActive: true, pageSize: 100 });
  const addMaterial = useAddMaterial(projectId);
  const removeMaterial = useRemoveMaterial(projectId);
  const [productId, setProductId] = useState('');
  const [requiredQty, setRequiredQty] = useState('');
  const [allocRow, setAllocRow] = useState<string | null>(null);

  const terminal = projectStatus === 'COMPLETED' || projectStatus === 'CANCELLED';

  return (
    <Card className="space-y-4">
      <h2 className="text-sm font-semibold">Material requirements</h2>

      {materials.length > 0 ? (
        <Table
          head={
            <tr>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 text-right font-medium">Required</th>
              <th className="px-3 py-2 text-right font-medium">Allocated</th>
              <th className="px-3 py-2 text-right font-medium">Dispatched</th>
              <th className="px-3 py-2 text-right font-medium">Delivered</th>
              <th className="px-3 py-2 text-right font-medium">Remaining</th>
              <th className="px-3 py-2" />
            </tr>
          }
        >
          {materials.map((m) => (
            <Fragment key={m.id}>
              <tr className="hover:bg-accent/40">
                <td className="px-3 py-2">
                  <div className="font-medium">{m.productName}</div>
                  <div className="text-xs text-muted-foreground">
                    {m.productSku} · {m.unitCode}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">{fmtQty(m.requiredQty)}</td>
                <td className="px-3 py-2 text-right">{fmtQty(m.allocatedQty)}</td>
                <td className="px-3 py-2 text-right">{fmtQty(m.dispatchedQty)}</td>
                <td className="px-3 py-2 text-right">{fmtQty(m.deliveredQty)}</td>
                <td className="px-3 py-2 text-right font-medium">{fmtQty(m.remainingQty)}</td>
                <td className="px-3 py-2 text-right">
                  {canAllocate && !terminal ? (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      onClick={() => setAllocRow(allocRow === m.id ? null : m.id)}
                    >
                      Allocate
                    </button>
                  ) : null}
                  {canUpdate && Number(m.allocatedQty) === 0 && Number(m.dispatchedQty) === 0 ? (
                    <button
                      type="button"
                      className="ml-3 text-xs text-destructive hover:underline"
                      onClick={() => removeMaterial.mutate(m.id)}
                    >
                      Remove
                    </button>
                  ) : null}
                </td>
              </tr>
              {allocRow === m.id ? (
                <tr>
                  <td colSpan={7} className="bg-secondary/20 px-3 py-3">
                    <AllocateRow
                      projectId={projectId}
                      material={m}
                      onDone={() => setAllocRow(null)}
                    />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </Table>
      ) : (
        <EmptyState>No materials added yet.</EmptyState>
      )}
      <ErrorNote error={removeMaterial.error} />

      {canUpdate && !terminal ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!productId || !requiredQty) return;
            await addMaterial.mutateAsync({ productId, requiredQty });
            setProductId('');
            setRequiredQty('');
          }}
          className="grid gap-3 border-t pt-4 sm:grid-cols-[1fr_140px_auto] sm:items-end"
        >
          <Select
            label="Add product"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
          >
            <option value="">Select product…</option>
            {(products.data?.items ?? []).map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.sku} — {pr.name}
              </option>
            ))}
          </Select>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Required qty</span>
            <input
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              inputMode="decimal"
              value={requiredQty}
              onChange={(e) => setRequiredQty(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={!productId || !requiredQty || addMaterial.isPending}>
            {addMaterial.isPending ? 'Adding…' : 'Add material'}
          </Button>
        </form>
      ) : null}
      <ErrorNote error={addMaterial.error} />
    </Card>
  );
}

function AllocateRow({
  projectId,
  material,
  onDone,
}: {
  projectId: string;
  material: ProjectMaterial;
  onDone: () => void;
}) {
  const warehouses = useWarehouses();
  const allocate = useAllocateMaterial(projectId);
  const release = useReleaseMaterial(projectId);
  const [warehouseId, setWarehouseId] = useState('');
  const [quantity, setQuantity] = useState('');

  const run = async (kind: 'allocate' | 'release') => {
    if (!warehouseId || !quantity) return;
    const body = { productId: material.productId, warehouseId, quantity };
    if (kind === 'allocate') await allocate.mutateAsync(body);
    else await release.mutateAsync(body);
    setQuantity('');
    onDone();
  };

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto_auto] sm:items-end">
        <Select
          label="Warehouse"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          <option value="">Select warehouse…</option>
          {(warehouses.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.code} — {w.name}
            </option>
          ))}
        </Select>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Quantity</span>
          <input
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </label>
        <Button
          type="button"
          onClick={() => run('allocate')}
          disabled={!warehouseId || !quantity || allocate.isPending}
        >
          Allocate
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => run('release')}
          disabled={!warehouseId || !quantity || release.isPending}
        >
          Release
        </Button>
      </div>
      <ErrorNote error={allocate.error || release.error} />
    </div>
  );
}
