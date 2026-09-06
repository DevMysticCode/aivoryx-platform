'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { Table, Select, Pager } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import { HrStatusBadge, TextField, fmtDate, fmtDateTime } from '@/components/hr/ui';
import {
  useAttendance,
  useEmployees,
  useRecordAttendance,
  useCorrectAttendance,
} from '@/lib/hr/use-hr';

const STATUSES = [
  'PRESENT',
  'ABSENT',
  'HALF_DAY',
  'LATE',
  'EARLY_DEPARTURE',
  'ON_LEAVE',
  'HOLIDAY',
  'WEEKEND',
  'OTHER',
];

export default function AttendancePage() {
  const perms = usePermissions();
  const canManage = perms.includes('hr.attendance.manage');
  const canCorrect = perms.includes('hr.attendance.correct');

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [page, setPage] = useState(1);

  const employees = useEmployees({ pageSize: 100 });
  const list = useAttendance({
    from: from || undefined,
    to: to || undefined,
    status: status || undefined,
    employeeId: employeeId || undefined,
    page,
  });
  const record = useRecordAttendance();

  const [showRec, setShowRec] = useState(false);
  const [rec, setRec] = useState({ employeeId: '', workDate: '', status: 'PRESENT' });

  const total = list.data?.total ?? 0;
  const pageSize = list.data?.pageSize ?? 25;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Recorded on server time. GPS is optional and straight-line only."
      >
        {canManage && (
          <Button size="sm" onClick={() => setShowRec((v) => !v)}>
            {showRec ? 'Close' : 'Record attendance'}
          </Button>
        )}
      </PageHeader>

      {showRec && canManage && (
        <Card className="grid gap-3 sm:grid-cols-4">
          <Select
            label="Employee"
            value={rec.employeeId}
            onChange={(e) => setRec((r) => ({ ...r, employeeId: e.target.value }))}
          >
            <option value="">—</option>
            {employees.data?.items.map((e) => (
              <option key={e.id} value={e.id}>
                {e.displayName}
              </option>
            ))}
          </Select>
          <TextField
            label="Date"
            type="date"
            value={rec.workDate}
            onChange={(e) => setRec((r) => ({ ...r, workDate: e.target.value }))}
          />
          <Select
            label="Status"
            value={rec.status}
            onChange={(e) => setRec((r) => ({ ...r, status: e.target.value }))}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!rec.employeeId || !rec.workDate || record.isPending}
              onClick={() => record.mutate(rec, { onSuccess: () => setShowRec(false) })}
            >
              Save
            </Button>
          </div>
          {record.error && (
            <div className="sm:col-span-4">
              <ErrorNote error={record.error} />
            </div>
          )}
        </Card>
      )}

      <Card className="grid gap-3 sm:grid-cols-4">
        <Select
          label="Employee"
          value={employeeId}
          onChange={(e) => {
            setPage(1);
            setEmployeeId(e.target.value);
          }}
        >
          <option value="">All</option>
          {employees.data?.items.map((e) => (
            <option key={e.id} value={e.id}>
              {e.displayName}
            </option>
          ))}
        </Select>
        <TextField
          label="From"
          type="date"
          value={from}
          onChange={(e) => {
            setPage(1);
            setFrom(e.target.value);
          }}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          onChange={(e) => {
            setPage(1);
            setTo(e.target.value);
          }}
        />
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
      </Card>

      {list.isLoading && <Skeleton rows={5} />}
      {list.error && <ErrorNote error={list.error} />}
      {list.data && (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Check in</th>
                <th className="px-3 py-2">Check out</th>
                <th className="px-3 py-2">GPS (m)</th>
                <th className="px-3 py-2">Source</th>
                {canCorrect && <th className="px-3 py-2" />}
              </tr>
            }
          >
            {list.data.items.map((a) => (
              <AttendanceRow key={a.id} a={a} canCorrect={canCorrect} />
            ))}
            {list.data.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">
                  No attendance records for these filters.
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

function AttendanceRow({
  a,
  canCorrect,
}: {
  a: {
    id: string;
    employeeName: string;
    employeeNumber: string;
    workDate: string;
    status: string;
    checkInAt: string | null;
    checkOutAt: string | null;
    gpsDistanceM: string | null;
    source: string;
    correctionCount: number;
  };
  canCorrect: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<'status' | 'checkInAt' | 'checkOutAt' | 'notes'>('status');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const correct = useCorrectAttendance(a.id);

  return (
    <>
      <tr>
        <td className="px-3 py-2">
          {a.employeeName}
          <span className="ml-1 text-xs text-muted-foreground">{a.employeeNumber}</span>
        </td>
        <td className="px-3 py-2">{fmtDate(a.workDate)}</td>
        <td className="px-3 py-2">
          <HrStatusBadge status={a.status} />
        </td>
        <td className="px-3 py-2 tabular-nums">{fmtDateTime(a.checkInAt)}</td>
        <td className="px-3 py-2 tabular-nums">{fmtDateTime(a.checkOutAt)}</td>
        <td className="px-3 py-2 tabular-nums text-muted-foreground">{a.gpsDistanceM ?? '—'}</td>
        <td className="px-3 py-2 text-muted-foreground">{a.source}</td>
        {canCorrect && (
          <td className="px-3 py-2 text-right">
            <button
              className="text-xs text-primary hover:underline"
              onClick={() => setOpen((v) => !v)}
            >
              {a.correctionCount ? `Correct (${a.correctionCount})` : 'Correct'}
            </button>
          </td>
        )}
      </tr>
      {open && canCorrect && (
        <tr>
          <td colSpan={8} className="bg-accent/30 px-3 py-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <Select
                label="Field"
                value={field}
                onChange={(e) => setField(e.target.value as typeof field)}
              >
                <option value="status">status</option>
                <option value="checkInAt">check-in</option>
                <option value="checkOutAt">check-out</option>
                <option value="notes">notes</option>
              </Select>
              <TextField
                label="New value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                hint="ISO datetime for time fields"
              />
              <TextField
                label="Reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex items-end">
                <Button
                  size="sm"
                  disabled={!value || !reason || correct.isPending}
                  onClick={() =>
                    correct.mutate({ field, value, reason }, { onSuccess: () => setOpen(false) })
                  }
                >
                  Apply correction
                </Button>
              </div>
            </div>
            {correct.error && (
              <div className="mt-2">
                <ErrorNote error={correct.error} />
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Corrections are immutable and generate an audit record with the original and new
              value.
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
