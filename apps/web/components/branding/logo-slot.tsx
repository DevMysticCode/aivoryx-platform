'use client';

import { useLogoObjectUrl, useRemoveLogo, useUploadLogo } from '@/lib/settings/use-settings';
import type { LogoKind } from '@/lib/api/settings';
import { AssetSlot } from './asset-slot';

/**
 * A TENANT brand image slot: upload / removal go through the tenant-asset
 * endpoints and the preview is streamed through the authenticated tenant route.
 * (Platform branding uses `PlatformAssetSlot`, which talks to platform endpoints
 * only.)
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
  return (
    <AssetSlot
      label={label}
      hint={hint}
      present={present}
      previewUrl={url}
      canEdit={canEdit}
      fallback={fallback}
      onUpload={(file) => upload.mutate({ kind, file })}
      onRemove={() => remove.mutateAsync(kind)}
      uploading={upload.isPending}
      removing={remove.isPending}
      error={upload.error ?? remove.error}
    />
  );
}
