'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import {
  useCreateDispatch,
  useDispatches,
  useProject,
  useProjects,
  useWarehouses,
} from '@/lib/supply/use-supply';
import { usePermissions } from '@/components/supply/supply-shell';
import { Card, EmptyState, ErrorNote, PageHeader, Skeleton } from '@/components/admin/ui';
import { fmtDate, fmtQty, Pager, Select, SupplyStatusBadge, Table } from '@/components/supply/ui';

const STATUSES = ['DRAFT', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];

export default function DispatchesPage() {
  const router = useRouter();
  const perms = usePermissions();
  const canCreate = perms.includes('dispatch.create');

  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const dispatches = useDispatches({ status: status || undefined, page, pageSize });
  const totalPages = dispatches.data ? Math.max(1, Math.ceil(dispatches.data.total / pageSize)) : 1;

  const projects = useProjects({ pageSize: 100 });
  const warehouses = useWarehouses();
  const createDispatch = useCreateDispatch();

  const [projectId, setProjectId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<Record<string, string>>({});
  const project = useProject(projectId);

  const allocatable = (project.data?.materials ?? []).filter(
    (m) => Number(m.allocatedQty) - Number(m.dispatchedQty) > 0,
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payloadLines = Object.entries(lines)
      .filter(([, v]) => v && Number(v) > 0)
      .map(([productId, quantity]) => ({ productId, quantity }));
    if (!projectId || !warehouseId || payloadLines.length === 0) return;
    const d = await createDispatch.mutateAsync({ projectId, warehouseId, lines: payloadLines });
    setProjectId('');
    setWarehouseId('');
    setLines({});
    router.push(`/logistics/dispatches/${d.id}`);
  };

  return (
    <section className="space-y-6">
      <PageHeader
        title="Dispatches"
        description="Move allocated stock from a warehouse to a project site and confirm delivery."
      />

      {canCreate ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">New dispatch</h2>
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Project"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">Select project…</option>
                {(projects.data?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number}
                  </option>
                ))}
              </Select>
              <Select
                label="Source warehouse"
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
            </div>

            {projectId ? (
              allocatable.length > 0 ? (
                <Table
                  head={
                    <tr>
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 text-right font-medium">Allocated (undispatched)</th>
                      <th className="px-3 py-2 text-right font-medium">Dispatch qty</th>
                    </tr>
                  }
                >
                  {allocatable.map((m) => (
                    <tr key={m.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{m.productName}</div>
                        <div className="text-xs text-muted-foreground">{m.productSku}</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {fmtQty((Number(m.allocatedQty) - Number(m.dispatchedQty)).toString())}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          className="h-8 w-24 rounded-md border border-input bg-transparent px-2 text-right text-sm"
                          inputMode="decimal"
                          value={lines[m.productId] ?? ''}
                          onChange={(e) =>
                            setLines((l) => ({ ...l, [m.productId]: e.target.value }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </Table>
              ) : (
                <p className="text-sm text-muted-foreground">
                  This project has no undispatched allocated stock. Allocate materials first.
                </p>
              )
            ) : null}

            <Button type="submit" disabled={createDispatch.isPending || !projectId || !warehouseId}>
              {createDispatch.isPending ? 'Creating…' : 'Create dispatch'}
            </Button>
          </form>
          <ErrorNote error={createDispatch.error} />
        </Card>
      ) : null}

      <Card className="grid gap-3 sm:grid-cols-2">
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
          {dispatches.data ? `${dispatches.data.total} dispatch(es)` : ''}
        </div>
      </Card>

      {dispatches.isLoading ? (
        <Skeleton rows={6} />
      ) : dispatches.error ? (
        <ErrorNote error={dispatches.error} />
      ) : dispatches.data && dispatches.data.items.length > 0 ? (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 font-medium">Dispatch</th>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Warehouse</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            }
          >
            {dispatches.data.items.map((d) => (
              <tr key={d.id} className="hover:bg-accent/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/logistics/dispatches/${d.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {d.number}
                  </Link>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{d.projectNumber}</td>
                <td className="px-3 py-2 text-muted-foreground">{d.warehouseName}</td>
                <td className="px-3 py-2">
                  <SupplyStatusBadge status={d.status} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(d.createdAt)}</td>
              </tr>
            ))}
          </Table>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </>
      ) : (
        <EmptyState>No dispatches match these filters.</EmptyState>
      )}
    </section>
  );
}
