'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { Table, Select } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import type { HrPerformanceReview } from '@aivoryx/contracts';
import { HrStatusBadge, TextField, TabBar, fmtDate } from '@/components/hr/ui';
import {
  usePerformancePeriods,
  usePerformanceGoals,
  usePerformanceReviews,
  useCreatePerformancePeriod,
  useCreatePerformanceGoal,
  useCreatePerformanceReview,
  usePerformancePeriodStatus,
  useReviewActions,
  useEmployees,
} from '@/lib/hr/use-hr';

type Tab = 'periods' | 'goals' | 'reviews';

export default function PerformancePage() {
  const perms = usePermissions();
  const canManage = perms.includes('hr.performance.manage');
  const [tab, setTab] = useState<Tab>('periods');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Performance"
        description="Lightweight periods, goals and reviews. No scoring engine."
      />
      <TabBar
        tabs={[
          { key: 'periods', label: 'Periods' },
          { key: 'goals', label: 'Goals' },
          { key: 'reviews', label: 'Reviews' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'periods' && <Periods canManage={canManage} />}
      {tab === 'goals' && <Goals canManage={canManage} />}
      {tab === 'reviews' && <Reviews canManage={canManage} />}
    </div>
  );
}

function Periods({ canManage }: { canManage: boolean }) {
  const list = usePerformancePeriods();
  const create = useCreatePerformancePeriod();
  const status = usePerformancePeriodStatus();
  const [form, setForm] = useState({ name: '', periodStart: '', periodEnd: '' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      {canManage && (
        <Card className="grid gap-3 sm:grid-cols-4">
          <TextField
            label="Name"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            hint="e.g. H2 2026"
          />
          <TextField
            label="Start"
            type="date"
            value={form.periodStart}
            onChange={(e) => set('periodStart', e.target.value)}
          />
          <TextField
            label="End"
            type="date"
            value={form.periodEnd}
            onChange={(e) => set('periodEnd', e.target.value)}
          />
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!form.name || !form.periodStart || !form.periodEnd || create.isPending}
              onClick={() => create.mutate({ ...form }, { onSuccess: () => set('name', '') })}
            >
              Create
            </Button>
          </div>
          {create.error && (
            <div className="sm:col-span-4">
              <ErrorNote error={create.error} />
            </div>
          )}
        </Card>
      )}
      {list.isLoading && <Skeleton rows={3} />}
      {list.data && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Window</th>
              <th className="px-3 py-2">Status</th>
              {canManage && <th className="px-3 py-2" />}
            </tr>
          }
        >
          {list.data.map((p) => (
            <tr key={p.id}>
              <td className="px-3 py-2 font-medium">{p.name}</td>
              <td className="px-3 py-2 text-muted-foreground">
                {fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}
              </td>
              <td className="px-3 py-2">
                <HrStatusBadge status={p.status} />
              </td>
              {canManage && (
                <td className="px-3 py-2 text-right">
                  {p.status === 'DRAFT' && (
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={() => status.mutate({ id: p.id, action: 'open' })}
                    >
                      Open
                    </button>
                  )}
                  {p.status === 'OPEN' && (
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={() => status.mutate({ id: p.id, action: 'close' })}
                    >
                      Close
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function Goals({ canManage }: { canManage: boolean }) {
  const periods = usePerformancePeriods();
  const employees = useEmployees({ pageSize: 100 });
  const [periodId, setPeriodId] = useState('');
  const goals = usePerformanceGoals(periodId ? { performancePeriodId: periodId } : {});
  const create = useCreatePerformanceGoal();
  const [form, setForm] = useState({ employeeId: '', title: '', weight: '' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      <Card className="max-w-sm">
        <Select label="Period" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
          <option value="">All</option>
          {periods.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Card>
      {canManage && (
        <Card className="grid gap-3 sm:grid-cols-4">
          <Select
            label="Employee"
            value={form.employeeId}
            onChange={(e) => set('employeeId', e.target.value)}
          >
            <option value="">—</option>
            {employees.data?.items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.displayName}
              </option>
            ))}
          </Select>
          <TextField
            label="Goal"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
          />
          <TextField
            label="Weight"
            value={form.weight}
            onChange={(e) => set('weight', e.target.value)}
          />
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!periodId || !form.employeeId || !form.title || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    performancePeriodId: periodId,
                    employeeId: form.employeeId,
                    title: form.title,
                    weight: form.weight ? Number(form.weight) : undefined,
                  },
                  { onSuccess: () => set('title', '') },
                )
              }
            >
              Add goal
            </Button>
          </div>
          {create.error && (
            <div className="sm:col-span-4">
              <ErrorNote error={create.error} />
            </div>
          )}
        </Card>
      )}
      {goals.data && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Employee</th>
              <th className="px-3 py-2">Goal</th>
              <th className="px-3 py-2">Weight</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          }
        >
          {goals.data.map((g) => (
            <tr key={g.id}>
              <td className="px-3 py-2">{g.employeeName}</td>
              <td className="px-3 py-2">{g.title}</td>
              <td className="px-3 py-2 tabular-nums">{g.weight ?? '—'}</td>
              <td className="px-3 py-2">
                <HrStatusBadge status={g.status} />
              </td>
            </tr>
          ))}
          {goals.data.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                No goals.
              </td>
            </tr>
          )}
        </Table>
      )}
    </div>
  );
}

function Reviews({ canManage }: { canManage: boolean }) {
  const periods = usePerformancePeriods();
  const employees = useEmployees({ pageSize: 100 });
  const [periodId, setPeriodId] = useState('');
  const reviews = usePerformanceReviews(periodId ? { performancePeriodId: periodId } : {});
  const create = useCreatePerformanceReview();
  const [form, setForm] = useState({ employeeId: '', overallRating: '', managerComments: '' });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      <Card className="max-w-sm">
        <Select label="Period" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
          <option value="">All</option>
          {periods.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Card>
      {canManage && (
        <Card className="grid gap-3 sm:grid-cols-4">
          <Select
            label="Employee"
            value={form.employeeId}
            onChange={(e) => set('employeeId', e.target.value)}
          >
            <option value="">—</option>
            {employees.data?.items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.displayName}
              </option>
            ))}
          </Select>
          <TextField
            label="Rating (1–5)"
            value={form.overallRating}
            onChange={(e) => set('overallRating', e.target.value)}
          />
          <TextField
            label="Manager comments"
            className="sm:col-span-2"
            value={form.managerComments}
            onChange={(e) => set('managerComments', e.target.value)}
          />
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!periodId || !form.employeeId || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    performancePeriodId: periodId,
                    employeeId: form.employeeId,
                    overallRating: form.overallRating ? Number(form.overallRating) : undefined,
                    managerComments: form.managerComments || undefined,
                  },
                  { onSuccess: () => set('employeeId', '') },
                )
              }
            >
              Create review
            </Button>
          </div>
          {create.error && (
            <div className="sm:col-span-4">
              <ErrorNote error={create.error} />
            </div>
          )}
        </Card>
      )}
      {reviews.data?.map((r) => <ReviewCard key={r.id} r={r} canManage={canManage} />)}
      {reviews.data && reviews.data.length === 0 && (
        <p className="text-sm text-muted-foreground">No reviews.</p>
      )}
    </div>
  );
}

function ReviewCard({ r, canManage }: { r: HrPerformanceReview; canManage: boolean }) {
  const actions = useReviewActions(r.id);
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">
          {r.employeeName} · {r.periodName}
        </span>
        <HrStatusBadge status={r.status} />
      </div>
      <div className="text-sm text-muted-foreground">Rating: {r.overallRating ?? '—'} / 5</div>
      {r.managerComments && <p className="text-sm">Manager: {r.managerComments}</p>}
      {r.employeeComments && <p className="text-sm">Employee: {r.employeeComments}</p>}
      {canManage && (
        <div className="flex gap-2">
          {r.status === 'DRAFT' && (
            <Button
              size="sm"
              disabled={actions.submit.isPending}
              onClick={() => actions.submit.mutate()}
            >
              Submit to employee
            </Button>
          )}
          {(r.status === 'SUBMITTED' || r.status === 'ACKNOWLEDGED') && (
            <Button
              size="sm"
              variant="outline"
              disabled={actions.close.isPending}
              onClick={() => actions.close.mutate()}
            >
              Close
            </Button>
          )}
        </div>
      )}
      {(actions.submit.error || actions.close.error) && (
        <ErrorNote error={actions.submit.error || actions.close.error} />
      )}
    </Card>
  );
}
