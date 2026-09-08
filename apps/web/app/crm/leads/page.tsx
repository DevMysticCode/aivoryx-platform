'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bookmark, Columns3, LayoutList, Plus, Search, Trash2, X } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import type { Lead } from '@aivoryx/contracts';
import { ApiError } from '@/lib/api/client';
import { assignLead, changeLeadStatus } from '@/lib/api/crm';
import { useMembers } from '@/lib/admin/use-admin';
import { useCreateLead, useLeads } from '@/lib/crm/use-crm';
import {
  useSavedViews,
  useCreateSavedView,
  useDeleteSavedView,
  serializeViewConfig,
  parseViewConfig,
  type LeadViewConfig,
} from '@/lib/crm/use-saved-views';
import { PageHeader, StatusBadge } from '@/components/admin/ui';
import { LoadingBlock, ErrorBlock, Confirm } from '@/components/ui/kit';
import { Dialog, Menu, MenuItem } from '@/components/ui/overlays';
import { useToast } from '@/components/ui/toast';

const STATUSES = [
  'NEW',
  'ASSIGNED',
  'CONTACTED',
  'QUALIFIED',
  'DISQUALIFIED',
  'CONVERTED',
] as const;
const PAGE_SIZE = 25;

export default function LeadsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  const members = useMembers();

  // ---- filter state -------------------------------------------------
  const [filter, setFilter] = useState<LeadViewConfig>(() => ({
    status: searchParams.get('status') ?? undefined,
    board: searchParams.get('view') === 'board',
  }));
  const [rawQuery, setRawQuery] = useState('');
  const q = useDebounced(rawQuery.trim(), 250);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quickOpen, setQuickOpen] = useState(searchParams.get('new') === '1');
  const [saveOpen, setSaveOpen] = useState(false);
  const [pendingBulk, setPendingBulk] = useState<null | { kind: 'status'; value: string }>(null);

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
  }, [q, filter.status, filter.assignedMembershipId]);

  const leads = useLeads({
    q: q || undefined,
    status: filter.status || undefined,
    assignedMembershipId: filter.assignedMembershipId || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const items = leads.data?.items ?? [];
  const total = leads.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const memberName = useCallback(
    (id: string | null | undefined) =>
      !id
        ? 'Unassigned'
        : (members.data?.find((m) => m.membershipId === id)?.name ??
          members.data?.find((m) => m.membershipId === id)?.email ??
          'Assigned'),
    [members.data],
  );

  // ---- saved views ------------------------------------------------
  const savedViews = useSavedViews();
  const createView = useCreateSavedView();
  const deleteView = useDeleteSavedView();
  const activeConfig = serializeViewConfig({ ...filter, q: q || undefined });

  const applyView = (config: Record<string, unknown>) => {
    const parsed = parseViewConfig(config);
    setFilter(parsed);
    setRawQuery(parsed.q ?? '');
  };

  const filterChips = buildChips(filter, memberName);
  const clearFilters = () => {
    setFilter({ board: filter.board });
    setRawQuery('');
  };

  // ---- bulk actions --------------------------------------------
  const runBulk = async (fn: (id: string) => Promise<unknown>, label: string) => {
    const ids = [...selected];
    const results = await Promise.allSettled(ids.map(fn));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = ids.length - ok;
    await qc.invalidateQueries({ queryKey: ['crm', 'leads'] });
    setSelected(new Set());
    setPendingBulk(null);
    if (failed === 0) toast.success(`${label}: ${ok} lead${ok === 1 ? '' : 's'} updated`);
    else toast.error(`${label}: ${ok} updated, ${failed} could not be changed`);
  };

  return (
    <section className="space-y-4">
      <PageHeader title="Leads" description="Search, filter, and work your pipeline.">
        <button
          type="button"
          onClick={() => setQuickOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
        >
          <Plus className="size-4" aria-hidden /> New lead
        </button>
      </PageHeader>

      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <input
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            placeholder="Search name, phone, email…"
            className="h-9 w-full rounded-md border bg-transparent pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        <select
          value={filter.status ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value || undefined }))}
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          aria-label="Status filter"
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </select>

        <select
          value={filter.assignedMembershipId ?? ''}
          onChange={(e) =>
            setFilter((f) => ({ ...f, assignedMembershipId: e.target.value || undefined }))
          }
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
          aria-label="Assignee filter"
        >
          <option value="">Anyone</option>
          {(members.data ?? []).map((m) => (
            <option key={m.membershipId} value={m.membershipId}>
              {m.name ?? m.email}
            </option>
          ))}
        </select>

        <SavedViewsMenu
          views={savedViews.data ?? []}
          onApply={applyView}
          onSave={() => setSaveOpen(true)}
          onDelete={(id) => deleteView.mutate(id)}
        />

        <div className="ml-auto flex items-center gap-1 rounded-md border p-0.5">
          <button
            type="button"
            aria-pressed={!filter.board}
            onClick={() => setFilter((f) => ({ ...f, board: false }))}
            className={cn(
              'rounded p-1.5',
              !filter.board ? 'bg-secondary text-foreground' : 'text-muted-foreground',
            )}
            aria-label="Table view"
          >
            <LayoutList className="size-4" />
          </button>
          <button
            type="button"
            aria-pressed={filter.board}
            onClick={() => setFilter((f) => ({ ...f, board: true }))}
            className={cn(
              'rounded p-1.5',
              filter.board ? 'bg-secondary text-foreground' : 'text-muted-foreground',
            )}
            aria-label="Board view"
          >
            <Columns3 className="size-4" />
          </button>
        </div>
      </div>

      {/* active filter chips */}
      {filterChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {filterChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary/50 py-0.5 pl-2.5 pr-1 text-xs"
            >
              {chip.label}
              <button
                type="button"
                aria-label={`Remove ${chip.label}`}
                onClick={() => {
                  if (chip.key === 'q') setRawQuery('');
                  else setFilter((f) => ({ ...f, [chip.key]: undefined }));
                }}
                className="rounded-full p-0.5 hover:bg-accent"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs font-medium text-primary hover:underline"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {/* bulk bar */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-secondary/40 px-3 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <BulkAssign
            members={members.data ?? []}
            onAssign={(mid) => runBulk((id) => assignLead(id, mid), 'Assigned')}
          />
          <BulkStatus onPick={(value) => setPendingBulk({ kind: 'status', value })} />
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      ) : null}

      {/* results */}
      <p className="text-xs text-muted-foreground">
        {leads.isLoading ? '…' : `${total} lead${total === 1 ? '' : 's'}`}
      </p>

      {leads.isLoading ? (
        <LoadingBlock />
      ) : leads.error ? (
        <ErrorBlock
          error={leads.error}
          onRetry={() => leads.refetch()}
          title="We couldn’t load your leads"
        />
      ) : items.length === 0 ? (
        <EmptyLeads
          filtered={filterChips.length > 0 || !!q}
          onClear={clearFilters}
          onCreate={() => setQuickOpen(true)}
        />
      ) : filter.board ? (
        <LeadBoard items={items} memberName={memberName} />
      ) : (
        <>
          <LeadTable
            items={items}
            selected={selected}
            onToggle={(id) =>
              setSelected((s) => {
                const n = new Set(s);
                if (n.has(id)) n.delete(id);
                else n.add(id);
                return n;
              })
            }
            onToggleAll={() =>
              setSelected((s) =>
                s.size === items.length ? new Set() : new Set(items.map((l) => l.id)),
              )
            }
            memberName={memberName}
          />
          <LeadCards items={items} memberName={memberName} />
          {totalPages > 1 ? (
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
          ) : null}
        </>
      )}

      <QuickCreate
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onCreated={(id) => {
          setQuickOpen(false);
          router.push(`/crm/leads/${id}`);
        }}
      />

      <SaveViewDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        pending={createView.isPending}
        onSave={async (name) => {
          try {
            await createView.mutateAsync({ name, config: activeConfig });
            toast.success('View saved');
            setSaveOpen(false);
          } catch (e) {
            toast.error(
              e instanceof ApiError && e.code === 'SAVED_VIEW_DUPLICATE_NAME'
                ? 'You already have a view with that name'
                : 'Could not save the view',
            );
          }
        }}
      />

      <Confirm
        open={!!pendingBulk}
        onClose={() => setPendingBulk(null)}
        onConfirm={() =>
          pendingBulk &&
          runBulk(
            (id) => changeLeadStatus(id, pendingBulk.value),
            `Status → ${titleCase(pendingBulk.value)}`,
          )
        }
        title={`Change status of ${selected.size} lead${selected.size === 1 ? '' : 's'}?`}
        confirmLabel="Change status"
        body={
          <>
            Leads whose current status doesn’t allow the transition to{' '}
            <strong>{pendingBulk ? titleCase(pendingBulk.value) : ''}</strong> are left unchanged —
            the CRM lifecycle rules still apply to every lead.
          </>
        }
      />
    </section>
  );
}

// ---- pieces ---------------------------------------------------------

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

function buildChips(
  filter: LeadViewConfig,
  memberName: (id?: string | null) => string,
): { key: 'status' | 'assignedMembershipId' | 'q'; label: string }[] {
  const chips: { key: 'status' | 'assignedMembershipId' | 'q'; label: string }[] = [];
  if (filter.status) chips.push({ key: 'status', label: `Status: ${titleCase(filter.status)}` });
  if (filter.assignedMembershipId)
    chips.push({
      key: 'assignedMembershipId',
      label: `Assigned: ${memberName(filter.assignedMembershipId)}`,
    });
  return chips;
}

function leadTitle(l: Lead): string {
  return l.name ?? l.phone ?? l.email ?? 'Unnamed lead';
}

function LeadTable({
  items,
  selected,
  onToggle,
  onToggleAll,
  memberName,
}: {
  items: Lead[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  memberName: (id?: string | null) => string;
}) {
  return (
    <div data-testid="lead-table" className="hidden overflow-hidden rounded-lg border md:block">
      <table className="w-full text-sm">
        <thead className="border-b bg-secondary/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="w-10 px-3 py-2">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={items.length > 0 && selected.size === items.length}
                onChange={onToggleAll}
                className="size-4 rounded border-input"
              />
            </th>
            <th className="px-3 py-2 font-medium">Lead</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Assignee</th>
            <th className="px-3 py-2 font-medium">Source</th>
            <th className="px-3 py-2 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((l) => (
            <tr
              key={l.id}
              className={cn('hover:bg-accent/40', selected.has(l.id) && 'bg-primary/5')}
            >
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={`Select ${leadTitle(l)}`}
                  checked={selected.has(l.id)}
                  onChange={() => onToggle(l.id)}
                  className="size-4 rounded border-input"
                />
              </td>
              <td className="px-3 py-2">
                <Link
                  href={`/crm/leads/${l.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {leadTitle(l)}
                </Link>
                <div className="text-xs text-muted-foreground">{l.phone ?? l.email ?? ''}</div>
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={l.status} />
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {memberName(l.assignee?.membershipId ?? null)}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {l.sourceName ?? 'Manual'}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {new Date(l.updatedAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LeadCards({
  items,
  memberName,
}: {
  items: Lead[];
  memberName: (id?: string | null) => string;
}) {
  return (
    <ul data-testid="lead-cards" className="space-y-2 md:hidden">
      {items.map((l) => (
        <li key={l.id}>
          <Link
            href={`/crm/leads/${l.id}`}
            className="block rounded-lg border p-3 hover:bg-accent/40"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">{leadTitle(l)}</span>
              <StatusBadge status={l.status} />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{l.phone ?? l.email ?? '—'}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {memberName(l.assignee?.membershipId ?? null)} · {l.sourceName ?? 'Manual'}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function LeadBoard({
  items,
  memberName,
}: {
  items: Lead[];
  memberName: (id?: string | null) => string;
}) {
  const columns = STATUSES.map((s) => ({ status: s, leads: items.filter((l) => l.status === s) }));
  return (
    <div
      data-testid="lead-board"
      className="grid gap-3 overflow-x-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
    >
      {columns.map((col) => (
        <div key={col.status} className="min-w-[14rem] rounded-lg border bg-secondary/20">
          <div className="flex items-center justify-between border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {titleCase(col.status)}
            <span className="tabular-nums">{col.leads.length}</span>
          </div>
          <ul className="space-y-2 p-2">
            {col.leads.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/crm/leads/${l.id}`}
                  className="block rounded-md border bg-background p-2.5 text-sm hover:border-primary/40"
                >
                  <span className="block truncate font-medium">{leadTitle(l)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {l.phone ?? l.email ?? '—'}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                    {memberName(l.assignee?.membershipId ?? null)} · {l.sourceName ?? 'Manual'}
                  </span>
                </Link>
              </li>
            ))}
            {col.leads.length === 0 ? (
              <li className="px-2 py-3 text-center text-xs text-muted-foreground">—</li>
            ) : null}
          </ul>
        </div>
      ))}
    </div>
  );
}

function EmptyLeads({
  filtered,
  onClear,
  onCreate,
}: {
  filtered: boolean;
  onClear: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-lg border p-10 text-center text-sm">
      {filtered ? (
        <>
          <p className="font-medium">No leads match these filters</p>
          <button
            type="button"
            onClick={onClear}
            className="mt-3 rounded-md border px-3 py-1.5 font-medium hover:bg-accent"
          >
            Clear filters
          </button>
        </>
      ) : (
        <>
          <p className="font-medium">No leads yet</p>
          <p className="mt-1 text-muted-foreground">
            Leads from your configured sources will appear here.
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground"
          >
            <Plus className="size-4" aria-hidden /> Create lead
          </button>
        </>
      )}
    </div>
  );
}

function SavedViewsMenu({
  views,
  onApply,
  onSave,
  onDelete,
}: {
  views: { id: string; name: string; config: Record<string, unknown> }[];
  onApply: (config: Record<string, unknown>) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      align="start"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent"
        >
          <Bookmark className="size-4" aria-hidden /> Saved views
        </button>
      )}
    >
      <div className="max-h-64 overflow-y-auto">
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onApply({});
            setOpen(false);
          }}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent"
        >
          All leads
        </button>
        {views.map((v) => (
          <div key={v.id} className="flex items-center">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onApply(v.config);
                setOpen(false);
              }}
              className="flex flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-accent"
            >
              {v.name}
            </button>
            <button
              type="button"
              aria-label={`Delete ${v.name}`}
              onClick={() => onDelete(v.id)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-1 border-t pt-1">
        <MenuItem
          icon={<Bookmark className="size-4 text-muted-foreground" />}
          onSelect={() => {
            setOpen(false);
            onSave();
          }}
        >
          Save current filters…
        </MenuItem>
      </div>
    </Menu>
  );
}

function BulkAssign({
  members,
  onAssign,
}: {
  members: { membershipId: string; name: string | null; email: string }[];
  onAssign: (membershipId: string) => void;
}) {
  return (
    <select
      aria-label="Bulk assign to"
      defaultValue=""
      onChange={(e) => {
        if (e.target.value) onAssign(e.target.value);
        e.currentTarget.value = '';
      }}
      className="h-8 rounded-md border bg-background px-2 text-xs"
    >
      <option value="">Assign to…</option>
      {members.map((m) => (
        <option key={m.membershipId} value={m.membershipId}>
          {m.name ?? m.email}
        </option>
      ))}
    </select>
  );
}

function BulkStatus({ onPick }: { onPick: (status: string) => void }) {
  return (
    <select
      aria-label="Bulk change status"
      defaultValue=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value);
        e.currentTarget.value = '';
      }}
      className="h-8 rounded-md border bg-background px-2 text-xs"
    >
      <option value="">Change status…</option>
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {titleCase(s)}
        </option>
      ))}
    </select>
  );
}

function QuickCreate({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const create = useCreateLead();
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setPhone('');
      setEmail('');
    }
  }, [open]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New lead"
      description="Just the essentials — you can add the rest on the lead."
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="quick-create-lead"
            disabled={create.isPending || (!name && !phone && !email)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {create.isPending ? 'Creating…' : 'Create lead'}
          </button>
        </>
      }
    >
      <form
        id="quick-create-lead"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const lead = await create.mutateAsync({
              name: name || undefined,
              phone: phone || undefined,
              email: email || undefined,
            });
            toast.success('Lead created');
            onCreated(lead.id);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Could not create the lead');
          }
        }}
        className="space-y-3"
      >
        <Labelled label="Name">
          <input
            ref={nameRef}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 w-full rounded-md border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </Labelled>
        <div className="grid gap-3 sm:grid-cols-2">
          <Labelled label="Phone">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Labelled>
          <Labelled label="Email">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 w-full rounded-md border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Labelled>
        </div>
      </form>
    </Dialog>
  );
}

function SaveViewDialog({
  open,
  onClose,
  onSave,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (name: string) => void;
  pending: boolean;
}) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) setName('');
  }, [open]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Save this view"
      description="Your current search and filters, saved for one click next time. Only you can see it."
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!name.trim() || pending}
            onClick={() => onSave(name.trim())}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save view'}
          </button>
        </>
      }
    >
      <Labelled label="View name">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My qualified leads"
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Labelled>
    </Dialog>
  );
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
