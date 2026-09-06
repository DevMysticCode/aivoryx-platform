'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, CheckCheck } from 'lucide-react';
import { ApiError } from '@/lib/api/client';
import {
  useMarkAllRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from '@/lib/notifications/use-notifications';

const TYPE_DOT: Record<string, string> = {
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  action_required: 'bg-rose-500',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
}

/**
 * Global notification bell (ADR 0037). Unread count polls every 30s; the panel
 * lists recent notifications and deep-links to the relevant page, marking the
 * item read on the way.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const countQuery = useUnreadCount();
  const listQuery = useNotifications(false);
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllRead();

  // hide entirely when unauthenticated / no tenant
  const unauthorized =
    countQuery.error instanceof ApiError &&
    (countQuery.error.status === 401 || countQuery.error.status === 403);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (unauthorized) return null;

  const unread = countQuery.data?.unread ?? 0;
  const items = listQuery.data?.items ?? [];

  const openItem = (id: string, deepLink: string | null, read: boolean) => {
    if (!read) markRead.mutate(id);
    setOpen(false);
    if (deepLink) router.push(deepLink);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Bell className="size-5" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-primary-foreground">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border bg-background shadow-lg sm:w-96">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              type="button"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending || unread === 0}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-40"
            >
              <CheckCheck className="size-3.5" aria-hidden />
              Mark all read
            </button>
          </div>

          <div className="max-h-96 divide-y overflow-y-auto">
            {listQuery.isLoading && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Loading…</p>
            )}
            {!listQuery.isLoading && items.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                You’re all caught up.
              </p>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => openItem(n.id, n.deepLink, n.read)}
                className={`flex w-full gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/60 ${
                  n.read ? 'opacity-70' : ''
                }`}
              >
                <span
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${TYPE_DOT[n.type] ?? 'bg-slate-400'}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{n.body}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {timeAgo(n.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="border-t px-3 py-2 text-center">
            <Link
              href="/settings/notifications"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Notification settings
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
