'use client';

import { Fragment, useState } from 'react';
import { Button } from '@aivoryx/ui';
import {
  useInboundEvent,
  useInboundEvents,
  useReplayInboundEvent,
} from '@/lib/admin/use-integrations';
import { Card, EmptyState, ErrorNote, Skeleton, StatusBadge } from '@/components/admin/ui';

/** Canonical event statuses the backend can actually produce today (`mapping.ts`/
 *  `ingestion.service.ts`) — `NEEDS_REVIEW`/`DEAD_LETTER` exist in the DB enum but are never
 *  written yet, so they're deliberately left out of this filter rather than offered as a dead
 *  option. */
const STATUS_OPTIONS = [
  'RECEIVED',
  'PROCESSING',
  'VALIDATION_FAILED',
  'MAPPING_FAILED',
  'DONE',
  'FAILED',
];

const badgeTone = (status: string) =>
  status === 'DONE'
    ? 'active'
    : status === 'PROCESSING' || status === 'RECEIVED'
      ? 'invited'
      : 'suspended';

/**
 * Paginated, filterable inbound-event table (UC-4) — shared by the standalone Events page
 * (`/admin/integrations/events`, every source) and a connection detail page's Events tab (one
 * source, `fixedSourceId`). Server-side pagination only; never fetches an unbounded list.
 */
export function IntegrationEventsTable({
  fixedSourceId,
  sources,
}: {
  /** when set, the source filter is hidden and locked to this id (connection detail's Events tab) */
  fixedSourceId?: string;
  /** source id -> display label, for the (optional) source filter dropdown */
  sources?: { id: string; name: string }[];
}) {
  const [sourceId, setSourceId] = useState(fixedSourceId ?? '');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [expanded, setExpanded] = useState<string | null>(null);

  const events = useInboundEvents({
    sourceId: sourceId || undefined,
    status: status || undefined,
    page,
    pageSize,
  });
  const replay = useReplayInboundEvent();

  const totalPages = events.data ? Math.max(1, Math.ceil(events.data.total / pageSize)) : 1;

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-sm font-semibold">Inbound events</h2>
        <div className="flex flex-wrap items-end gap-2">
          {!fixedSourceId && sources ? (
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-muted-foreground">Connection</span>
              <select
                value={sourceId}
                onChange={(e) => {
                  setSourceId(e.target.value);
                  setPage(1);
                }}
                className="h-8 rounded-md border border-input bg-surface px-2 text-sm"
              >
                <option value="">All connections</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted-foreground">Status</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className="h-8 rounded-md border border-input bg-surface px-2 text-sm"
            >
              <option value="">Any status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {events.isLoading ? (
        <Skeleton rows={3} />
      ) : events.error ? (
        <ErrorNote error={events.error} />
      ) : events.data && events.data.items.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-secondary/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Dedupe</th>
                  <th className="px-3 py-2 font-medium">Attempts</th>
                  <th className="px-3 py-2 font-medium">Error</th>
                  <th className="px-3 py-2 font-medium">Received</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {events.data.items.map((e) => (
                  <Fragment key={e.id}>
                    <tr>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                          className="inline-flex items-center gap-2 hover:underline"
                        >
                          <StatusBadge status={badgeTone(e.status)} />
                          <span className="text-xs text-muted-foreground">{e.status}</span>
                        </button>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {e.dedupeOutcome ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {e.processingAttempts}
                      </td>
                      <td className="px-3 py-2 text-xs text-danger">{e.lastErrorMessage ?? ''}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={replay.isPending}
                          onClick={() => replay.mutate(e.id)}
                        >
                          {replay.isPending ? 'Replaying…' : 'Replay'}
                        </Button>
                      </td>
                    </tr>
                    {expanded === e.id ? (
                      <tr>
                        <td colSpan={6} className="bg-secondary/10 px-3 py-3">
                          <EventDetailPanel id={e.id} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {events.data.total} event{events.data.total === 1 ? '' : 's'} · page {page} of{' '}
              {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      ) : (
        <EmptyState>No inbound events yet.</EmptyState>
      )}
      <ErrorNote error={replay.error} />
    </Card>
  );
}

/** Raw payload is collapsed by default (may contain PII) behind an explicit action. Never
 *  renders a credential/secret — the backend never includes one in this response either. */
function EventDetailPanel({ id }: { id: string }) {
  const detail = useInboundEvent(id);
  const [showRaw, setShowRaw] = useState(false);

  if (detail.isLoading) return <Skeleton rows={2} />;
  if (detail.error) return <ErrorNote error={detail.error} />;
  if (!detail.data) return null;

  const { event, raw, log } = detail.data;
  return (
    <div className="space-y-3 text-xs">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <p className="font-medium text-foreground">Canonical fields</p>
          <pre className="mt-1 overflow-x-auto rounded border bg-background p-2">
            {JSON.stringify(event.canonical, null, 2)}
          </pre>
        </div>
        <div>
          <p className="font-medium text-foreground">Unmapped fields</p>
          <pre className="mt-1 overflow-x-auto rounded border bg-background p-2">
            {JSON.stringify(event.unmapped, null, 2)}
          </pre>
        </div>
      </div>

      <div>
        <p className="font-medium text-foreground">Processing log</p>
        <ul className="mt-1 space-y-1">
          {log.map((entry) => (
            <li key={entry.id} className="text-muted-foreground">
              {entry.stage}: {entry.fromStatus ?? '—'} → {entry.toStatus ?? '—'}
              {entry.errorCode ? ` (${entry.errorCode})` : ''}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <Button type="button" size="sm" variant="ghost" onClick={() => setShowRaw((v) => !v)}>
          {showRaw ? 'Hide raw payload' : 'View raw payload'}
        </Button>
        {showRaw ? (
          <>
            <p className="mt-1 text-muted-foreground">
              The raw payload is exactly what the provider sent and may contain personal data (PII).
            </p>
            <pre className="mt-1 max-h-64 overflow-auto rounded border bg-background p-2">
              {JSON.stringify(raw?.rawBody ?? null, null, 2)}
            </pre>
          </>
        ) : null}
      </div>
    </div>
  );
}
