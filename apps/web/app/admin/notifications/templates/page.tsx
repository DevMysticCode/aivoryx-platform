'use client';

import { useState } from 'react';
import type { NotificationTemplate } from '@aivoryx/contracts';
import { ErrorNote, PageHeader, Skeleton } from '@/components/admin/ui';
import { NotifTabs } from '@/components/admin/notif-tabs';
import {
  useNotificationTemplates,
  useResetNotificationTemplate,
  useUpdateNotificationTemplate,
} from '@/lib/notifications/use-notifications';

/**
 * Notification templates (ADR 0037). Plain-text bodies with safe `{{ variable }}`
 * interpolation — no HTML authoring, no executable code. A tenant override can
 * be reset to the system default.
 */
export default function NotificationTemplatesPage() {
  const templates = useNotificationTemplates();
  const [openKey, setOpenKey] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Wording for each notification. Use {{ variables }} — they are filled in safely at send time."
      />
      <NotifTabs />

      {templates.isLoading && <Skeleton rows={6} />}
      {templates.error && <ErrorNote error={templates.error} />}

      <div className="space-y-2">
        {(templates.data ?? []).map((tpl) => (
          <div key={tpl.key} className="rounded-lg border bg-card">
            <button
              type="button"
              onClick={() => setOpenKey((k) => (k === tpl.key ? null : tpl.key))}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {tpl.channels[0]?.title ?? tpl.key}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{tpl.key}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {tpl.overridden ? 'customised' : 'default'}
              </span>
            </button>
            {openKey === tpl.key && <TemplateEditor template={tpl} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function TemplateEditor({ template }: { template: NotificationTemplate }) {
  const inApp = template.channels.find((c) => c.channel === 'in_app') ?? template.channels[0]!;
  const email = template.channels.find((c) => c.channel === 'email');

  const [title, setTitle] = useState(inApp.title);
  const [body, setBody] = useState(inApp.body);
  const [emailSubject, setEmailSubject] = useState(email?.emailSubject ?? '');
  const [emailBody, setEmailBody] = useState(email?.emailBody ?? '');

  const save = useUpdateNotificationTemplate();
  const reset = useResetNotificationTemplate();

  return (
    <div className="space-y-3 border-t px-4 py-4">
      <p className="text-xs text-muted-foreground">
        Available variables:{' '}
        {template.variables.map((v) => (
          <code
            key={v}
            className="mr-1 rounded bg-secondary px-1 py-0.5 text-[11px]"
          >{`{{${v}}}`}</code>
        ))}
      </p>

      <Labeled label="Title / in-app heading">
        <input
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Labeled>
      <Labeled label="In-app body">
        <textarea
          className="min-h-16 w-full rounded-md border px-3 py-2 text-sm"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </Labeled>
      <Labeled label="Email subject">
        <input
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={emailSubject}
          onChange={(e) => setEmailSubject(e.target.value)}
        />
      </Labeled>
      <Labeled label="Email body (plain text)">
        <textarea
          className="min-h-24 w-full rounded-md border px-3 py-2 text-sm"
          value={emailBody}
          onChange={(e) => setEmailBody(e.target.value)}
        />
      </Labeled>

      {(save.error || reset.error) && <ErrorNote error={save.error ?? reset.error} />}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({ key: template.key, body: { title, body, emailSubject, emailBody } })
          }
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {template.overridden && (
          <button
            type="button"
            disabled={reset.isPending}
            onClick={() => reset.mutate(template.key)}
            className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Reset to default
          </button>
        )}
      </div>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
