'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import {
  PageHeader,
  ErrorNote,
  Skeleton,
  Card,
  EmptyState,
  StatusBadge,
} from '@/components/admin/ui';
import { Confirm, ErrorBlock } from '@/components/ui/kit';
import { Table, Select } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { HrStatusBadge, TextField, TabBar } from '@/components/hr/ui';
import {
  useDepartments,
  useDesignations,
  useLocations,
  useSchedules,
  useOrgChart,
  useCreateDepartment,
  useCreateDesignation,
  useCreateLocation,
  useCreateSchedule,
  useUpdateOrgUnit,
  useUpdateSchedule,
} from '@/lib/hr/use-hr';
import type { HrOrgChartNode, HrWorkSchedule } from '@aivoryx/contracts';

type Tab = 'departments' | 'designations' | 'locations' | 'schedules' | 'chart';

/** Bit 0 = Monday … bit 6 = Sunday. */
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function OrganizationPage() {
  const perms = usePermissions();
  const canManage = perms.includes('hr.organization.manage');
  const [tab, setTab] = useState<Tab>('departments');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisation"
        description="Departments, designations, locations, schedules and the reporting hierarchy."
      />
      <TabBar
        tabs={[
          { key: 'departments', label: 'Departments' },
          { key: 'designations', label: 'Designations' },
          { key: 'locations', label: 'Locations' },
          { key: 'schedules', label: 'Schedules' },
          { key: 'chart', label: 'Org chart' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'departments' && <UnitList kind="department" canManage={canManage} />}
      {tab === 'designations' && <UnitList kind="designation" canManage={canManage} />}
      {tab === 'locations' && <LocationList canManage={canManage} />}
      {tab === 'schedules' && <ScheduleList canManage={canManage} />}
      {tab === 'chart' && <OrgChart />}
    </div>
  );
}

function ListHeader({
  showArchived,
  onToggle,
}: {
  showArchived: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <div className="flex justify-end">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={showArchived}
          onChange={(e) => onToggle(e.target.checked)}
        />
        Show archived
      </label>
    </div>
  );
}

/** Secondary details for small screens, where the table drops its extra columns so the
 *  row actions stay on-screen. Hidden from `sm` up, where the columns return. */
function MobileMeta({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs font-normal text-muted-foreground sm:hidden">
      {children}
    </span>
  );
}

function UnitStatus({ status }: { status: string }) {
  return status === 'ARCHIVED' ? (
    <StatusBadge status="Archived" />
  ) : (
    <HrStatusBadge status={status} />
  );
}

/** Inline rename: labelled input, Enter saves, Escape cancels. */
function RenameForm({
  initial,
  pending,
  onSave,
  onCancel,
}: {
  initial: string;
  pending: boolean;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  const unchanged = !trimmed || trimmed === initial;
  return (
    <form
      className="flex min-w-0 flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!unchanged && !pending) onSave(trimmed);
      }}
    >
      <input
        aria-label={`New name for ${initial}`}
        autoFocus
        className="h-9 min-w-0 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      />
      <Button type="submit" size="sm" disabled={pending || unchanged}>
        {pending ? 'Saving…' : 'Save'}
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function ManageButtons({
  name,
  archived,
  pending,
  onRename,
  onEdit,
  onArchive,
  onRestore,
}: {
  name: string;
  archived: boolean;
  pending: boolean;
  onRename?: () => void;
  onEdit?: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {!archived && onRename && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          aria-label={`Rename ${name}`}
          onClick={onRename}
        >
          Rename
        </Button>
      )}
      {!archived && onEdit && (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          aria-label={`Edit ${name}`}
          onClick={onEdit}
        >
          Edit
        </Button>
      )}
      {archived ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          aria-label={`Restore ${name}`}
          onClick={onRestore}
        >
          Restore
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          aria-label={`Archive ${name}`}
          onClick={onArchive}
        >
          Archive
        </Button>
      )}
    </div>
  );
}

function ArchiveConfirm({
  target,
  noun,
  pending,
  onClose,
  onConfirm,
}: {
  target: { id: string; name: string } | null;
  noun: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (id: string) => void;
}) {
  return (
    <Confirm
      open={!!target}
      onClose={onClose}
      onConfirm={() => target && onConfirm(target.id)}
      title={`Archive ${target?.name ?? ''}?`}
      body={`Archived ${noun} can't be assigned to new employees. People who are already in it keep it, and you can restore it any time.`}
      confirmLabel="Archive"
      pending={pending}
    />
  );
}

function UnitList({ kind, canManage }: { kind: 'department' | 'designation'; canManage: boolean }) {
  const list = kind === 'department' ? useDepartments() : useDesignations();
  const create = kind === 'department' ? useCreateDepartment() : useCreateDesignation();
  const update = useUpdateOrgUnit(kind);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);
  const rows = (list.data ?? []).filter((d) => showArchived || d.status !== 'ARCHIVED');

  return (
    <div className="space-y-3">
      {canManage && (
        <Card className="flex flex-wrap items-end gap-3">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button
            size="sm"
            disabled={!name || !code || create.isPending}
            onClick={() =>
              create.mutate(
                { name, code },
                {
                  onSuccess: () => {
                    setName('');
                    setCode('');
                  },
                },
              )
            }
          >
            {create.isPending ? 'Adding…' : 'Add'}
          </Button>
          <div className="w-full">
            <ErrorNote error={create.error} />
          </div>
        </Card>
      )}
      <ListHeader showArchived={showArchived} onToggle={setShowArchived} />
      {list.isLoading && <Skeleton rows={3} />}
      {list.error && <ErrorBlock error={list.error} onRetry={() => list.refetch()} />}
      {list.data && rows.length === 0 && <EmptyState>Nothing configured yet.</EmptyState>}
      {list.data && rows.length > 0 && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="hidden sm:table-cell px-3 py-2">Code</th>
              <th className="hidden sm:table-cell px-3 py-2">Employees</th>
              <th className="hidden sm:table-cell px-3 py-2">Status</th>
              {canManage && <th className="px-3 py-2">Actions</th>}
            </tr>
          }
        >
          {rows.map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-2 font-medium">
                {editing === d.id ? (
                  <RenameForm
                    initial={d.name}
                    pending={update.isPending}
                    onCancel={() => setEditing(null)}
                    onSave={(n) =>
                      update.mutate({ id: d.id, name: n }, { onSuccess: () => setEditing(null) })
                    }
                  />
                ) : (
                  d.name
                )}
                <MobileMeta>
                  {d.code} · {d.employeeCount} {d.employeeCount === 1 ? 'person' : 'people'}
                  {d.status === 'ARCHIVED' && <UnitStatus status={d.status} />}
                </MobileMeta>
              </td>
              <td className="hidden sm:table-cell px-3 py-2 text-muted-foreground">{d.code}</td>
              <td className="hidden sm:table-cell px-3 py-2 tabular-nums">{d.employeeCount}</td>
              <td className="hidden sm:table-cell px-3 py-2">
                <UnitStatus status={d.status} />
              </td>
              {canManage && (
                <td className="px-3 py-2">
                  <ManageButtons
                    name={d.name}
                    archived={d.status === 'ARCHIVED'}
                    pending={update.isPending}
                    onRename={() => setEditing(d.id)}
                    onArchive={() => setArchiving({ id: d.id, name: d.name })}
                    onRestore={() => update.mutate({ id: d.id, status: 'ACTIVE' })}
                  />
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}
      <ErrorNote error={update.error} />
      <ArchiveConfirm
        target={archiving}
        noun={kind === 'department' ? 'departments' : 'designations'}
        pending={update.isPending}
        onClose={() => setArchiving(null)}
        onConfirm={(id) =>
          update.mutate({ id, status: 'ARCHIVED' }, { onSettled: () => setArchiving(null) })
        }
      />
    </div>
  );
}

function LocationList({ canManage }: { canManage: boolean }) {
  const list = useLocations();
  const create = useCreateLocation();
  const update = useUpdateOrgUnit('location');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);
  const rows = (list.data ?? []).filter((l) => showArchived || l.status !== 'ARCHIVED');
  const [form, setForm] = useState({ name: '', code: '', city: '', latitude: '', longitude: '' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      {canManage && (
        <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <TextField label="Code" value={form.code} onChange={(e) => set('code', e.target.value)} />
          <TextField label="City" value={form.city} onChange={(e) => set('city', e.target.value)} />
          <TextField
            label="Latitude"
            value={form.latitude}
            onChange={(e) => set('latitude', e.target.value)}
          />
          <TextField
            label="Longitude"
            value={form.longitude}
            onChange={(e) => set('longitude', e.target.value)}
          />
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!form.name || !form.code || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    name: form.name,
                    code: form.code,
                    city: form.city || undefined,
                    latitude: form.latitude || undefined,
                    longitude: form.longitude || undefined,
                  },
                  {
                    onSuccess: () =>
                      setForm({ name: '', code: '', city: '', latitude: '', longitude: '' }),
                  },
                )
              }
            >
              {create.isPending ? 'Adding…' : 'Add'}
            </Button>
          </div>
          <div className="lg:col-span-5">
            <ErrorNote error={create.error} />
          </div>
        </Card>
      )}
      <ListHeader showArchived={showArchived} onToggle={setShowArchived} />
      {list.isLoading && <Skeleton rows={3} />}
      {list.error && <ErrorBlock error={list.error} onRetry={() => list.refetch()} />}
      {list.data && rows.length === 0 && <EmptyState>Nothing configured yet.</EmptyState>}
      {list.data && rows.length > 0 && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="hidden sm:table-cell px-3 py-2">Code</th>
              <th className="hidden md:table-cell px-3 py-2">City</th>
              <th className="hidden lg:table-cell px-3 py-2">Coordinates</th>
              <th className="hidden sm:table-cell px-3 py-2">Employees</th>
              <th className="hidden sm:table-cell px-3 py-2">Status</th>
              {canManage && <th className="px-3 py-2">Actions</th>}
            </tr>
          }
        >
          {rows.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2 font-medium">
                {editing === l.id ? (
                  <RenameForm
                    initial={l.name}
                    pending={update.isPending}
                    onCancel={() => setEditing(null)}
                    onSave={(n) =>
                      update.mutate({ id: l.id, name: n }, { onSuccess: () => setEditing(null) })
                    }
                  />
                ) : (
                  l.name
                )}
                <MobileMeta>
                  {l.code}
                  {l.city ? ` · ${l.city}` : ''} · {l.employeeCount}{' '}
                  {l.employeeCount === 1 ? 'person' : 'people'}
                  {l.status === 'ARCHIVED' && <UnitStatus status={l.status} />}
                </MobileMeta>
              </td>
              <td className="hidden sm:table-cell px-3 py-2 text-muted-foreground">{l.code}</td>
              <td className="hidden md:table-cell px-3 py-2">{l.city ?? '—'}</td>
              <td className="hidden lg:table-cell px-3 py-2 tabular-nums text-muted-foreground">
                {l.latitude != null && l.longitude != null ? `${l.latitude}, ${l.longitude}` : '—'}
              </td>
              <td className="hidden sm:table-cell px-3 py-2 tabular-nums">{l.employeeCount}</td>
              <td className="hidden sm:table-cell px-3 py-2">
                <UnitStatus status={l.status} />
              </td>
              {canManage && (
                <td className="px-3 py-2">
                  <ManageButtons
                    name={l.name}
                    archived={l.status === 'ARCHIVED'}
                    pending={update.isPending}
                    onRename={() => setEditing(l.id)}
                    onArchive={() => setArchiving({ id: l.id, name: l.name })}
                    onRestore={() => update.mutate({ id: l.id, status: 'ACTIVE' })}
                  />
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}
      <ErrorNote error={update.error} />
      <ArchiveConfirm
        target={archiving}
        noun="locations"
        pending={update.isPending}
        onClose={() => setArchiving(null)}
        onConfirm={(id) =>
          update.mutate({ id, status: 'ARCHIVED' }, { onSettled: () => setArchiving(null) })
        }
      />
    </div>
  );
}

function ScheduleList({ canManage }: { canManage: boolean }) {
  const list = useSchedules();
  const locations = useLocations();
  const create = useCreateSchedule();
  const update = useUpdateSchedule();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<HrWorkSchedule | null>(null);
  const [archiving, setArchiving] = useState<{ id: string; name: string } | null>(null);
  const rows = (list.data ?? []).filter((x) => showArchived || x.status !== 'ARCHIVED');
  const [form, setForm] = useState({
    name: '',
    startTime: '09:30',
    endTime: '18:00',
    graceMinutes: '15',
    locationId: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      {canManage && (
        <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <TextField
            label="Start"
            type="time"
            value={form.startTime}
            onChange={(e) => set('startTime', e.target.value)}
          />
          <TextField
            label="End"
            type="time"
            value={form.endTime}
            onChange={(e) => set('endTime', e.target.value)}
          />
          <TextField
            label="Grace (min)"
            value={form.graceMinutes}
            onChange={(e) => set('graceMinutes', e.target.value)}
          />
          <Select
            label="Location"
            value={form.locationId}
            onChange={(e) => set('locationId', e.target.value)}
          >
            <option value="">—</option>
            {locations.data
              ?.filter((l) => l.status !== 'ARCHIVED')
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </Select>
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!form.name || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    name: form.name,
                    startTime: form.startTime,
                    endTime: form.endTime,
                    graceMinutes: Number(form.graceMinutes) || 0,
                    locationId: form.locationId || undefined,
                  },
                  { onSuccess: () => set('name', '') },
                )
              }
            >
              {create.isPending ? 'Adding…' : 'Add'}
            </Button>
          </div>
          <div className="lg:col-span-5">
            <ErrorNote error={create.error} />
          </div>
        </Card>
      )}
      <ListHeader showArchived={showArchived} onToggle={setShowArchived} />
      {list.isLoading && <Skeleton rows={3} />}
      {list.error && <ErrorBlock error={list.error} onRetry={() => list.refetch()} />}
      {canManage && editing && (
        <ScheduleEditor
          key={editing.id}
          schedule={editing}
          pending={update.isPending}
          error={update.error}
          onCancel={() => setEditing(null)}
          onSave={(body) =>
            update.mutate({ id: editing.id, ...body }, { onSuccess: () => setEditing(null) })
          }
        />
      )}
      {list.data && rows.length === 0 && <EmptyState>Nothing configured yet.</EmptyState>}
      {list.data && rows.length > 0 && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="hidden sm:table-cell px-3 py-2">Hours</th>
              <th className="hidden md:table-cell px-3 py-2">Working days</th>
              <th className="hidden md:table-cell px-3 py-2">Grace</th>
              <th className="hidden md:table-cell px-3 py-2">Status</th>
              {canManage && <th className="px-3 py-2">Actions</th>}
            </tr>
          }
        >
          {rows.map((s) => (
            <tr key={s.id}>
              <td className="px-3 py-2 font-medium">
                {s.name}
                <MobileMeta>
                  {s.startTime}–{s.endTime}
                  {s.status === 'ARCHIVED' && <UnitStatus status={s.status} />}
                </MobileMeta>
              </td>
              <td className="hidden sm:table-cell px-3 py-2 tabular-nums">
                {s.startTime}–{s.endTime}
              </td>
              <td className="hidden md:table-cell px-3 py-2 text-muted-foreground">
                {DAYS.filter((_, i) => (s.workingDaysMask & (1 << i)) !== 0).join(', ') || '—'}
              </td>
              <td className="hidden md:table-cell px-3 py-2 tabular-nums">{s.graceMinutes} min</td>
              <td className="hidden md:table-cell px-3 py-2">
                <UnitStatus status={s.status} />
              </td>
              {canManage && (
                <td className="px-3 py-2">
                  <ManageButtons
                    name={s.name}
                    archived={s.status === 'ARCHIVED'}
                    pending={update.isPending}
                    onEdit={() => setEditing(s)}
                    onArchive={() => setArchiving({ id: s.id, name: s.name })}
                    onRestore={() => update.mutate({ id: s.id, status: 'ACTIVE' })}
                  />
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}
      {!editing && <ErrorNote error={update.error} />}
      <ArchiveConfirm
        target={archiving}
        noun="schedules"
        pending={update.isPending}
        onClose={() => setArchiving(null)}
        onConfirm={(id) =>
          update.mutate({ id, status: 'ARCHIVED' }, { onSettled: () => setArchiving(null) })
        }
      />
    </div>
  );
}

function ScheduleEditor({
  schedule,
  pending,
  error,
  onSave,
  onCancel,
}: {
  schedule: HrWorkSchedule;
  pending: boolean;
  error: unknown;
  onSave: (body: {
    name: string;
    startTime: string;
    endTime: string;
    graceMinutes: number;
    workingDaysMask: number;
  }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(schedule.name);
  const [start, setStart] = useState(schedule.startTime);
  const [end, setEnd] = useState(schedule.endTime);
  const [grace, setGrace] = useState(String(schedule.graceMinutes));
  const [mask, setMask] = useState(schedule.workingDaysMask);
  const [problem, setProblem] = useState<string | null>(null);

  function submit() {
    if (!name.trim()) return setProblem('Enter a schedule name.');
    if (!HHMM.test(start) || !HHMM.test(end))
      return setProblem('Start and end time must be in HH:MM (24-hour) format, e.g. 09:30.');
    if (!/^[0-9]+$/.test(grace))
      return setProblem('Grace minutes must be a whole number, 0 or more.');
    if (mask === 0) return setProblem('Select at least one working day.');
    setProblem(null);
    onSave({
      name: name.trim(),
      startTime: start,
      endTime: end,
      graceMinutes: Number(grace),
      workingDaysMask: mask,
    });
  }

  return (
    <Card>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!pending) submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
      >
        <h2 className="text-sm font-semibold">Edit schedule: {schedule.name}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label="Start"
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <TextField label="End" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          <TextField
            label="Grace (min)"
            inputMode="numeric"
            value={grace}
            onChange={(e) => setGrace(e.target.value)}
          />
        </div>
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-medium">Working days</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={(mask & (1 << i)) !== 0}
                  onChange={(e) =>
                    setMask((m) => (e.target.checked ? m | (1 << i) : m & ~(1 << i)))
                  }
                />
                {d}
              </label>
            ))}
          </div>
        </fieldset>
        {problem && (
          <p role="alert" className="text-sm font-medium text-danger">
            {problem}
          </p>
        )}
        <ErrorNote error={error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function OrgChart() {
  const q = useOrgChart();
  if (q.isLoading) return <Skeleton rows={4} />;
  if (q.error) return <ErrorBlock error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return null;
  if (q.data.nodes.length === 0) return <EmptyState>No employees yet.</EmptyState>;

  const byManager = new Map<string, HrOrgChartNode[]>();
  for (const n of q.data.nodes) {
    const k = n.managerId ?? '__root__';
    byManager.set(k, [...(byManager.get(k) ?? []), n]);
  }

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold">Reporting hierarchy</h2>
      <ChartNodes nodes={byManager.get('__root__') ?? []} byManager={byManager} depth={0} />
    </Card>
  );
}

function ChartNodes({
  nodes,
  byManager,
  depth,
}: {
  nodes: HrOrgChartNode[];
  byManager: Map<string, HrOrgChartNode[]>;
  depth: number;
}) {
  if (nodes.length === 0) return null;
  return (
    <ul className={depth === 0 ? 'space-y-1' : 'ml-5 mt-1 space-y-1 border-l pl-4'}>
      {nodes.map((n) => {
        const reports = byManager.get(n.employeeId) ?? [];
        return (
          <li key={n.employeeId}>
            <a
              href={`/hr/employees/${n.employeeId}`}
              className="text-sm text-primary hover:underline"
            >
              {n.displayName}
            </a>
            <span className="ml-2 text-xs text-muted-foreground">
              {n.designation ?? ''} {n.department ? `· ${n.department}` : ''}
            </span>
            {reports.length > 0 && (
              <ChartNodes nodes={reports} byManager={byManager} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}
