'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { Select, Table } from '@/components/supply/ui';
import { usePermissions } from '@/components/supply/supply-shell';
import {
  HrStatusBadge,
  TextField,
  DefRow,
  money,
  fmtDate,
  fmtDateTime,
  TabBar,
} from '@/components/hr/ui';
import * as hrApi from '@/lib/api/hr';
import {
  useEmployee,
  useEmployeeHistory,
  useEmployeeDocuments,
  useCompensationHistory,
  useBankDetails,
  useAttendance,
  useLeaveBalances,
  useLeaveRequests,
  useExpenseClaims,
  useChangeEmployeeStatus,
  useCreateCompensation,
  useUpsertBankDetails,
} from '@/lib/hr/use-hr';

type Tab =
  | 'overview'
  | 'employment'
  | 'attendance'
  | 'leave'
  | 'expenses'
  | 'compensation'
  | 'bank'
  | 'documents'
  | 'activity';

const STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED', 'RESIGNED', 'INACTIVE'];

export default function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const perms = usePermissions();
  const canComp = perms.includes('hr.compensation.read');
  const canBank = perms.includes('hr.bank_details.read');
  const canManage = perms.includes('hr.employee.manage');

  const [tab, setTab] = useState<Tab>('overview');
  const emp = useEmployee(id);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'employment', label: 'Employment' },
    { key: 'attendance', label: 'Attendance' },
    { key: 'leave', label: 'Leave' },
    { key: 'expenses', label: 'Expenses' },
    ...(canComp ? ([{ key: 'compensation', label: 'Compensation' }] as const) : []),
    ...(canBank ? ([{ key: 'bank', label: 'Bank / Payment' }] as const) : []),
    { key: 'documents', label: 'Documents' },
    { key: 'activity', label: 'Activity' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/hr/employees" className="text-sm text-muted-foreground hover:underline">
          ← Employees
        </Link>
      </div>

      {emp.isLoading && <Skeleton rows={4} />}
      {emp.error && <ErrorNote error={emp.error} />}

      {emp.data && (
        <>
          <PageHeader
            title={emp.data.displayName}
            description={`${emp.data.employeeNumber} · ${emp.data.designation ?? '—'} · ${emp.data.department ?? '—'}`}
          >
            <HrStatusBadge status={emp.data.status} />
          </PageHeader>

          <TabBar tabs={tabs} active={tab} onChange={setTab} />

          {tab === 'overview' && <Overview id={id} />}
          {tab === 'employment' && <Employment id={id} canManage={canManage} />}
          {tab === 'attendance' && <AttendanceTab id={id} />}
          {tab === 'leave' && <LeaveTab id={id} />}
          {tab === 'expenses' && <ExpensesTab id={id} />}
          {tab === 'compensation' && canComp && (
            <CompensationTab id={id} canManage={perms.includes('hr.compensation.manage')} />
          )}
          {tab === 'bank' && canBank && (
            <BankTab id={id} canManage={perms.includes('hr.bank_details.manage')} />
          )}
          {tab === 'documents' && <DocumentsTab id={id} canManage={canManage} />}
          {tab === 'activity' && <ActivityTab id={id} />}
        </>
      )}
    </div>
  );
}

function Overview({ id }: { id: string }) {
  const emp = useEmployee(id);
  if (!emp.data) return null;
  const e = emp.data;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <div className="mb-2 text-sm font-semibold">Profile</div>
        <DefRow label="Full name">
          {[e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ')}
        </DefRow>
        <DefRow label="Work email">{e.workEmail ?? '—'}</DefRow>
        <DefRow label="Personal email">{e.personalEmail ?? '—'}</DefRow>
        <DefRow label="Phone">{e.phone ?? '—'}</DefRow>
        <DefRow label="Category">{e.category ?? '—'}</DefRow>
        <DefRow label="Has login">{e.hasLogin ? 'Yes' : 'No'}</DefRow>
      </Card>
      <Card>
        <div className="mb-2 text-sm font-semibold">Employment</div>
        <DefRow label="Status">
          <HrStatusBadge status={e.status} />
        </DefRow>
        <DefRow label="Type">{e.employmentType.replace(/_/g, ' ').toLowerCase()}</DefRow>
        <DefRow label="Department">{e.department ?? '—'}</DefRow>
        <DefRow label="Designation">{e.designation ?? '—'}</DefRow>
        <DefRow label="Work location">{e.workLocation ?? '—'}</DefRow>
        <DefRow label="Manager">{e.managerName ?? '—'}</DefRow>
        <DefRow label="Joined">{fmtDate(e.joiningDate)}</DefRow>
      </Card>
    </div>
  );
}

function Employment({ id, canManage }: { id: string; canManage: boolean }) {
  const emp = useEmployee(id);
  const change = useChangeEmployeeStatus(id);
  const [status, setStatus] = useState('');
  const [reason, setReason] = useState('');
  if (!emp.data) return null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 text-sm font-semibold">Lifecycle status</div>
        <p className="text-sm text-muted-foreground">
          Current: <HrStatusBadge status={emp.data.status} />
        </p>
        {canManage ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Select label="Change to" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">—</option>
              {STATUSES.filter((s) => s !== emp.data!.status).map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
            <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex items-end">
              <Button
                size="sm"
                disabled={!status || change.isPending}
                onClick={() => change.mutate({ status, reason: reason || undefined })}
              >
                Apply
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            You do not have permission to change status.
          </p>
        )}
        {change.error && <ErrorNote error={change.error} />}
      </Card>
      <ActivityTab id={id} />
    </div>
  );
}

function AttendanceTab({ id }: { id: string }) {
  const q = useAttendance({ employeeId: id, pageSize: 30 });
  return (
    <div className="space-y-3">
      {q.isLoading && <Skeleton rows={4} />}
      {q.error && <ErrorNote error={q.error} />}
      {q.data && (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Check in</th>
              <th className="px-3 py-2">Check out</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Corrections</th>
            </tr>
          }
        >
          {q.data.items.map((a) => (
            <tr key={a.id}>
              <td className="px-3 py-2">{fmtDate(a.workDate)}</td>
              <td className="px-3 py-2">
                <HrStatusBadge status={a.status} />
              </td>
              <td className="px-3 py-2 tabular-nums">{fmtDateTime(a.checkInAt)}</td>
              <td className="px-3 py-2 tabular-nums">{fmtDateTime(a.checkOutAt)}</td>
              <td className="px-3 py-2 text-muted-foreground">{a.source}</td>
              <td className="px-3 py-2 tabular-nums">{a.correctionCount || '—'}</td>
            </tr>
          ))}
          {q.data.items.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                No attendance recorded.
              </td>
            </tr>
          )}
        </Table>
      )}
    </div>
  );
}

function LeaveTab({ id }: { id: string }) {
  const balances = useLeaveBalances(id);
  const requests = useLeaveRequests({ employeeId: id, pageSize: 25 });
  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-2 text-sm font-semibold">Balances ({new Date().getFullYear()})</div>
        {balances.data && balances.data.length > 0 ? (
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
        ) : (
          <p className="text-sm text-muted-foreground">No balances.</p>
        )}
      </Card>
      <Card>
        <div className="mb-2 text-sm font-semibold">Requests</div>
        {requests.data && requests.data.items.length > 0 ? (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Dates</th>
                <th className="px-3 py-2">Days</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            }
          >
            {requests.data.items.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 tabular-nums">{r.requestNumber}</td>
                <td className="px-3 py-2">{r.leaveTypeName}</td>
                <td className="px-3 py-2">
                  {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.totalDays}</td>
                <td className="px-3 py-2">
                  <HrStatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No leave requests.</p>
        )}
      </Card>
    </div>
  );
}

function ExpensesTab({ id }: { id: string }) {
  const q = useExpenseClaims({ employeeId: id, pageSize: 25 });
  return (
    <div className="space-y-3">
      {q.data && q.data.items.length > 0 ? (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Number</th>
              <th className="px-3 py-2">Category</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Amount</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          }
        >
          {q.data.items.map((c) => (
            <tr key={c.id}>
              <td className="px-3 py-2">
                <Link href={`/hr/expenses/${c.id}`} className="text-primary hover:underline">
                  {c.claimNumber}
                </Link>
              </td>
              <td className="px-3 py-2">{c.categoryName}</td>
              <td className="px-3 py-2">{fmtDate(c.expenseDate)}</td>
              <td className="px-3 py-2 tabular-nums">{money(c.amount, c.currency)}</td>
              <td className="px-3 py-2">
                <HrStatusBadge status={c.status} />
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">No expense claims.</p>
      )}
    </div>
  );
}

function CompensationTab({ id, canManage }: { id: string; canManage: boolean }) {
  const history = useCompensationHistory(id, true);
  const create = useCreateCompensation(id);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({
    effectiveDate: '',
    baseSalary: '',
    payFrequency: 'MONTHLY',
    currency: 'INR',
  });

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
        Compensation is sensitive and gated by <code>hr.compensation.*</code>. It is never shown in
        the employee list, audit metadata or notifications.
      </div>
      {canManage && (
        <Button size="sm" onClick={() => setShow((v) => !v)}>
          {show ? 'Close' : 'New compensation'}
        </Button>
      )}
      {show && (
        <Card className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField
            label="Effective date"
            type="date"
            value={form.effectiveDate}
            onChange={(e) => setForm((f) => ({ ...f, effectiveDate: e.target.value }))}
          />
          <TextField
            label="Base salary"
            value={form.baseSalary}
            onChange={(e) => setForm((f) => ({ ...f, baseSalary: e.target.value }))}
          />
          <Select
            label="Frequency"
            value={form.payFrequency}
            onChange={(e) => setForm((f) => ({ ...f, payFrequency: e.target.value }))}
          >
            {['MONTHLY', 'WEEKLY', 'BIWEEKLY', 'ANNUAL'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
          <div className="flex items-end">
            <Button
              size="sm"
              disabled={!form.effectiveDate || !form.baseSalary || create.isPending}
              onClick={() => create.mutate({ ...form }, { onSuccess: () => setShow(false) })}
            >
              Save
            </Button>
          </div>
          {create.error && (
            <div className="sm:col-span-2 lg:col-span-4">
              <ErrorNote error={create.error} />
            </div>
          )}
        </Card>
      )}
      {history.isLoading && <Skeleton rows={3} />}
      {history.error && <ErrorNote error={history.error} />}
      {history.data?.map((c) => (
        <Card key={c.id}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">
              Effective {fmtDate(c.effectiveDate)} <HrStatusBadge status={c.status} />
            </div>
            <div className="text-sm tabular-nums">
              Base {money(c.baseSalary, c.currency)} / {c.payFrequency.toLowerCase()}
            </div>
          </div>
          {c.components.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {c.components.map((k, i) => (
                <li key={i} className="flex justify-between border-b py-1 last:border-0">
                  <span className="text-muted-foreground">
                    {k.name} <span className="text-xs">({k.kind.toLowerCase()})</span>
                  </span>
                  <span className="tabular-nums">{money(k.amount, c.currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
      {history.data?.length === 0 && (
        <p className="text-sm text-muted-foreground">No compensation on file.</p>
      )}
    </div>
  );
}

function BankTab({ id, canManage }: { id: string; canManage: boolean }) {
  const bank = useBankDetails(id, true);
  const upsert = useUpsertBankDetails(id);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({
    accountHolderName: '',
    bankName: '',
    accountNumber: '',
    branch: '',
    bankIdentifier: '',
    swiftBic: '',
    preferredMethod: 'BANK_TRANSFER',
  });

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
        Highly sensitive. The account number is stored masked-on-read; the full number is never
        returned by the API, logged, put in audit metadata, or sent in notifications.
      </div>
      {bank.isLoading && <Skeleton rows={3} />}
      {bank.error ? (
        <p className="text-sm text-muted-foreground">No bank details on file.</p>
      ) : (
        bank.data && (
          <Card>
            <DefRow label="Account holder">{bank.data.accountHolderName}</DefRow>
            <DefRow label="Bank">{bank.data.bankName ?? '—'}</DefRow>
            <DefRow label="Account number">
              <span className="tabular-nums">{bank.data.accountNumberMasked}</span>
            </DefRow>
            <DefRow label="Branch">{bank.data.branch ?? '—'}</DefRow>
            <DefRow label="Bank identifier">{bank.data.bankIdentifier ?? '—'}</DefRow>
            <DefRow label="SWIFT / BIC">{bank.data.swiftBic ?? '—'}</DefRow>
            <DefRow label="Preferred method">{bank.data.preferredMethod}</DefRow>
            <DefRow label="Updated">{fmtDateTime(bank.data.updatedAt)}</DefRow>
          </Card>
        )
      )}
      {canManage && (
        <>
          <Button size="sm" onClick={() => setShow((v) => !v)}>
            {show ? 'Close' : bank.data ? 'Replace bank details' : 'Add bank details'}
          </Button>
          {show && (
            <Card className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Account holder"
                value={form.accountHolderName}
                onChange={(e) => setForm((f) => ({ ...f, accountHolderName: e.target.value }))}
              />
              <TextField
                label="Bank name"
                value={form.bankName}
                onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
              />
              <TextField
                label="Account number"
                value={form.accountNumber}
                onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
              />
              <TextField
                label="Branch"
                value={form.branch}
                onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
              />
              <TextField
                label="Bank identifier (IFSC / sort / routing)"
                value={form.bankIdentifier}
                onChange={(e) => setForm((f) => ({ ...f, bankIdentifier: e.target.value }))}
              />
              <TextField
                label="SWIFT / BIC"
                value={form.swiftBic}
                onChange={(e) => setForm((f) => ({ ...f, swiftBic: e.target.value }))}
              />
              <Select
                label="Preferred method"
                value={form.preferredMethod}
                onChange={(e) => setForm((f) => ({ ...f, preferredMethod: e.target.value }))}
              >
                {['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'UPI', 'OTHER'].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </Select>
              <div className="flex items-end">
                <Button
                  size="sm"
                  disabled={!form.accountHolderName || !form.accountNumber || upsert.isPending}
                  onClick={() => upsert.mutate({ ...form }, { onSuccess: () => setShow(false) })}
                >
                  Save
                </Button>
              </div>
              {upsert.error && (
                <div className="sm:col-span-2">
                  <ErrorNote error={upsert.error} />
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function DocumentsTab({ id, canManage }: { id: string; canManage: boolean }) {
  const docs = useEmployeeDocuments(id);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const upload = async (file: File, kind: string, title: string) => {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('kind', kind);
      fd.set('title', title);
      await hrApi.uploadEmployeeDocument(id, fd);
      await docs.refetch();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {canManage && (
        <Card className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block font-medium">Add document</span>
            <input
              type="file"
              disabled={busy}
              className="mt-1 text-sm"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f, 'general', f.name);
                e.currentTarget.value = '';
              }}
            />
          </label>
          {busy && <span className="text-xs text-muted-foreground">Uploading…</span>}
        </Card>
      )}
      {err ? <ErrorNote error={err} /> : null}
      {docs.data && docs.data.length > 0 ? (
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Kind</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Size</th>
              <th className="px-3 py-2">Added</th>
              <th className="px-3 py-2" />
            </tr>
          }
        >
          {docs.data.map((d) => (
            <tr key={d.id}>
              <td className="px-3 py-2">{d.title}</td>
              <td className="px-3 py-2">{d.kind}</td>
              <td className="px-3 py-2 text-muted-foreground">{d.contentType}</td>
              <td className="px-3 py-2 tabular-nums">{(d.sizeBytes / 1024).toFixed(0)} KB</td>
              <td className="px-3 py-2">{fmtDate(d.createdAt)}</td>
              <td className="px-3 py-2 text-right">
                <a
                  href={hrApi.employeeDocumentUrl(id, d.id)}
                  className="text-primary hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </a>
              </td>
            </tr>
          ))}
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground">No documents.</p>
      )}
    </div>
  );
}

function ActivityTab({ id }: { id: string }) {
  const hist = useEmployeeHistory(id);
  return (
    <div className="space-y-3">
      {hist.isLoading && <Skeleton rows={3} />}
      {hist.error && <ErrorNote error={hist.error} />}
      {hist.data && hist.data.length > 0 ? (
        <ol className="space-y-2">
          {hist.data.map((h) => (
            <li key={h.id} className="rounded-md border bg-card p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">{h.changeType.replace(/_/g, ' ')}</span>
                <span className="text-xs text-muted-foreground">
                  effective {fmtDate(h.effectiveDate)}
                </span>
              </div>
              {h.reason && <p className="mt-1 text-muted-foreground">{h.reason}</p>}
              <p className="mt-1 text-xs text-muted-foreground">
                recorded {fmtDateTime(h.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">No employment history yet.</p>
      )}
    </div>
  );
}
