'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@aivoryx/ui';
import type { ProviderMeta, Source } from '@aivoryx/contracts';
import { useAccess } from '@/lib/navigation/use-access';
import {
  useProviders,
  useReactivateSource,
  useRevokeSource,
  useRotateSourceSecret,
  useSetSourceCredentials,
  useSource,
  useUpdateSource,
} from '@/lib/admin/use-integrations';
import { handshakeUrlFor, webhookUrlFor } from '@/lib/admin/integration-urls';
import { buildSnippets } from '@/lib/admin/integration-snippets';
import { Card, EmptyState, ErrorNote, Field, PageHeader, StatusBadge } from '@/components/admin/ui';
import { Confirm, ErrorBlock, LoadingBlock } from '@/components/ui/kit';
import { TabBar } from '@/components/ui/tab-bar';
import { CodeSnippet } from '@/components/admin/code-snippet';
import { MappingEditor } from '@/components/admin/mapping-editor';
import { ProviderCredentialForm } from '@/components/admin/provider-credential-form';
import { IntegrationEventsTable } from '@/components/admin/integration-events-table';

const TABS = ['Overview', 'Configuration', 'Mapping', 'Events', 'Developer'] as const;
type Tab = (typeof TABS)[number];

export default function SourceDetailPage() {
  const access = useAccess();
  if (access.isLoading) return <LoadingBlock />;
  if (!access.can('crm.integrations.manage')) {
    return (
      <EmptyState title="You don't have access to integrations">
        Managing inbound connectors needs the &quot;Configure inbound lead connectors&quot;
        permission. Ask a workspace administrator to grant it.
      </EmptyState>
    );
  }
  return <SourceDetail />;
}

function SourceDetail() {
  const { id } = useParams<{ id: string }>();
  const source = useSource(id);
  const providers = useProviders();
  const [tab, setTab] = useState<Tab>('Overview');
  const [revokeAction, setRevokeAction] = useState<'revoke' | 'reactivate' | null>(null);

  const revoke = useRevokeSource();
  const reactivate = useReactivateSource();

  if (source.isLoading) return <LoadingBlock />;
  if (source.error) return <ErrorBlock error={source.error} onRetry={() => source.refetch()} />;
  if (!source.data) return null;

  const s = source.data;
  const provider = providers.data?.find((p) => p.provider === s.connectorType);
  const isSignatureStyle = provider?.authMethod === 'signature';

  return (
    <section className="space-y-5">
      <Link
        href="/admin/integrations"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Connections
      </Link>

      <PageHeader
        title={s.name}
        description={`${provider?.displayName ?? s.connectorType} · ${s.key}`}
      >
        <StatusBadge status={s.status === 'active' ? 'active' : 'suspended'} />
        {s.status === 'active' ? (
          <Button size="sm" variant="ghost" onClick={() => setRevokeAction('revoke')}>
            Revoke
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setRevokeAction('reactivate')}>
            Reactivate
          </Button>
        )}
      </PageHeader>

      <TabBar tabs={TABS.map((t) => ({ key: t, label: t }))} active={tab} onChange={setTab} />

      {tab === 'Overview' ? <OverviewTab source={s} provider={provider} /> : null}
      {tab === 'Configuration' ? (
        <ConfigurationTab source={s} provider={provider} isSignatureStyle={isSignatureStyle} />
      ) : null}
      {tab === 'Mapping' ? <MappingTab source={s} /> : null}
      {tab === 'Events' ? <IntegrationEventsTable fixedSourceId={s.id} /> : null}
      {tab === 'Developer' ? (
        <DeveloperTab source={s} authMethod={provider?.authMethod ?? 'bearer_secret'} />
      ) : null}

      <Confirm
        open={!!revokeAction}
        onClose={() => setRevokeAction(null)}
        onConfirm={async () => {
          if (revokeAction === 'revoke') await revoke.mutateAsync(s.id);
          else if (revokeAction === 'reactivate') await reactivate.mutateAsync(s.id);
          setRevokeAction(null);
        }}
        title={revokeAction === 'revoke' ? `Revoke "${s.name}"?` : `Reactivate "${s.name}"?`}
        body={
          revokeAction === 'revoke'
            ? 'This connection will immediately stop accepting inbound events. You can reactivate it later.'
            : 'This connection will start accepting inbound events again.'
        }
        confirmLabel={revokeAction === 'revoke' ? 'Revoke' : 'Reactivate'}
        danger={revokeAction === 'revoke'}
        pending={revoke.isPending || reactivate.isPending}
      />
    </section>
  );
}

/** Only ever shows information the backend actually provides — no fabricated health score,
 *  success rate, event count or last-seen time (UC-4 explicit requirement). */
function OverviewTab({ source, provider }: { source: Source; provider: ProviderMeta | undefined }) {
  return (
    <Card className="grid gap-3 text-sm sm:grid-cols-2">
      <Row label="Provider">{provider?.displayName ?? source.connectorType}</Row>
      <Row label="Authentication">
        {provider?.authMethod === 'signature' ? 'Provider signature' : 'Bearer secret'}
      </Row>
      <Row label="Status">
        <StatusBadge status={source.status === 'active' ? 'active' : 'suspended'} />
      </Row>
      <Row label="Credentials configured">
        {provider && provider.credentialFields.length > 0 ? (
          <StatusBadge status={source.hasCredentials ? 'active' : 'suspended'} />
        ) : (
          <span className="text-muted-foreground">Not applicable for this provider</span>
        )}
      </Row>
      <Row label="Created">{new Date(source.createdAt).toLocaleString()}</Row>
      <Row label="Last updated">{new Date(source.updatedAt).toLocaleString()}</Row>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ConfigurationTab({
  source,
  provider,
  isSignatureStyle,
}: {
  source: Source;
  provider: ProviderMeta | undefined;
  isSignatureStyle: boolean;
}) {
  const update = useUpdateSource();
  const rotate = useRotateSourceSecret();
  const setCredentials = useSetSourceCredentials();
  const [name, setName] = useState(source.name);
  const [rotated, setRotated] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Name</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ sourceId: source.id, body: { name } });
          }}
        >
          <Field label="" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" size="sm" disabled={update.isPending || name === source.name}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
        </form>
        <ErrorNote error={update.error} />
        <p className="text-xs text-muted-foreground">
          The connection key (<code className="font-mono">{source.key}</code>) and provider (
          {provider?.displayName ?? source.connectorType}) are immutable.
        </p>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold">Webhook</h2>
        <code className="block overflow-x-auto rounded border bg-background px-2 py-1.5 font-mono text-xs">
          {webhookUrlFor(source)}
        </code>
        {isSignatureStyle && source.publicLookupKey ? (
          <p className="text-xs text-muted-foreground">
            Subscription verification URL:{' '}
            <code className="font-mono">{handshakeUrlFor(source.publicLookupKey)}</code>
          </p>
        ) : null}
        {!isSignatureStyle ? (
          <div className="space-y-2">
            <Button
              size="sm"
              variant="outline"
              disabled={rotate.isPending}
              onClick={async () => {
                const res = await rotate.mutateAsync(source.id);
                setRotated(res.credential.secret);
              }}
            >
              {rotate.isPending ? 'Rotating…' : 'Rotate secret'}
            </Button>
            {rotated ? (
              <div className="space-y-1 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
                <p className="text-muted-foreground">New secret — shown once.</p>
                <code className="block overflow-x-auto rounded border bg-background px-2 py-1.5 font-mono text-xs">
                  {rotated}
                </code>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      {provider && provider.credentialFields.length > 0 ? (
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Credentials</h2>
          <ProviderCredentialForm
            fields={provider.credentialFields}
            pending={setCredentials.isPending}
            onSubmit={(data) => setCredentials.mutate({ sourceId: source.id, data })}
          />
          <ErrorNote error={setCredentials.error} />
        </Card>
      ) : null}
    </div>
  );
}

function MappingTab({ source }: { source: Source }) {
  const update = useUpdateSource();
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Field mapping</h2>
      <MappingEditor
        value={source.fieldMapping}
        pending={update.isPending}
        onSave={(fieldMapping) => update.mutate({ sourceId: source.id, body: { fieldMapping } })}
      />
      <ErrorNote error={update.error} />
    </Card>
  );
}

function DeveloperTab({
  source,
  authMethod,
}: {
  source: Source;
  authMethod: 'bearer_secret' | 'signature';
}) {
  const snippets = buildSnippets({ ...source, authMethod });
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Code samples</h2>
      <p className="text-xs text-muted-foreground">
        Use this secret server-side. Never expose it in browser/client-side code. Replace{' '}
        <code className="font-mono">&lt;YOUR_SECRET&gt;</code> with the value shown when you created
        or last rotated the connection.
      </p>
      <CodeSnippet snippets={snippets} />
    </Card>
  );
}
