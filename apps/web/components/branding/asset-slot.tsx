'use client';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@aivoryx/ui';
import { ErrorNote } from '@/components/admin/ui';
import { Confirm } from '@/components/ui/kit';
import { HelperText } from '@/components/help/helper-text';

/**
 * One brand image slot, presentation only. Tenant branding and platform branding
 * both render this, each wiring its OWN upload/remove mutations - so the two
 * layers share the look but never share a code path to storage. Bytes are
 * validated server-side (real image sniffing, size, dimensions).
 */
export function AssetSlot({
  label,
  hint,
  present,
  previewUrl,
  canEdit,
  fallback,
  onUpload,
  onRemove,
  uploading,
  removing,
  error,
}: {
  label: string;
  hint: string;
  present: boolean;
  /** a URL the browser may render, or null (a monogram is drawn) */
  previewUrl: string | null;
  canEdit: boolean;
  fallback: string;
  onUpload: (file: File) => void;
  onRemove: () => Promise<unknown> | void;
  uploading?: boolean;
  removing?: boolean;
  error?: unknown;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <div
        className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md border bg-background-muted"
        aria-hidden={!previewUrl}
      >
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt={`${label} preview`} className="size-full object-contain" />
        ) : (
          <span className="text-lg font-bold text-subtle">{fallback.charAt(0).toUpperCase()}</span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="text-sm font-medium">{label}</p>
        <HelperText>{hint}</HelperText>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              aria-label={`Upload ${label}`}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                if (input.current) input.current.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              isLoading={uploading}
              loadingText="Uploading…"
              onClick={() => input.current?.click()}
            >
              <Upload className="size-3.5" aria-hidden />
              {present ? 'Replace' : 'Upload'}
            </Button>
            {present ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-danger hover:text-danger"
                onClick={() => setConfirming(true)}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
        {error ? <ErrorNote error={error} /> : null}
      </div>
      <Confirm
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          await onRemove();
          setConfirming(false);
        }}
        title={`Remove the ${label.toLowerCase()}?`}
        body="It will stop appearing wherever it is used until you upload a new one."
        confirmLabel="Remove"
        danger
        pending={removing}
      />
    </div>
  );
}
