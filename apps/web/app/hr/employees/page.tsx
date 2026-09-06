'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { Select, Table, Pager } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { HrStatusBadge, TextField, fmtDate } from '@/components/hr/ui';
import {
  useEmployees,
  useDepartments,
  useDesignations,
  useLocations,
  useSchedules,
  useCreateEmployee,
} from '@/lib/hr/use-hr';

const STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED', 'INACTIVE'];
const TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'TEMPORARY'];

export default function HrEmployeesPage() {
  const router = useRouter();
  const perms = usePermissions();
  const canCreate = perms.includes('hr.employee.create');

  const [q, setQ] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState('');
  const [employmentType, setEmploymentType] = useState('');
  const [page, setPage] = useState(1);

  const list = useEmployees({
    q: q || undefined,
    departmentId: departmentId || undefined,
    status: status || undefined,
    employmentType: employmentType || undefined,
    page,
  });
  const departments = useDepartments();
  const designations = useDesignations();
  const locations = useLocations();
  const schedules = useSchedules();
  const create = useCreateEmployee();

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    workEmail: '',
    joiningDate: '',
    employmentType: 'FULL_TIME',
    departmentId: '',
    designationId: '',
    workLocationId: '',
    scheduleId: '',
    managerId: '',
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    const emp = await create.mutateAsync({
      firstName: form.firstName,
      lastName: form.lastName,
      workEmail: form.workEmail || undefined,
      joiningDate: form.joiningDate,
      employmentType: form.employmentType,
      departmentId: form.departmentId || undefined,
      designationId: form.designationId || undefined,
      workLocationId: form.workLocationId || undefined,
      scheduleId: form.scheduleId || undefined,
      managerId: form.managerId || undefined,
    });
    setShowNew(false);
    router.push(`/hr/employees/${emp.id}`);
  };

  const total = list.data?.total ?? 0;
  const pageSize = list.data?.pageSize ?? 25;

  return (
    <div className="space-y-6">
      <PageHeader title="Employees" description="The workspace directory and employment record.">
        {canCreate && (
          <Button size="sm" onClick={() => setShowNew((v) => !v)}>
            {showNew ? 'Close' : 'New employee'}
          </Button>
        )}
      </PageHeader>

      {showNew && (
        <Card className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField
              label="First name"
              value={form.firstName}
              onChange={(e) => set('firstName', e.target.value)}
            />
            <TextField
              label="Last name"
              value={form.lastName}
              onChange={(e) => set('lastName', e.target.value)}
            />
            <TextField
              label="Work email"
              type="email"
              value={form.workEmail}
              onChange={(e) => set('workEmail', e.target.value)}
            />
            <TextField
              label="Joining date"
              type="date"
              value={form.joiningDate}
              onChange={(e) => set('joiningDate', e.target.value)}
            />
            <Select
              label="Employment type"
              value={form.employmentType}
              onChange={(e) => set('employmentType', e.target.value)}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
            <Select
              label="Department"
              value={form.departmentId}
              onChange={(e) => set('departmentId', e.target.value)}
            >
              <option value="">—</option>
              {departments.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select
              label="Designation"
              value={form.designationId}
              onChange={(e) => set('designationId', e.target.value)}
            >
              <option value="">—</option>
              {designations.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select
              label="Work location"
              value={form.workLocationId}
              onChange={(e) => set('workLocationId', e.target.value)}
            >
              <option value="">—</option>
              {locations.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select
              label="Schedule"
              value={form.scheduleId}
              onChange={(e) => set('scheduleId', e.target.value)}
            >
              <option value="">—</option>
              {schedules.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select
              label="Reporting manager"
              value={form.managerId}
              onChange={(e) => set('managerId', e.target.value)}
            >
              <option value="">—</option>
              {list.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName}
                </option>
              ))}
            </Select>
          </div>
          {create.error && <ErrorNote error={create.error} />}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={submit}
              disabled={create.isPending || !form.firstName || !form.lastName || !form.joiningDate}
            >
              Create employee
            </Button>
          </div>
        </Card>
      )}

      <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TextField
          label="Search"
          placeholder="Name, number, email"
          value={q}
          onChange={(e) => {
            setPage(1);
            setQ(e.target.value);
          }}
        />
        <Select
          label="Department"
          value={departmentId}
          onChange={(e) => {
            setPage(1);
            setDepartmentId(e.target.value);
          }}
        >
          <option value="">All</option>
          {departments.data?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
        >
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <Select
          label="Type"
          value={employmentType}
          onChange={(e) => {
            setPage(1);
            setEmploymentType(e.target.value);
          }}
        >
          <option value="">All</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </Card>

      {list.isLoading && <Skeleton rows={5} />}
      {list.error && <ErrorNote error={list.error} />}

      {list.data && (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Department</th>
                <th className="px-3 py-2">Designation</th>
                <th className="px-3 py-2">Manager</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Joined</th>
              </tr>
            }
          >
            {list.data.items.map((e) => (
              <tr key={e.id} className="hover:bg-accent/40">
                <td className="px-3 py-2">
                  <Link
                    href={`/hr/employees/${e.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {e.displayName}
                  </Link>
                  {e.hasLogin && <span className="ml-2 text-xs text-muted-foreground">login</span>}
                </td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{e.employeeNumber}</td>
                <td className="px-3 py-2">{e.department ?? '—'}</td>
                <td className="px-3 py-2">{e.designation ?? '—'}</td>
                <td className="px-3 py-2">{e.managerName ?? '—'}</td>
                <td className="px-3 py-2">{e.employmentType.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="px-3 py-2">
                  <HrStatusBadge status={e.status} />
                </td>
                <td className="px-3 py-2 text-muted-foreground">{fmtDate(e.joiningDate)}</td>
              </tr>
            ))}
            {list.data.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  No employees match these filters.
                </td>
              </tr>
            )}
          </Table>
          <Pager
            page={page}
            totalPages={Math.max(1, Math.ceil(total / pageSize))}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
