'use client';

import { PageHeader, ErrorNote, Skeleton, Card } from '@/components/admin/ui';
import { Table } from '@/components/supply/ui';
import { HrStatusBadge, DefRow, money, fmtDate, fmtDateTime } from '@/components/hr/ui';
import * as hrApi from '@/lib/api/hr';
import {
  useHrMe,
  useMyLeaveRequests,
  useMyExpenseClaims,
  useMyPayrollHistory,
} from '@/lib/hr/use-hr';

/** Employee self-service. Identity is resolved server-side from the session. */
export default function MyHrPage() {
  const me = useHrMe();
  const leave = useMyLeaveRequests();
  const expenses = useMyExpenseClaims();
  const payroll = useMyPayrollHistory();

  if (me.isLoading) return <Skeleton rows={5} />;
  if (me.error) {
    return (
      <div className="space-y-4">
        <PageHeader title="My HR" description="Your own profile, leave, expenses and payslips." />
        <ErrorNote error={me.error} />
        <p className="text-sm text-muted-foreground">
          If your account is not linked to an employee record, ask HR to link it.
        </p>
      </div>
    );
  }
  if (!me.data) return null;
  const e = me.data.employee;

  return (
    <div className="space-y-6">
      <PageHeader title="My HR" description={`${e.displayName} · ${e.employeeNumber}`}>
        <HrStatusBadge status={e.status} />
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="mb-2 text-sm font-semibold">Profile</div>
          <DefRow label="Department">{e.department ?? '—'}</DefRow>
          <DefRow label="Designation">{e.designation ?? '—'}</DefRow>
          <DefRow label="Manager">{e.managerName ?? '—'}</DefRow>
          <DefRow label="Work location">{e.workLocation ?? '—'}</DefRow>
          <DefRow label="Joined">{fmtDate(e.joiningDate)}</DefRow>
        </Card>
        <Card>
          <div className="mb-2 text-sm font-semibold">Today</div>
          {me.data.todayAttendance ? (
            <>
              <DefRow label="Status">
                <HrStatusBadge status={me.data.todayAttendance.status} />
              </DefRow>
              <DefRow label="Check in">{fmtDateTime(me.data.todayAttendance.checkInAt)}</DefRow>
              <DefRow label="Check out">{fmtDateTime(me.data.todayAttendance.checkOutAt)}</DefRow>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No attendance recorded today.</p>
          )}
        </Card>
      </div>

      <Card>
        <div className="mb-2 text-sm font-semibold">Leave balances</div>
        <Table
          head={
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Opening</th>
              <th className="px-3 py-2">Consumed</th>
              <th className="px-3 py-2">Balance</th>
            </tr>
          }
        >
          {me.data.leaveBalances.map((b) => (
            <tr key={b.leaveTypeId}>
              <td className="px-3 py-2">{b.leaveTypeName}</td>
              <td className="px-3 py-2 tabular-nums">{b.opening}</td>
              <td className="px-3 py-2 tabular-nums">{b.consumed}</td>
              <td className="px-3 py-2 font-medium tabular-nums">{b.balance}</td>
            </tr>
          ))}
          {me.data.leaveBalances.length === 0 && (
            <tr>
              <td colSpan={4} className="px-3 py-4 text-center text-muted-foreground">
                No balances.
              </td>
            </tr>
          )}
        </Table>
      </Card>

      <Card>
        <div className="mb-2 text-sm font-semibold">My leave requests</div>
        {leave.data && leave.data.items.length > 0 ? (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Dates</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            }
          >
            {leave.data.items.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2 tabular-nums">{r.requestNumber}</td>
                <td className="px-3 py-2">{r.leaveTypeName}</td>
                <td className="px-3 py-2">
                  {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                </td>
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

      <Card>
        <div className="mb-2 text-sm font-semibold">My expense claims</div>
        {expenses.data && expenses.data.items.length > 0 ? (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            }
          >
            {expenses.data.items.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 tabular-nums">{c.claimNumber}</td>
                <td className="px-3 py-2">{c.categoryName}</td>
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
      </Card>

      <Card>
        <div className="mb-2 text-sm font-semibold">Payslips</div>
        {payroll.data && payroll.data.length > 0 ? (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Pay date</th>
                <th className="px-3 py-2">Net</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            }
          >
            {payroll.data.map((h) => (
              <tr key={h.payrollEntryId}>
                <td className="px-3 py-2">{h.periodName}</td>
                <td className="px-3 py-2">{fmtDate(h.payDate)}</td>
                <td className="px-3 py-2 font-medium tabular-nums">
                  {money(h.netPay, h.currency)}
                </td>
                <td className="px-3 py-2">
                  <HrStatusBadge status={h.paymentStatus} />
                </td>
                <td className="px-3 py-2 text-right">
                  <a
                    href={hrApi.myPayslipPdfUrl(h.payrollEntryId)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Download payslip
                  </a>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground">No finalized payroll yet.</p>
        )}
      </Card>
    </div>
  );
}
