'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { Confirm } from '@/components/ui/kit';
import { useAccess } from '@/lib/navigation/use-access';
import {
  useCreateSource,
  useInboundEvents,
  useReactivateSource,
  useReplayInboundEvent,
  useRevokeSource,
  useRotateSourceSecret,
  useSetSourceCredentials,
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

/**
 * The connector center needs `crm.integrations.manage` — the same capability every API route under
 * `admin/integrations` enforces. The check here only spares a user without it a page of 403s; the
 * API remains the authority.
 */
export default function IntegrationsAdminPage() {
  const access = useAccess();
  if (access.isLoading) return <Skeleton rows={3} />;
  if (!access.can('crm.integrations.manage')) {
    return (
      <section className="space-y-6">
        <PageHeader
          title="Inbound integrations"
          description="Connector sources and inbound events."
        />
        <EmptyState title="You don't have access to integrations">
          Managing inbound connectors needs the &quot;Configure inbound lead connectors&quot;
          permission. Ask a workspace administrator to grant it.
        </EmptyState>
      </section>
    );
  }
  return <IntegrationsAdmin />;
}

const API_BASE = () => process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

/** The universal route for everything; the Pabbly alias remains supported but is no longer the
 *  only path — a signature-style source (Meta) has no bearer secret and uses its publicLookupKey. */
const webhookUrlFor = (source: {
  connectorType: string;
  key: string;
  publicLookupKey: string | null;
}) =>
  source.connectorType === 'pabbly_bridge'
    ? `${API_BASE()}/api/v1/integrations/webhooks/pabbly/${source.key}`
    : `${API_BASE()}/api/v1/integrations/webhooks/${source.publicLookupKey ?? ''}`;

const handshakeUrlFor = (publicLookupKey: string) =>
  `${API_BASE()}/api/v1/integrations/webhooks/${publicLookupKey}/handshake`;

const CONNECTOR_TYPES = [
  { value: 'pabbly_bridge', label: 'Pabbly (generic webhook, bearer secret)' },
  { value: 'meta_lead_ads', label: 'Meta Lead Ads (signature-verified webhook)' },
];

function IntegrationsAdmin() {
  const sources = useSources();
  const events = useInboundEvents();
  const createSource = useCreateSource();
  const rotate = useRotateSourceSecret();
  const revoke = useRevokeSource();
  const reactivate = useReactivateSource();
  const replay = useReplayInboundEvent();
  const setCredentials = useSetSourceCredentials();

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [connectorType, setConnectorType] = useState<'pabbly_bridge' | 'meta_lead_ads'>(
    'pabbly_bridge',
  );
  const [handoff, setHandoff] = useState<{ label: string; secret: string; url: string } | null>(
    null,
  );
  const [sourceAction, setSourceAction] = useState<{
    id: string;
    name: string;
    next: 'revoke' | 'reactivate';
  } | null>(null);
  const [credentialSourceId, setCredentialSourceId] = useState<string | null>(null);
  const [credentialFields, setCredentialFields] = useState({
    appSecret: '',
    pageAccessToken: '',
    verifyToken: '',
  });

  return (
    <section className="space-y-6">
      <PageHeader
        title="Inbound integrations"
        description="Configure the connectors that relay leads into this workspace."
      />

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Connect a source</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await createSource.mutateAsync({ key, name, connectorType });
            setHandoff({
              label: res.source.key,
              secret: res.credential.secret,
              url: webhookUrlFor(res.source),
            });
            if (connectorType !== 'pabbly_bridge') setCredentialSourceId(res.source.id);
            setKey('');
            setName('');
          }}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        >
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Provider</span>
            <select
              value={connectorType}
              onChange={(e) =>
                setConnectorType(e.target.value as 'pabbly_bridge' | 'meta_lead_ads')
              }
              className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm"
            >
              {CONNECTOR_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
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
          <div
            data-testid="connector-handoff"
            className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm"
          >
            <p className="font-medium">Webhook endpoint for &quot;{handoff.label}&quot;</p>
            <code className="block overflow-x-auto rounded border bg-background px-2 py-1.5 font-mono text-xs">
              {handoff.url}
            </code>
            {handoff.secret ? (
              <>
                <p className="text-muted-foreground">
                  Connector secret — shown once. For a bearer-authenticated provider (Pabbly), send
                  it as <code className="font-mono">Authorization: Bearer &lt;secret&gt;</code>. A
                  signature-verified provider (Meta) does not use this; configure its credentials
                  below instead.
                </p>
                <code className="block overflow-x-auto rounded border bg-background px-2 py-1.5 font-mono text-xs">
                  {handoff.secret}
                </code>
              </>
            ) : null}
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
          <ul className="space-y-3 text-sm">
            {sources.data.map((s) => {
              const isSignatureStyle = s.connectorType !== 'pabbly_bridge';
              return (
                <li key={s.id} className="space-y-2 rounded border p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="font-medium">{s.name}</span>{' '}
                      <span className="font-mono text-xs text-muted-foreground">({s.key})</span>{' '}
                      <span className="text-xs text-muted-foreground">
                        ·{' '}
                        {CONNECTOR_TYPES.find((t) => t.value === s.connectorType)?.label ??
                          s.connectorType}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={s.status === 'active' ? 'active' : 'suspended'} />
                      {isSignatureStyle ? (
                        <StatusBadge status={s.hasCredentials ? 'active' : 'suspended'} />
                      ) : null}
                      {!isSignatureStyle ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            const res = await rotate.mutateAsync(s.id);
                            setHandoff({
                              label: s.key,
                              secret: res.credential.secret,
                              url: webhookUrlFor(res.source),
                            });
                          }}
                        >
                          Rotate secret
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCredentialSourceId(s.id);
                            setCredentialFields({
                              appSecret: '',
                              pageAccessToken: '',
                              verifyToken: '',
                            });
                          }}
                        >
                          {s.hasCredentials ? 'Update credentials' : 'Configure credentials'}
                        </Button>
                      )}
                      {s.status === 'active' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={revoke.isPending}
                          onClick={() =>
                            setSourceAction({ id: s.id, name: s.name, next: 'revoke' })
                          }
                        >
                          Revoke
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={reactivate.isPending}
                          onClick={() =>
                            setSourceAction({ id: s.id, name: s.name, next: 'reactivate' })
                          }
                        >
                          Reactivate
                        </Button>
                      )}
                    </div>
                  </div>

                  <code className="block overflow-x-auto rounded border bg-background px-2 py-1 font-mono text-xs text-muted-foreground">
                    {webhookUrlFor(s)}
                  </code>
                  {isSignatureStyle ? (
                    <p className="text-xs text-muted-foreground">
                      Subscription verification URL:{' '}
                      <code className="font-mono">{handshakeUrlFor(s.publicLookupKey ?? '')}</code>
                    </p>
                  ) : null}

                  {credentialSourceId === s.id ? (
                    <form
                      className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const data = Object.fromEntries(
                          Object.entries(credentialFields).filter(([, v]) => v.trim().length > 0),
                        );
                        await setCredentials.mutateAsync({ sourceId: s.id, data });
                        setCredentialSourceId(null);
                      }}
                    >
                      <p className="text-xs text-muted-foreground">
                        Replaces the entire credential set for this source. Values are never shown
                        again after saving.
                      </p>
                      <Field
                        label="App secret"
                        type="password"
                        value={credentialFields.appSecret}
                        onChange={(e) =>
                          setCredentialFields((f) => ({ ...f, appSecret: e.target.value }))
                        }
                      />
                      <Field
                        label="Page access token"
                        type="password"
                        value={credentialFields.pageAccessToken}
                        onChange={(e) =>
                          setCredentialFields((f) => ({ ...f, pageAccessToken: e.target.value }))
                        }
                      />
                      <Field
                        label="Subscription verify token"
                        value={credentialFields.verifyToken}
                        onChange={(e) =>
                          setCredentialFields((f) => ({ ...f, verifyToken: e.target.value }))
                        }
                      />
                      <ErrorNote error={setCredentials.error} />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" disabled={setCredentials.isPending}>
                          {setCredentials.isPending ? 'Saving…' : 'Save credentials'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setCredentialSourceId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : null}
                </li>
              );
            })}
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
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState>No inbound events yet.</EmptyState>
        )}
        <ErrorNote error={replay.error} />
      </Card>

      <Confirm
        open={!!sourceAction}
        onClose={() => setSourceAction(null)}
        onConfirm={async () => {
          if (!sourceAction) return;
          if (sourceAction.next === 'revoke') await revoke.mutateAsync(sourceAction.id);
          else await reactivate.mutateAsync(sourceAction.id);
          setSourceAction(null);
        }}
        title={
          sourceAction?.next === 'revoke'
            ? `Revoke "${sourceAction.name}"?`
            : `Reactivate "${sourceAction?.name}"?`
        }
        body={
          sourceAction?.next === 'revoke'
            ? 'This source will immediately stop accepting inbound events. You can reactivate it later.'
            : 'This source will start accepting inbound events again.'
        }
        confirmLabel={sourceAction?.next === 'revoke' ? 'Revoke' : 'Reactivate'}
        danger={sourceAction?.next === 'revoke'}
        pending={revoke.isPending || reactivate.isPending}
      />
    </section>
  );
}
