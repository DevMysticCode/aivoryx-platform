'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import type { ChecklistItem } from '@aivoryx/contracts';
import { captureLocation } from '@/lib/field/geolocation';
import {
  useExecution,
  useExecutionActions,
  useExecutionAttachments,
  useUploadExecutionAttachment,
} from '@/lib/execution/use-execution';
import { EmptyState, ErrorNote, Skeleton } from '@/components/admin/ui';
import { SupplyStatusBadge } from '@/components/supply/ui';

export default function FieldProjectExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const exec = useExecution(id, { field: true });
  const actions = useExecutionActions(id);
  const upload = useUploadExecutionAttachment(id);
  const files = useExecutionAttachments(id, 'installation');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  if (exec.isLoading) return <Skeleton rows={6} />;
  if (exec.error) return <ErrorNote error={exec.error} />;
  if (!exec.data) return <EmptyState>Not found.</EmptyState>;
  const v = exec.data;
  const inst = v.installation;
  if (!inst) return <EmptyState>No installation record.</EmptyState>;

  const withLocation = async (): Promise<{ location?: { lat: number; lng: number } }> => {
    try {
      const pos = await captureLocation();
      return { location: { lat: pos.lat, lng: pos.lng } };
    } catch {
      return {}; // location is optional for start/complete
    }
  };

  const requiredPending = v.installationChecklist.filter(
    (i) => i.required && i.status === 'pending',
  ).length;

  return (
    <section className="space-y-4 pb-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{v.projectNumber}</h1>
          <SupplyStatusBadge status={inst.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          {v.customerName ?? v.leadName ?? 'Customer'}
        </p>
      </div>

      <div className="rounded-lg border p-3 text-sm">
        <div className="font-medium">Materials</div>
        <div
          className={
            v.readiness.state === 'READY'
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400'
          }
        >
          {v.readiness.state.replace(/_/g, ' ').toLowerCase()} · delivered{' '}
          {v.readiness.deliveredQty} of {v.readiness.requiredQty}
        </div>
        {inst.materialOverride ? (
          <div className="mt-1 text-xs text-muted-foreground">
            Override: {inst.materialOverrideReason}
          </div>
        ) : null}
      </div>

      {inst.status === 'ASSIGNED' ? (
        <Button
          className="w-full"
          disabled={actions.startInstallation.isPending}
          onClick={async () => actions.startInstallation.mutate(await withLocation())}
        >
          {actions.startInstallation.isPending ? 'Starting…' : 'Start installation'}
        </Button>
      ) : null}
      <ErrorNote error={actions.startInstallation.error || actions.completeInstallation.error} />

      {(inst.status === 'IN_PROGRESS' || inst.status === 'COMPLETED') && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Checklist</div>
          <FieldChecklist
            items={v.installationChecklist}
            disabled={inst.status === 'COMPLETED'}
            onToggle={(itemId, status) => actions.toggleChecklistItem.mutate({ itemId, status })}
          />
        </div>
      )}

      {inst.status === 'IN_PROGRESS' && (
        <div className="space-y-2">
          <label className="block text-sm font-medium">Photo / evidence</label>
          <label className="flex w-full items-center justify-center rounded-lg border border-dashed py-6 text-sm text-primary">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                try {
                  await upload.mutateAsync({ entityKind: 'installation', entityId: inst.id, file });
                } finally {
                  setBusy(false);
                  e.target.value = '';
                }
              }}
            />
            {busy ? 'Uploading…' : 'Tap to add a photo'}
          </label>
          {files.data && files.data.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {files.data.map((f) => (
                <li key={f.id}>{f.originalFilename ?? f.id.slice(0, 8)}</li>
              ))}
            </ul>
          ) : null}
          <ErrorNote error={upload.error} />

          <label className="block text-sm font-medium">Notes</label>
          <textarea
            className="w-full rounded-md border border-input bg-transparent p-2 text-sm"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button
            className="w-full"
            disabled={requiredPending > 0 || actions.completeInstallation.isPending}
            onClick={async () =>
              actions.completeInstallation.mutate({
                notes: notes || undefined,
                ...(await withLocation()),
              })
            }
          >
            {requiredPending > 0
              ? `${requiredPending} required check${requiredPending === 1 ? '' : 's'} left`
              : actions.completeInstallation.isPending
                ? 'Completing…'
                : 'Complete installation'}
          </Button>
        </div>
      )}

      {v.defects.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Defects assigned to me</div>
          <ul className="space-y-2 text-sm">
            {v.defects.map((d) => (
              <li key={d.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span>{d.description}</span>
                  <SupplyStatusBadge status={d.status} />
                </div>
                {d.status !== 'VERIFIED' && d.status !== 'RESOLVED' ? (
                  <Button
                    variant="outline"
                    className="mt-2 w-full"
                    onClick={() =>
                      actions.updateDefect.mutate({ defectId: d.id, status: 'RESOLVED' })
                    }
                  >
                    Mark resolved
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {inst.status === 'COMPLETED' && (
        <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          Installation complete. QC and handover are handled by the office team.
        </p>
      )}

      <Link href="/field/projects" className="block text-center text-sm text-muted-foreground">
        ← All installations
      </Link>
    </section>
  );
}

function FieldChecklist({
  items,
  disabled,
  onToggle,
}: {
  items: ChecklistItem[];
  disabled: boolean;
  onToggle: (itemId: string, status: 'pending' | 'done' | 'na') => void;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((it) => (
        <li key={it.id} className="flex items-center gap-3 p-3">
          <input
            type="checkbox"
            className="size-5"
            disabled={disabled}
            checked={it.status === 'done'}
            onChange={(e) => onToggle(it.id, e.target.checked ? 'done' : 'pending')}
          />
          <span className={it.status === 'done' ? 'text-muted-foreground line-through' : ''}>
            {it.label}
            {it.required ? <span className="ml-1 text-xs text-destructive">*</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
