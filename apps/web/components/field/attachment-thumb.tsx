'use client';

import { useEffect, useState } from 'react';
import type { VisitAttachment } from '@aivoryx/contracts';
import { fetchVisitAttachmentBlob } from '@/lib/api/field';

/**
 * Loads one visit attachment through the authenticated download route and
 * renders it as an image thumbnail (or a plain download link for non-image
 * content types, e.g. PDFs) — never a bare `<img src>` straight to the API.
 */
export function AttachmentThumb({
  visitId,
  attachment,
}: {
  visitId: string;
  attachment: VisitAttachment;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let currentUrl: string | null = null;
    let cancelled = false;
    fetchVisitAttachmentBlob(visitId, attachment.id)
      .then(({ objectUrl: url }) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        currentUrl = url;
        setObjectUrl(url);
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [visitId, attachment.id]);

  if (failed) {
    return (
      <div className="flex size-24 items-center justify-center rounded-md border text-xs text-muted-foreground">
        Failed to load
      </div>
    );
  }

  if (!objectUrl) {
    return <div className="size-24 animate-pulse rounded-md bg-secondary/50" aria-hidden />;
  }

  const isImage = attachment.contentType.startsWith('image/');

  return (
    <a
      href={objectUrl}
      download={attachment.originalFilename ?? undefined}
      className="block size-24 overflow-hidden rounded-md border"
      title={attachment.originalFilename ?? attachment.contentType}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- object: URL, not a remote/static asset
        <img src={objectUrl} alt="" className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
          {attachment.contentType.split('/')[1]?.toUpperCase() ?? 'FILE'}
        </div>
      )}
    </a>
  );
}
