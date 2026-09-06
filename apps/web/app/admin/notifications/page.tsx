'use client';

import { ErrorNote, PageHeader, Skeleton } from '@/components/admin/ui';
import { NotifTabs } from '@/components/admin/notif-tabs';
import type { UpdateNotificationRuleRequest } from '@aivoryx/contracts';
import {
  useNotificationRules,
  useUpdateNotificationRule,
} from '@/lib/notifications/use-notifications';

type Channels = UpdateNotificationRuleRequest['channels'];

const STRATEGY_LABEL: Record<string, string> = {
  USER: 'Specific user',
  ACTOR: 'Whoever triggered it',
  ASSIGNED_USER: 'Assigned user',
  ROLE: 'Role',
  CUSTOMER: 'Customer (email)',
};

const TYPE_BADGE: Record<string, string> = {
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  action_required: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
};

/**
 * Notification rules (ADR 0037). System defaults; a tenant admin can enable or
 * disable a rule and narrow its channels. Not a workflow builder.
 */
export default function NotificationRulesPage() {
  const rules = useNotificationRules();
  const update = useUpdateNotificationRule();

  const toggleChannel = (key: string, channels: string[], channel: string, on: boolean) => {
    const next = (on ? [...channels, channel] : channels.filter((c) => c !== channel)) as Channels;
    update.mutate({ key, body: { channels: next } });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        description="Which business events send notifications, on which channels, to whom."
      />
      <NotifTabs />

      {rules.isLoading && <Skeleton rows={6} />}
      {rules.error && <ErrorNote error={rules.error} />}
      {update.error && <ErrorNote error={update.error} />}

      <div className="space-y-3">
        {(rules.data ?? []).map((rule) => (
          <div key={rule.key} className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{rule.description}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${
                      TYPE_BADGE[rule.notificationType] ?? 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {rule.notificationType.replace('_', ' ')}
                  </span>
                  {rule.overridden && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      customised
                    </span>
                  )}
                </div>
                <p className="mt-1 font-mono text-xs text-muted-foreground">
                  {rule.eventType} →{' '}
                  {STRATEGY_LABEL[rule.recipientStrategy] ?? rule.recipientStrategy}
                  {!rule.suppressible && ' · always sent'}
                </p>
              </div>

              <label className="flex shrink-0 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={rule.isActive}
                  disabled={update.isPending}
                  onChange={(e) =>
                    update.mutate({ key: rule.key, body: { isActive: e.target.checked } })
                  }
                />
                {rule.isActive ? 'Enabled' : 'Disabled'}
              </label>
            </div>

            <div className="mt-3 flex flex-wrap gap-3">
              {rule.availableChannels.map((channel) => (
                <label key={channel} className="flex items-center gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-primary"
                    checked={rule.channels.includes(channel)}
                    disabled={update.isPending || !rule.isActive}
                    onChange={(e) =>
                      toggleChannel(rule.key, rule.channels, channel, e.target.checked)
                    }
                  />
                  <span className="capitalize">{channel.replace('_', '-')}</span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
