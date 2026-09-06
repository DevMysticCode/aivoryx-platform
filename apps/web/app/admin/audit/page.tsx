'use client';

import Link from 'next/link';
import { useState } from 'react';
import { X } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import { ErrorNote, Field, PageHeader, Skeleton } from '@/components/admin/ui';
import { Pager, Select, Table } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { useAuditLog, useAuditEntry } from '@/lib/audit/use-audit';
import type { AuditFilters } from '@/lib/api/audit';

const MODULES = [
  'auth',
  'identity',
  'crm',
  'integrations',
  'field',
  'supply',
  'commercial',
  'execution',
  'notifications',
  'finance',
  'settings',
];

const MODULE_STYLE: Record<string, string> = {
  auth: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  identity: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  crm: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  integrations: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-950 dark:text-cyan-300',
  field: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  supply: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  commercial: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300',
  execution: 'bg-lime-100 text-lime-800 dark:bg-lime-950 dark:text-lime-300',
  notifications: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  finance: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  settings: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
};

/** Best-effort deep link from an audit entry back to the affected record. */
const ENTITY_ROUTE: Record<string, (id: string) => string> = {
  lead: (id) => `/crm/leads/${id}`,
  visit: (id) => `/crm/visits/${id}`,
  customer: (id) => `/customers/${id}`,
  quotation: (id) => `/quotations/${id}`,
  project: (id) => `/projects/${id}`,
  invoice: (id) => `/finance/invoices/${id}`,
  payment: (id) => `/finance/payments/${id}`,
  credit_note: (id) => `/finance/credit-notes/${id}`,
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString();
}

function actorLabel(row: {
  actorType: 'USER' | 'SYSTEM';
  actorName: string | null;
  actorEmail: string | null;
  actorSource: string | null;
}): string {
  if (row.actorType === 'SYSTEM') return row.actorSource ? `System · ${row.actorSource}` : 'System';
  return row.actorName || row.actorEmail || 'Unknown member';
}

function ModuleBadge({ module }: { module: string }) {
  return (
    <span
      className={cn(
        'inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium capitalize',
        MODULE_STYLE[module] ?? 'bg-secondary text-secondary-foreground',
      )}
    >
      {module}
    </span>
  );
}

export default function AuditLogPage() {
  const perms = usePermissions();
  const canRead = perms.includes('audit.read');

  const [filters, setFilters] = useState<AuditFilters>({});
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);

  const list = useAuditLog(filters, page);
  const detail = useAuditEntry(selected);

  const total = list.data?.total ?? 0;
  const pageSize = list.data?.pageSize ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const set = (patch: Partial<AuditFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  if (!canRead) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">You don’t have access to the audit log.</p>
        <p className="mt-1 text-muted-foreground">
          Ask a workspace administrator for the “View the workspace audit log” permission.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="An immutable, workspace-wide record of who did what, when, and from where. Append-only — entries cannot be edited or deleted."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Module"
          value={filters.module ?? ''}
          onChange={(e) => set({ module: e.target.value || undefined })}
        >
          <option value="">All modules</option>
          {MODULES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Select
          label="Actor"
          value={filters.actorType ?? ''}
          onChange={(e) =>
            set({ actorType: (e.target.value || undefined) as AuditFilters['actorType'] })
          }
        >
          <option value="">Anyone</option>
          <option value="USER">People</option>
          <option value="SYSTEM">System</option>
        </Select>
        <Field
          label="Action"
          placeholder="e.g. finance.invoice.issued"
          value={filters.action ?? ''}
          onChange={(e) => set({ action: e.target.value || undefined })}
        />
        <Field
          label="Entity type"
          placeholder="e.g. invoice"
          value={filters.entityType ?? ''}
          onChange={(e) => set({ entityType: e.target.value || undefined })}
        />
        <Field
          label="From"
          type="datetime-local"
          value={filters.from?.slice(0, 16) ?? ''}
          onChange={(e) =>
            set({ from: e.target.value ? new Date(e.target.value).toISOString() : undefined })
          }
        />
        <Field
          label="To"
          type="datetime-local"
          value={filters.to?.slice(0, 16) ?? ''}
          onChange={(e) =>
            set({ to: e.target.value ? new Date(e.target.value).toISOString() : undefined })
          }
        />
        <Field
          label="Entity ID"
          placeholder="UUID"
          value={filters.entityId ?? ''}
          onChange={(e) => set({ entityId: e.target.value || undefined })}
        />
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => {
              setFilters({});
              setPage(1);
            }}
            className="h-9 rounded-md border px-3 text-sm hover:bg-accent"
          >
            Clear filters
          </button>
        </div>
      </div>

      {list.isLoading && <Skeleton rows={8} />}
      {list.error && <ErrorNote error={list.error} />}

      {list.data && (
        <>
          <p className="text-xs text-muted-foreground">
            {total.toLocaleString()} {total === 1 ? 'entry' : 'entries'}
          </p>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Actor</th>
                <th className="px-3 py-2 text-left font-medium">Action</th>
                <th className="px-3 py-2 text-left font-medium">Module</th>
                <th className="px-3 py-2 text-left font-medium">Entity</th>
              </tr>
            }
          >
            {list.data.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  No audit entries match these filters. Try widening the date range or clearing a
                  filter.
                </td>
              </tr>
            )}
            {list.data.items.map((row) => (
              <tr
                key={row.id}
                onClick={() => setSelected(row.id)}
                className={cn(
                  'cursor-pointer border-t transition-colors hover:bg-accent/50',
                  selected === row.id && 'bg-accent',
                )}
              >
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {fmt(row.occurredAt)}
                </td>
                <td className="px-3 py-2 text-sm">{actorLabel(row)}</td>
                <td className="px-3 py-2 font-mono text-xs">{row.action}</td>
                <td className="px-3 py-2">
                  <ModuleBadge module={row.module} />
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {row.entityType}
                  {row.entityId ? ` · ${row.entityId.slice(0, 8)}` : ''}
                </td>
              </tr>
            ))}
          </Table>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-black/20"
          onClick={() => setSelected(null)}
        >
          <aside
            className="h-full w-full max-w-md overflow-y-auto border-l bg-background p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h2 className="text-base font-semibold">Audit entry</h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="rounded-md p-1 text-muted-foreground hover:bg-accent"
                aria-label="Close"
              >
                <X className="size-4" />
              </button>
            </div>

            {detail.isLoading && <Skeleton rows={6} />}
            {detail.error && <ErrorNote error={detail.error} />}

            {detail.data && (
              <dl className="mt-4 space-y-3 text-sm">
                <Row label="When" value={fmt(detail.data.occurredAt)} />
                <Row label="Actor" value={actorLabel(detail.data)} />
                <Row
                  label="Actor type"
                  value={
                    detail.data.actorType === 'SYSTEM'
                      ? `System${detail.data.actorSource ? ` (${detail.data.actorSource})` : ''}`
                      : 'Person'
                  }
                />
                {detail.data.actorEmail && (
                  <Row label="Actor email" value={detail.data.actorEmail} />
                )}
                <Row label="Action" mono value={detail.data.action} />
                <Row label="Module" value={detail.data.module} />
                <Row label="Entity type" value={detail.data.entityType} />
                {detail.data.entityId && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Entity
                    </dt>
                    <dd className="mt-0.5 font-mono text-xs">
                      {ENTITY_ROUTE[detail.data.entityType] ? (
                        <Link
                          href={ENTITY_ROUTE[detail.data.entityType]!(detail.data.entityId)}
                          className="text-primary hover:underline"
                        >
                          {detail.data.entityId}
                        </Link>
                      ) : (
                        detail.data.entityId
                      )}
                    </dd>
                  </div>
                )}
                {detail.data.correlationId && (
                  <Row label="Correlation ID" mono value={detail.data.correlationId} />
                )}
                {detail.data.requestId && detail.data.requestId !== detail.data.correlationId && (
                  <Row label="Request ID" mono value={detail.data.requestId} />
                )}
                {detail.data.ipAddress && <Row label="IP address" value={detail.data.ipAddress} />}
                {detail.data.userAgent && <Row label="User agent" value={detail.data.userAgent} />}

                {detail.data.changes && Object.keys(detail.data.changes).length > 0 && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Changes
                    </dt>
                    <dd className="mt-1 space-y-1">
                      {Object.entries(
                        detail.data.changes as Record<string, { from: unknown; to: unknown }>,
                      ).map(([field, c]) => (
                        <div key={field} className="rounded border bg-muted/40 px-2 py-1.5 text-xs">
                          <span className="font-medium">{field}</span>
                          <div className="mt-0.5 flex items-center gap-2 text-muted-foreground">
                            <span className="line-through">{render(c.from)}</span>
                            <span aria-hidden>→</span>
                            <span className="text-foreground">{render(c.to)}</span>
                          </div>
                        </div>
                      ))}
                    </dd>
                  </div>
                )}

                {detail.data.metadata && Object.keys(detail.data.metadata).length > 0 && (
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                      Details
                    </dt>
                    <dd className="mt-1 space-y-1">
                      {Object.entries(detail.data.metadata).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-4 text-xs">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="text-right font-mono">{render(v)}</span>
                        </div>
                      ))}
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('mt-0.5 break-words', mono && 'font-mono text-xs')}>{value}</dd>
    </div>
  );
}

function render(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
