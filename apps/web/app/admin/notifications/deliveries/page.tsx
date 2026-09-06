'use client';

import { useState } from 'react';
import { ErrorNote, PageHeader, Skeleton } from '@/components/admin/ui';
import { Pager, Select, Table } from '@/components/supply/ui';
import { NotifTabs } from '@/components/admin/notif-tabs';
import { useNotificationDeliveries } from '@/lib/notifications/use-notifications';

const STATUS_STYLE: Record<string, string> = {
  sent: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  pending: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  processing: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  failed: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  cancelled: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
};

function fmt(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

/** Notification delivery history + failures (ADR 0037). Read-only. */
export default function NotificationDeliveriesPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useNotificationDeliveries(status, page);

  const total = q.data?.total ?? 0;
  const pageSize = q.data?.pageSize ?? 25;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Every notification delivery attempt and its outcome."
      />
      <NotifTabs />

      <div className="max-w-48">
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </Select>
      </div>

      {q.isLoading && <Skeleton rows={8} />}
      {q.error && <ErrorNote error={q.error} />}

      {q.data && (
        <>
          <Table
            head={
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Notification</th>
                <th className="px-3 py-2 text-left font-medium">Channel</th>
                <th className="px-3 py-2 text-left font-medium">Recipient</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Detail</th>
              </tr>
            }
          >
            {q.data.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">
                  No deliveries yet.
                </td>
              </tr>
            )}
            {q.data.items.map((d) => (
              <tr key={d.id} className="border-t">
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                  {fmt(d.createdAt)}
                </td>
                <td className="px-3 py-2">
                  <span className="block text-sm">{d.title}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {d.sourceEventType}
                  </span>
                </td>
                <td className="px-3 py-2 text-sm capitalize">{d.channel.replace('_', '-')}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{d.recipientRef}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      STATUS_STYLE[d.status] ?? ''
                    }`}
                  >
                    {d.status}
                  </span>
                  {d.attempts > 1 && (
                    <span className="ml-1 text-[11px] text-muted-foreground">×{d.attempts}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {d.status === 'failed' || d.status === 'cancelled'
                    ? (d.failureMessage ?? d.failureCode ?? '—')
                    : d.provider
                      ? `via ${d.provider}`
                      : '—'}
                </td>
              </tr>
            ))}
          </Table>
          <Pager page={page} totalPages={totalPages} onPage={setPage} />
        </>
      )}
    </div>
  );
}
