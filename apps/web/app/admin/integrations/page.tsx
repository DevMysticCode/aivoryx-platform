'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button, cn } from '@aivoryx/ui';
import type { CreateSourceRequest } from '@aivoryx/contracts';
import { useAccess } from '@/lib/navigation/use-access';
import { useCreateSource, useProviders, useSources } from '@/lib/admin/use-integrations';
import { webhookUrlFor } from '@/lib/admin/integration-urls';
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
 * The Integration Center needs `crm.integrations.manage` — the same capability every API route
 * under `admin/integrations` enforces. The check here only spares a user without it a page of
 * 403s; the API remains the authority.
 */
export default function IntegrationsAdminPage() {
  const access = useAccess();
  if (access.isLoading) return <Skeleton rows={3} />;
  if (!access.can('crm.integrations.manage')) {
    return (
      <section className="space-y-6">
        <PageHeader
          title="Integrations"
          description="Connections that relay leads into this workspace, and their inbound events."
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

/** Top-level section switch (Connections | Events) — real routes, not tabs, following the same
 *  pattern as `/admin/notifications`'s `NotifTabs`. No registry/sidebar change: both routes are
 *  reached from inside this one module entry point. */
function TopTabs() {
  const pathname = usePathname();
  const tabs = [
    { href: '/admin/integrations', label: 'Connections' },
    { href: '/admin/integrations/events', label: 'Events' },
  ];
  return (
    <div className="flex gap-1 border-b">
      {tabs.map((t) => {
        const current = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              current
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

function IntegrationsAdmin() {
  const sources = useSources();
  const providers = useProviders();
  const createSource = useCreateSource();

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [connectorType, setConnectorType] = useState('pabbly_bridge');
  const [handoff, setHandoff] = useState<{ label: string; secret: string; url: string } | null>(
    null,
  );

  const providerOptions = providers.data ?? [];
  const providerLabel = (type: string) =>
    providerOptions.find((p) => p.provider === type)?.displayName ?? type;

  return (
    <section className="space-y-6">
      <PageHeader
        title="Integrations"
        description="Connections that relay leads into this workspace, and their inbound events."
      />
      <TopTabs />

      <Card className="space-y-4">
        <h2 className="text-sm font-semibold">Connect a source</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await createSource.mutateAsync({
              key,
              name,
              connectorType: connectorType as CreateSourceRequest['connectorType'],
            });
            setHandoff({
              label: res.source.key,
              secret: res.credential.secret,
              url: webhookUrlFor(res.source),
            });
            setKey('');
            setName('');
          }}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        >
          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">Provider</span>
            <select
              value={connectorType}
              onChange={(e) => setConnectorType(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm"
            >
              {providerOptions.length > 0
                ? providerOptions.map((p) => (
                    <option key={p.provider} value={p.provider}>
                      {p.displayName}
                    </option>
                  ))
                : [{ provider: 'pabbly_bridge', displayName: 'Pabbly' }].map((p) => (
                    <option key={p.provider} value={p.provider}>
                      {p.displayName}
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
                  Connector secret — shown once. For a bearer-authenticated provider, send it as{' '}
                  <code className="font-mono">Authorization: Bearer &lt;secret&gt;</code>. A
                  signature-verified provider does not use this; configure its credentials from the
                  connection&apos;s Configuration tab instead.
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
        <h2 className="text-sm font-semibold">Connections</h2>
        {sources.isLoading ? (
          <Skeleton rows={2} />
        ) : sources.error ? (
          <ErrorNote error={sources.error} />
        ) : sources.data && sources.data.length > 0 ? (
          <ul className="space-y-2 text-sm">
            {sources.data.map((s) => (
              <li key={s.id}>
                <Link
                  href={`/admin/integrations/sources/${s.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 transition-colors hover:bg-surface-hover"
                >
                  <div>
                    <span className="font-medium">{s.name}</span>{' '}
                    <span className="font-mono text-xs text-muted-foreground">({s.key})</span>{' '}
                    <span className="text-xs text-muted-foreground">
                      · {providerLabel(s.connectorType)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={s.status === 'active' ? 'active' : 'suspended'} />
                    {s.connectorType !== 'pabbly_bridge' ? (
                      <StatusBadge status={s.hasCredentials ? 'active' : 'suspended'} />
                    ) : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState>No sources configured yet.</EmptyState>
        )}
      </Card>
    </section>
  );
}
