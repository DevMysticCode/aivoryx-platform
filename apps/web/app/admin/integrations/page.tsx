'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import {
  useCreateSource,
  useInboundEvents,
  useReactivateSource,
  useReplayInboundEvent,
  useRevokeSource,
  useRotateSourceSecret,
  useSources,
} from '@/lib/admin/use-integrations';
import {
  Card,
  EmptyState,
  ErrorNote,
  Field,
  PageHeader,
  Skeleton,
  StatusBadge,
} from '@/components/admin/ui';

export default function IntegrationsAdminPage() {
  const sources = useSources();
  const events = useInboundEvents();
  const createSource = useCreateSource();
  const rotate = useRotateSourceSecret();
  const revoke = useRevokeSource();
  const reactivate = useReactivateSource();
  const replay = useReplayInboundEvent();

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [handoff, setHandoff] = useState<{ label: string; secret: string; url: string } | null>(
    null,
  );

  const webhookUrl = (sourceKey: string) =>
    typeof window !== 'undefined'
      ? `${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/v1/integrations/webhooks/pabbly/${sourceKey}`
      : sourceKey;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Inbound integrations"
        description="Configure the Pabbly connector that relays leads into this workspace."
      />

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Connect a source</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await createSource.mutateAsync({ key, name });
            setHandoff({
              label: res.source.key,
              secret: res.credential.secret,
              url: webhookUrl(res.source.key),
            });
            setKey('');
            setName('');
          }}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <Field
            label="Source key"
            placeholder="website-pabbly"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
          />
          <Field
            label="Name"
            placeholder="Website form"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Button type="submit" disabled={createSource.isPending}>
            {createSource.isPending ? 'Creating…' : 'Create source'}
          </Button>
        </form>
        <ErrorNote error={createSource.error} />
        {handoff ? (
          <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
            <p className="font-medium">Connector secret for &quot;{handoff.label}&quot;</p>
            <p className="text-muted-foreground">
              Shown once. Configure Pabbly to POST to this URL with header{' '}
              <code className="font-mono">Authorization: Bearer &lt;secret&gt;</code>.
            </p>
            <code className="block overflow-x-auto rounded border bg-background px-2 py-1.5 font-mono text-xs">
              {handoff.url}
            </code>
            <code className="block overflow-x-auto rounded border bg-background px-2 py-1.5 font-mono text-xs">
              {handoff.secret}
            </code>
            <Button size="sm" variant="ghost" onClick={() => setHandoff(null)}>
              Dismiss
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Configured sources</h2>
        {sources.isLoading ? (
          <Skeleton rows={2} />
        ) : sources.error ? (
          <ErrorNote error={sources.error} />
        ) : sources.data && sources.data.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {sources.data.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
              >
                <div>
                  <span className="font-medium">{s.name}</span>{' '}
                  <span className="font-mono text-xs text-muted-foreground">({s.key})</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={s.status === 'active' ? 'active' : 'suspended'} />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      const res = await rotate.mutateAsync(s.id);
                      setHandoff({
                        label: s.key,
                        secret: res.credential.secret,
                        url: webhookUrl(s.key),
                      });
                    }}
                  >
                    Rotate secret
                  </Button>
                  {s.status === 'active' ? (
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                      Revoke
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => reactivate.mutate(s.id)}>
                      Reactivate
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No sources configured yet.</EmptyState>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Recent inbound events</h2>
        {events.isLoading ? (
          <Skeleton rows={3} />
        ) : events.error ? (
          <ErrorNote error={events.error} />
        ) : events.data && events.data.length > 0 ? (
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
                {events.data.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2">
                      <StatusBadge
                        status={
                          e.status === 'DONE'
                            ? 'active'
                            : e.status === 'PROCESSING'
                              ? 'invited'
                              : 'suspended'
                        }
                      />
                      <span className="ml-2 text-xs text-muted-foreground">{e.status}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {e.dedupeOutcome ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {e.processingAttempts}
                    </td>
                    <td className="px-3 py-2 text-xs text-destructive">
                      {e.lastErrorMessage ?? ''}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <Button size="sm" variant="outline" onClick={() => replay.mutate(e.id)}>
                        Replay
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>No inbound events yet.</EmptyState>
        )}
        <ErrorNote error={replay.error} />
      </Card>
    </section>
  );
}
