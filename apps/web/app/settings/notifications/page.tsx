'use client';

import { ErrorNote, PageHeader, Skeleton } from '@/components/admin/ui';
import {
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from '@/lib/notifications/use-notifications';

/**
 * User notification preferences (ADR 0037). Kept deliberately simple: one
 * toggle per channel. System-critical notifications may still be delivered.
 */
export default function NotificationSettingsPage() {
  const prefs = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  const current = prefs.data;
  const set = (patch: { inAppEnabled?: boolean; emailEnabled?: boolean }) => {
    if (!current) return;
    update.mutate({
      inAppEnabled: patch.inAppEnabled ?? current.inAppEnabled,
      emailEnabled: patch.emailEnabled ?? current.emailEnabled,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notification preferences"
        description="Choose how you want to be notified. Some important notifications are always delivered."
      />

      {prefs.isLoading && <Skeleton rows={3} />}
      {prefs.error && <ErrorNote error={prefs.error} />}

      {current && (
        <div className="divide-y rounded-lg border bg-card">
          <Row
            label="In-app notifications"
            hint="Show notifications in the bell menu."
            checked={current.inAppEnabled}
            disabled={update.isPending}
            onChange={(v) => set({ inAppEnabled: v })}
          />
          <Row
            label="Email notifications"
            hint="Send notifications to your account email address."
            checked={current.emailEnabled}
            disabled={update.isPending}
            onChange={(v) => set({ emailEnabled: v })}
          />
        </div>
      )}

      {update.error && <ErrorNote error={update.error} />}
    </div>
  );
}

function Row({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <input
        type="checkbox"
        className="size-5 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
