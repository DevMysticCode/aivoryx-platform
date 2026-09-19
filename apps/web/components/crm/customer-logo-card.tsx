'use client';

import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@aivoryx/ui';
import { Card, ErrorNote } from '@/components/admin/ui';
import { HelperText } from '@/components/help/helper-text';
import { fetchCustomerLogoObjectUrl } from '@/lib/api/commercial';
import { useRemoveCustomerLogo, useUploadCustomerLogo } from '@/lib/commercial/use-commercial';

/**
 * The customer's own logo. It is only ever printed on generated documents when
 * the workspace has turned on "Show customer logo on generated documents" in
 * Branding & themes — uploading one here does not expose it anywhere by itself.
 */
export function CustomerLogoCard({
  customerId,
  hasLogo,
  version,
  canEdit,
}: {
  customerId: string;
  hasLogo: boolean;
  version: string;
  canEdit: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const upload = useUploadCustomerLogo(customerId);
  const remove = useRemoveCustomerLogo(customerId);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!hasLogo) {
      setUrl(null);
      return;
    }
    let active = true;
    let created: string | null = null;
    void fetchCustomerLogoObjectUrl(customerId).then((u) => {
      created = u;
      if (active) setUrl(u);
      else if (u) URL.revokeObjectURL(u);
    });
    return () => {
      active = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [customerId, hasLogo, version]);

  if (!hasLogo && !canEdit) return null;

  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-semibold">Customer logo</h2>
      <div className="flex items-center gap-4">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-background-muted">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="Customer logo" className="size-full object-contain" />
          ) : (
            <span className="px-1 text-center text-[11px] text-subtle">No logo</span>
          )}
        </div>
        <div className="min-w-0 space-y-1.5">
          <HelperText>
            Optional. Printed on this customer&apos;s quotations and invoices only if your workspace
            enables customer logos in Branding &amp; themes.
          </HelperText>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                aria-label="Upload customer logo"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
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
                {hasLogo ? 'Replace' : 'Upload'}
              </Button>
              {hasLogo ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:text-danger"
                  isLoading={remove.isPending}
                  loadingText="Removing…"
                  onClick={() => remove.mutate()}
                >
                  Remove
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {upload.error ? <ErrorNote error={upload.error} /> : null}
      {remove.error ? <ErrorNote error={remove.error} /> : null}
    </Card>
  );
}
