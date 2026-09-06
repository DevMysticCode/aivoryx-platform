'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
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
} from '@/lib/hr/use-hr';
import type { HrOrgChartNode } from '@aivoryx/contracts';

type Tab = 'departments' | 'designations' | 'locations' | 'schedules' | 'chart';

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

function UnitList({ kind, canManage }: { kind: 'department' | 'designation'; canManage: boolean }) {
  const list = kind === 'department' ? useDepartments() : useDesignations();
  const create = kind === 'department' ? useCreateDepartment() : useCreateDesignation();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');

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
            Add
          </Button>
          {create.error && (
            <div className="w-full">
              <ErrorNote error={create.error} />
            </div>
          )}
        </Card>
      )}
      {list.isLoading && <Skeleton rows={3} />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          }
        >
          {list.data.map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-2 font-medium">{d.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{d.code}</td>
              <td className="px-3 py-2">
                <HrStatusBadge status={d.status} />
              </td>
            </tr>
          ))}
          {list.data.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                Nothing configured yet.
              </td>
            </tr>
          )}
        </Table>
      )}
    </div>
  );
}

function LocationList({ canManage }: { canManage: boolean }) {
  const list = useLocations();
  const create = useCreateLocation();
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
              Add
            </Button>
          </div>
          {create.error && (
            <div className="lg:col-span-5">
              <ErrorNote error={create.error} />
            </div>
          )}
        </Card>
      )}
      {list.data && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">City</th>
              <th className="px-3 py-2">Coordinates</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          }
        >
          {list.data.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2 font-medium">{l.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{l.code}</td>
              <td className="px-3 py-2">{l.city ?? '—'}</td>
              <td className="px-3 py-2 tabular-nums text-muted-foreground">
                {l.latitude != null && l.longitude != null ? `${l.latitude}, ${l.longitude}` : '—'}
              </td>
              <td className="px-3 py-2">
                <HrStatusBadge status={l.status} />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function ScheduleList({ canManage }: { canManage: boolean }) {
  const list = useSchedules();
  const locations = useLocations();
  const create = useCreateSchedule();
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
            {locations.data?.map((l) => (
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
              Add
            </Button>
          </div>
          {create.error && (
            <div className="lg:col-span-5">
              <ErrorNote error={create.error} />
            </div>
          )}
        </Card>
      )}
      {list.data && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Hours</th>
              <th className="px-3 py-2">Grace</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          }
        >
          {list.data.map((s) => (
            <tr key={s.id}>
              <td className="px-3 py-2 font-medium">{s.name}</td>
              <td className="px-3 py-2 tabular-nums">
                {s.startTime}–{s.endTime}
              </td>
              <td className="px-3 py-2 tabular-nums">{s.graceMinutes} min</td>
              <td className="px-3 py-2">
                <HrStatusBadge status={s.status} />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function OrgChart() {
  const q = useOrgChart();
  if (q.isLoading) return <Skeleton rows={4} />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return null;

  const byManager = new Map<string, HrOrgChartNode[]>();
  for (const n of q.data.nodes) {
    const k = n.managerId ?? '__root__';
    byManager.set(k, [...(byManager.get(k) ?? []), n]);
  }

  return (
    <Card>
      <div className="mb-3 text-sm font-semibold">Reporting hierarchy</div>
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
  if (nodes.length === 0) {
    return depth === 0 ? <p className="text-sm text-muted-foreground">No employees yet.</p> : null;
  }
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
