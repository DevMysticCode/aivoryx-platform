'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { Table, Select } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import type { HrLeaveRequest } from '@aivoryx/contracts';
import { HrStatusBadge, TextField, TabBar, fmtDate } from '@/components/hr/ui';
import {
  useLeaveTypes,
  useMyLeaveRequests,
  useLeaveQueue,
  useLeaveCalendar,
  useLeaveRequests,
  useCreateLeaveType,
  useCreateLeaveRequest,
  useLeaveDecision,
  useEmployees,
  useLeaveBalances,
} from '@/lib/hr/use-hr';

type Tab = 'mine' | 'approvals' | 'all' | 'calendar' | 'balances' | 'types';

export default function LeavePage() {
  const perms = usePermissions();
  const canApprove = perms.includes('hr.leave.approve');
  const canManage = perms.includes('hr.leave.manage');
  const [tab, setTab] = useState<Tab>('mine');

  const tabs: { key: Tab; label: string }[] = [
    { key: 'mine', label: 'My leave' },
    ...(canApprove ? ([{ key: 'approvals', label: 'Approval queue' }] as const) : []),
    { key: 'all', label: 'All requests' },
    { key: 'calendar', label: 'Calendar' },
    { key: 'balances', label: 'Balances' },
    { key: 'types', label: 'Leave types' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Leave" description="Requests, approvals and ledger-backed balances." />
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'mine' && <MyLeave />}
      {tab === 'approvals' && canApprove && <ApprovalQueue />}
      {tab === 'all' && <AllRequests />}
      {tab === 'calendar' && <LeaveCalendar />}
      {tab === 'balances' && <Balances />}
      {tab === 'types' && <LeaveTypes canManage={canManage} />}
    </div>
  );
}

function MyLeave() {
  const types = useLeaveTypes();
  const mine = useMyLeaveRequests();
  const create = useCreateLeaveRequest();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({
    leaveTypeId: '',
    startDate: '',
    endDate: '',
    isHalfDay: false,
    reason: '',
  });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={() => setShow((v) => !v)}>
        {show ? 'Close' : 'Request leave'}
      </Button>
      {show && (
        <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Type"
            value={form.leaveTypeId}
            onChange={(e) => set('leaveTypeId', e.target.value)}
          >
            <option value="">—</option>
            {types.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <TextField
            label="Start"
            type="date"
            value={form.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
          <TextField
            label="End"
            type="date"
            value={form.endDate}
            onChange={(e) => set('endDate', e.target.value)}
          />
          <label className="flex items-end gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isHalfDay}
              onChange={(e) => set('isHalfDay', e.target.checked)}
            />
            Half day
          </label>
          <TextField
            label="Reason"
            className="sm:col-span-2 lg:col-span-3"
            value={form.reason}
            onChange={(e) => set('reason', e.target.value)}
          />
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!form.leaveTypeId || !form.startDate || !form.endDate || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    leaveTypeId: form.leaveTypeId,
                    startDate: form.startDate,
                    endDate: form.endDate,
                    isHalfDay: form.isHalfDay || undefined,
                    reason: form.reason || undefined,
                  },
                  { onSuccess: () => setShow(false) },
                )
              }
            >
              Submit
            </Button>
          </div>
          {create.error && (
            <div className="sm:col-span-2 lg:col-span-4">
              <ErrorNote error={create.error} />
            </div>
          )}
        </Card>
      )}
      {mine.isLoading && <Skeleton rows={4} />}
      {mine.error && <ErrorNote error={mine.error} />}
      {mine.data && <RequestTable rows={mine.data.items} showCancel />}
    </div>
  );
}

function ApprovalQueue() {
  const q = useLeaveQueue();
  return (
    <div className="space-y-3">
      {q.isLoading && <Skeleton rows={3} />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && q.data.length === 0 && (
        <p className="text-sm text-muted-foreground">Nothing awaiting your decision.</p>
      )}
      {q.data?.map((r) => <DecisionCard key={r.id} r={r} />)}
    </div>
  );
}

function DecisionCard({ r }: { r: HrLeaveRequest }) {
  const dec = useLeaveDecision(r.id);
  const [reason, setReason] = useState('');
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div>
          <span className="font-medium">{r.employeeName}</span>{' '}
          <span className="text-muted-foreground">{r.employeeNumber}</span> · {r.leaveTypeName}
        </div>
        <HrStatusBadge status={r.status} />
      </div>
      <div className="text-sm text-muted-foreground">
        {fmtDate(r.startDate)} – {fmtDate(r.endDate)} · {r.totalDays} day(s)
        {r.availableBalance != null && ` · balance ${r.availableBalance}`}
      </div>
      {r.reason && <p className="text-sm">{r.reason}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <TextField label="Note" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button
          size="sm"
          disabled={dec.approve.isPending}
          onClick={() => dec.approve.mutate({ reason: reason || undefined })}
        >
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={dec.reject.isPending}
          onClick={() => dec.reject.mutate({ reason: reason || undefined })}
        >
          Reject
        </Button>
      </div>
      {(dec.approve.error || dec.reject.error) && (
        <ErrorNote error={dec.approve.error || dec.reject.error} />
      )}
    </Card>
  );
}

function AllRequests() {
  const [status, setStatus] = useState('');
  const q = useLeaveRequests({ status: status || undefined, pageSize: 50 });
  return (
    <div className="space-y-3">
      <Card className="max-w-xs">
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>
          {['DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
      </Card>
      {q.isLoading && <Skeleton rows={4} />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && <RequestTable rows={q.data.items} withEmployee />}
    </div>
  );
}

function RequestTable({
  rows,
  withEmployee,
  showCancel,
}: {
  rows: HrLeaveRequest[];
  withEmployee?: boolean;
  showCancel?: boolean;
}) {
  return (
    <Table
      head={
        <tr>
          <th className="px-3 py-2">Number</th>
          {withEmployee && <th className="px-3 py-2">Employee</th>}
          <th className="px-3 py-2">Type</th>
          <th className="px-3 py-2">Dates</th>
          <th className="px-3 py-2">Days</th>
          <th className="px-3 py-2">Approver</th>
          <th className="px-3 py-2">Status</th>
          {showCancel && <th className="px-3 py-2" />}
        </tr>
      }
    >
      {rows.map((r) => (
        <RequestRow key={r.id} r={r} withEmployee={withEmployee} showCancel={showCancel} />
      ))}
      {rows.length === 0 && (
        <tr>
          <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
            No requests.
          </td>
        </tr>
      )}
    </Table>
  );
}

function RequestRow({
  r,
  withEmployee,
  showCancel,
}: {
  r: HrLeaveRequest;
  withEmployee?: boolean;
  showCancel?: boolean;
}) {
  const dec = useLeaveDecision(r.id);
  return (
    <tr>
      <td className="px-3 py-2 tabular-nums">{r.requestNumber}</td>
      {withEmployee && (
        <td className="px-3 py-2">
          {r.employeeName} <span className="text-xs text-muted-foreground">{r.employeeNumber}</span>
        </td>
      )}
      <td className="px-3 py-2">{r.leaveTypeName}</td>
      <td className="px-3 py-2">
        {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
      </td>
      <td className="px-3 py-2 tabular-nums">{r.totalDays}</td>
      <td className="px-3 py-2 text-muted-foreground">{r.approverName ?? '—'}</td>
      <td className="px-3 py-2">
        <HrStatusBadge status={r.status} />
      </td>
      {showCancel && (
        <td className="px-3 py-2 text-right">
          {(r.status === 'PENDING' || r.status === 'APPROVED') && (
            <button
              className="text-xs text-primary hover:underline disabled:opacity-50"
              disabled={dec.cancel.isPending}
              onClick={() => dec.cancel.mutate()}
            >
              Cancel
            </button>
          )}
        </td>
      )}
    </tr>
  );
}

function LeaveCalendar() {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const last = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(last);
  const q = useLeaveCalendar({ from, to });
  return (
    <div className="space-y-3">
      <Card className="flex flex-wrap items-end gap-3">
        <TextField
          label="From"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <TextField label="To" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </Card>
      {q.isLoading && <Skeleton rows={3} />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Employee</th>
              <th className="px-3 py-2">Department</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Dates</th>
              <th className="px-3 py-2">Days</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          }
        >
          {q.data.map((c) => (
            <tr key={c.id}>
              <td className="px-3 py-2">{c.employeeName}</td>
              <td className="px-3 py-2 text-muted-foreground">{c.department ?? '—'}</td>
              <td className="px-3 py-2">{c.leaveTypeName}</td>
              <td className="px-3 py-2">
                {fmtDate(c.startDate)} – {fmtDate(c.endDate)}
              </td>
              <td className="px-3 py-2 tabular-nums">{c.totalDays}</td>
              <td className="px-3 py-2">
                <HrStatusBadge status={c.status} />
              </td>
            </tr>
          ))}
          {q.data.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                No leave in this window.
              </td>
            </tr>
          )}
        </Table>
      )}
    </div>
  );
}

function Balances() {
  const employees = useEmployees({ pageSize: 100 });
  const [employeeId, setEmployeeId] = useState('');
  const balances = useLeaveBalances(employeeId);
  return (
    <div className="space-y-3">
      <Card className="max-w-sm">
        <Select label="Employee" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
          <option value="">Select…</option>
          {employees.data?.items.map((e) => (
            <option key={e.id} value={e.id}>
              {e.displayName}
            </option>
          ))}
        </Select>
      </Card>
      {employeeId && balances.data && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Opening</th>
              <th className="px-3 py-2">Accrued</th>
              <th className="px-3 py-2">Consumed</th>
              <th className="px-3 py-2">Adjusted</th>
              <th className="px-3 py-2">Balance</th>
            </tr>
          }
        >
          {balances.data.map((b) => (
            <tr key={b.leaveTypeId}>
              <td className="px-3 py-2">{b.leaveTypeName}</td>
              <td className="px-3 py-2 tabular-nums">{b.opening}</td>
              <td className="px-3 py-2 tabular-nums">{b.accrued}</td>
              <td className="px-3 py-2 tabular-nums">{b.consumed}</td>
              <td className="px-3 py-2 tabular-nums">{b.adjusted}</td>
              <td className="px-3 py-2 font-medium tabular-nums">{b.balance}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function LeaveTypes({ canManage }: { canManage: boolean }) {
  const types = useLeaveTypes();
  const create = useCreateLeaveType();
  const [form, setForm] = useState({
    name: '',
    code: '',
    annualQuota: '18',
    approverStrategy: 'REPORTING_MANAGER',
    allowNegativeBalance: false,
  });
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-3">
      {canManage && (
        <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <TextField label="Name" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <TextField label="Code" value={form.code} onChange={(e) => set('code', e.target.value)} />
          <TextField
            label="Annual quota"
            value={form.annualQuota}
            onChange={(e) => set('annualQuota', e.target.value)}
          />
          <Select
            label="Approver"
            value={form.approverStrategy}
            onChange={(e) => set('approverStrategy', e.target.value)}
          >
            {['REPORTING_MANAGER', 'HR', 'DESIGNATED_APPROVER', 'TENANT_ADMIN'].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <label className="flex items-end gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.allowNegativeBalance}
              onChange={(e) => set('allowNegativeBalance', e.target.checked)}
            />
            Allow negative
          </label>
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!form.name || !form.code || create.isPending}
              onClick={() =>
                create.mutate(
                  {
                    name: form.name,
                    code: form.code,
                    annualQuota: form.annualQuota,
                    approverStrategy: form.approverStrategy,
                    allowNegativeBalance: form.allowNegativeBalance,
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
      {types.data && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Paid</th>
              <th className="px-3 py-2">Approval</th>
              <th className="px-3 py-2">Negative</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          }
        >
          {types.data.map((t) => (
            <tr key={t.id}>
              <td className="px-3 py-2 font-medium">{t.name}</td>
              <td className="px-3 py-2 text-muted-foreground">{t.code}</td>
              <td className="px-3 py-2">{t.isPaid ? 'Yes' : 'No'}</td>
              <td className="px-3 py-2">{t.requiresApproval ? 'Required' : 'Auto'}</td>
              <td className="px-3 py-2">{t.allowNegativeBalance ? 'Allowed' : 'No'}</td>
              <td className="px-3 py-2">
                <HrStatusBadge status={t.status} />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
