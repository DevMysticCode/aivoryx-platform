'use client';

import { PageHeader, Skeleton, Card, EmptyState, ErrorNote } from '@/components/admin/ui';
import { Table } from '@/components/supply/ui';
import { HrStatusBadge, DefRow, money, fmtDate } from '@/components/hr/ui';
import * as hrApi from '@/lib/api/hr';
import {
  useHrMe,
  useMyLeaveRequests,
  useMyExpenseClaims,
  useMyPayrollHistory,
  useCheckIn,
  useCheckOut,
  useMyDocuments,
  useMyPerformanceReviews,
  useReviewActions,
} from '@/lib/hr/use-hr';
import { ErrorBlock } from '@/components/ui/kit';
import { ApiError } from '@/lib/api/client';
import { usePermissions } from '@/components/supply/supply-shell';
import type { HrPerformanceReview } from '@aivoryx/contracts';

function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ReviewRow({ review, canAck }: { review: HrPerformanceReview; canAck: boolean }) {
  const { acknowledge } = useReviewActions(review.id);
  return (
    <li className="min-w-0 space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-medium">{review.periodName}</span>
          <HrStatusBadge status={review.status} />
          {review.overallRating != null && (
            <span className="text-sm text-muted-foreground">Rating: {review.overallRating}</span>
          )}
        </div>
        {review.status === 'SUBMITTED' && canAck && (
          <button
            type="button"
            onClick={() => acknowledge.mutate()}
            disabled={acknowledge.isPending}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {acknowledge.isPending ? 'Acknowledging…' : 'Acknowledge'}
          </button>
        )}
      </div>
      {review.managerComments && (
        <p className="break-words text-sm">
          <span className="text-muted-foreground">Manager: </span>
          {review.managerComments}
        </p>
      )}
      {review.employeeComments && (
        <p className="break-words text-sm">
          <span className="text-muted-foreground">Your comments: </span>
          {review.employeeComments}
        </p>
      )}
      <ErrorNote error={acknowledge.error} />
    </li>
  );
}

/** Employee self-service. Identity is resolved server-side from the session. */
export default function MyHrPage() {
  const me = useHrMe();
  const leave = useMyLeaveRequests();
  const expenses = useMyExpenseClaims();
  const payroll = useMyPayrollHistory();
  const docs = useMyDocuments();
  const reviews = useMyPerformanceReviews();
  const checkIn = useCheckIn();
  const checkOut = useCheckOut();
  const canSelf = usePermissions().includes('hr.attendance.self');

  if (me.isLoading) return <Skeleton rows={5} />;
  if (me.error) {
    const notLinked = me.error instanceof ApiError && me.error.code === 'HR_EMPLOYEE_NOT_LINKED';
    return (
      <div className="space-y-4">
        <PageHeader title="My HR" description="Your own profile, leave, expenses and payslips." />
        {notLinked ? (
          <EmptyState>
            Your account isn&apos;t linked to an employee record yet. Ask HR to link it — until
            then, personal HR features aren&apos;t available.
          </EmptyState>
        ) : (
          <ErrorBlock error={me.error} onRetry={() => me.refetch()} />
        )}
      </div>
    );
  }
  if (!me.data) return null;
  const e = me.data.employee;
  const today = me.data.todayAttendance;

  return (
    <div className="space-y-6">
      <PageHeader title="My HR" description={`${e.displayName} · ${e.employeeNumber}`}>
        <HrStatusBadge status={e.status} />
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Profile</h2>
          <DefRow label="Department">{e.department ?? '—'}</DefRow>
          <DefRow label="Designation">{e.designation ?? '—'}</DefRow>
          <DefRow label="Manager">{e.managerName ?? '—'}</DefRow>
          <DefRow label="Work location">{e.workLocation ?? '—'}</DefRow>
          <DefRow label="Joined">{fmtDate(e.joiningDate)}</DefRow>
        </Card>
        <Card>
          <h2 className="mb-2 text-sm font-semibold">Today</h2>
          {today ? (
            <>
              <DefRow label="Status">
                <HrStatusBadge status={today.status} />
              </DefRow>
              <DefRow label="Checked in">{fmtTime(today.checkInAt)}</DefRow>
              <DefRow label="Checked out">{fmtTime(today.checkOutAt)}</DefRow>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No attendance recorded today.</p>
          )}
          {canSelf && (
            <div className="mt-3 space-y-2">
              {!today ? (
                <button
                  type="button"
                  onClick={() => checkIn.mutate({})}
                  disabled={checkIn.isPending}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {checkIn.isPending ? 'Checking in…' : 'Check in'}
                </button>
              ) : !today.checkOutAt ? (
                <button
                  type="button"
                  onClick={() => checkOut.mutate({})}
                  disabled={checkOut.isPending}
                  className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                >
                  {checkOut.isPending ? 'Checking out…' : 'Check out'}
                </button>
              ) : (
                <p className="text-sm font-medium text-success">Done for today</p>
              )}
              <ErrorNote error={checkIn.error} />
              <ErrorNote error={checkOut.error} />
            </div>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Leave balances</h2>
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
                No leave balances yet.
              </td>
            </tr>
          )}
        </Table>
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">My leave requests</h2>
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
          <EmptyState>No leave requests yet.</EmptyState>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">My expense claims</h2>
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
          <EmptyState>No expense claims yet.</EmptyState>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Payslips</h2>
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
          <EmptyState>No finalized payroll yet.</EmptyState>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">My documents</h2>
        {docs.isLoading ? (
          <Skeleton rows={2} />
        ) : docs.error ? (
          <ErrorBlock error={docs.error} onRetry={() => docs.refetch()} />
        ) : docs.data && docs.data.length > 0 ? (
          <Table
            head={
              <tr>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Added</th>
                <th className="px-3 py-2" />
              </tr>
            }
          >
            {docs.data.map((d) => (
              <tr key={d.id}>
                <td className="px-3 py-2">{d.title}</td>
                <td className="px-3 py-2 capitalize">{d.kind.replace(/_/g, ' ').toLowerCase()}</td>
                <td className="px-3 py-2 tabular-nums">{fmtSize(d.sizeBytes)}</td>
                <td className="px-3 py-2">{fmtDate(d.createdAt)}</td>
                <td className="px-3 py-2 text-right">
                  <a
                    href={hrApi.myDocumentUrl(d.id)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-primary hover:underline"
                  >
                    Download<span className="sr-only"> {d.title}</span>
                  </a>
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <EmptyState>HR hasn&apos;t shared any documents with you yet.</EmptyState>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-sm font-semibold">Performance reviews</h2>
        {reviews.isLoading ? (
          <Skeleton rows={2} />
        ) : reviews.error ? (
          <ErrorBlock error={reviews.error} onRetry={() => reviews.refetch()} />
        ) : reviews.data && reviews.data.length > 0 ? (
          <ul className="divide-y">
            {reviews.data.map((r) => (
              <ReviewRow key={r.id} review={r} canAck={canSelf} />
            ))}
          </ul>
        ) : (
          <EmptyState>No performance reviews have been shared with you yet.</EmptyState>
        )}
      </Card>
    </div>
  );
}
