'use client';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@aivoryx/ui';
import { ErrorNote } from '@/components/admin/ui';
import { Confirm } from '@/components/ui/kit';
import { HelperText } from '@/components/help/helper-text';
import { useLogoObjectUrl, useRemoveLogo, useUploadLogo } from '@/lib/settings/use-settings';
import type { LogoKind } from '@/lib/api/settings';

/**
 * One brand image slot (logo, compact logo, favicon, …). Upload and removal go
 * through the existing tenant-asset endpoints: bytes are validated server-side
 * (real image sniffing, size and dimensions), stored via the object-storage
 * service and streamed back through an authenticated route — nothing is public
 * and no storage key reaches the browser.
 */
export function LogoSlot({
  kind,
  label,
  hint,
  present,
  cacheKey,
  canEdit,
  fallback,
}: {
  kind: LogoKind;
  label: string;
  hint: string;
  present: boolean;
  cacheKey: string | null;
  canEdit: boolean;
  fallback: string;
}) {
  const url = useLogoObjectUrl(present, cacheKey, kind);
  const upload = useUploadLogo();
  const remove = useRemoveLogo();
  const input = useRef<HTMLInputElement>(null);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3">
      <div
        className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-md border bg-background-muted"
        aria-hidden={!url}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`${label} preview`} className="size-full object-contain" />
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
                if (f) upload.mutate({ kind, file: f });
                if (input.current) input.current.value = '';
              }}
            />
            <Button
              variant="outline"
              size="sm"
              isLoading={upload.isPending}
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
        {upload.error ? <ErrorNote error={upload.error} /> : null}
        {remove.error ? <ErrorNote error={remove.error} /> : null}
      </div>
      <Confirm
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          await remove.mutateAsync(kind);
          setConfirming(false);
        }}
        title={`Remove the ${label.toLowerCase()}?`}
        body="It will stop appearing wherever it is used until you upload a new one."
        confirmLabel="Remove"
        danger
        pending={remove.isPending}
      />
    </div>
  );
}
