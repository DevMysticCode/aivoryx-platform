'use client';

import { useMe } from '@/lib/admin/use-admin';

/** Small helper: read the active membership's permissions on a supply page. */
export function usePermissions(): string[] {
  const me = useMe();
  return me.data?.active?.permissions ?? [];
}
