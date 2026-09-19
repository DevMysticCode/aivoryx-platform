'use client';

import Link from 'next/link';
import { ApiError } from '@/lib/api/client';
import { useHrMe } from '@/lib/hr/use-hr';
import { Badge } from '@/components/ui/status-badge';
import { WidgetCard, WidgetError, WidgetSkeleton } from './widget-card';

const time = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : null;

/**
 * "My day" — the employee's own attendance + leave, from the self-service
 * endpoint (`/hr/me`), which resolves the employee from the session on the
 * server. Shown to anyone holding `hr.attendance.self` in an HR-entitled
 * workspace: capability-driven, no role names.
 */
export function HrSelfWidget() {
  const q = useHrMe();
  const notLinked = q.error instanceof ApiError && q.error.status === 404;
  const me = q.data;
  const checkedIn = time(me?.todayAttendance?.checkInAt);
  const checkedOut = time(me?.todayAttendance?.checkOutAt);

  return (
    <WidgetCard title="My day" href="/hr/me" linkLabel="My HR">
      {q.isLoading ? (
        <WidgetSkeleton rows={3} />
      ) : notLinked ? (
        <p className="text-sm text-muted-foreground">
          Your account isn&apos;t linked to an employee record yet, so attendance and leave
          aren&apos;t available. Ask HR to link it.
        </p>
      ) : q.error ? (
        <WidgetError onRetry={() => q.refetch()} />
      ) : me ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Today</span>
            {checkedIn ? (
              <span className="flex items-center gap-2">
                <Badge tone={checkedOut ? 'neutral' : 'success'}>
                  {checkedOut ? 'Checked out' : 'Checked in'}
                </Badge>
                <span className="tabular-nums">
                  {checkedIn}
                  {checkedOut ? ` – ${checkedOut}` : ''}
                </span>
              </span>
            ) : (
              <Link href="/hr/me" className="font-medium text-primary hover:underline">
                Not clocked in — clock in
              </Link>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">Leave balance</p>
            {me.leaveBalances.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                No leave types assigned to you yet.
              </p>
            ) : (
              <ul className="mt-1 divide-y divide-border-subtle text-sm">
                {me.leaveBalances.slice(0, 4).map((b) => (
                  <li key={b.leaveTypeId} className="flex items-center justify-between py-1.5">
                    <span>{b.leaveTypeName}</span>
                    <span className="tabular-nums font-medium">{b.balance}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </WidgetCard>
  );
}
