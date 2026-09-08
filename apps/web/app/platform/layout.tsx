'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect } from 'react';
import { ApiError } from '@/lib/api/client';
import { useMe } from '@/lib/admin/use-admin';
import { LoadingBlock } from '@/components/ui/kit';

/**
 * Platform-administration surface (Phase 13B §9). Frontend gate only — every
 * `/platform/*` API is `@PlatformAdmin()` server-side. A non–platform-admin is
 * sent home rather than shown a dead page (§58).
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const me = useMe();

  const unauthenticated = me.error instanceof ApiError && me.error.status === 401;
  const isPlatformAdmin = !!me.data?.isPlatformAdmin;

  useEffect(() => {
    if (unauthenticated) router.replace('/login');
    else if (me.data && !isPlatformAdmin) router.replace('/');
  }, [unauthenticated, me.data, isPlatformAdmin, router]);

  if (me.isLoading || unauthenticated || (me.data && !isPlatformAdmin)) {
    return <LoadingBlock />;
  }

  return <div className="space-y-6">{children}</div>;
}
