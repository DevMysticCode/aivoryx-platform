'use client';

import type { ReactNode } from 'react';
import { Send } from 'lucide-react';
import { SupplyShell } from '@/components/supply/supply-shell';

export default function LogisticsLayout({ children }: { children: ReactNode }) {
  return (
    <SupplyShell
      tabs={[
        {
          href: '/logistics/dispatches',
          label: 'Dispatches',
          icon: Send,
          permission: 'dispatch.read',
        },
      ]}
    >
      {children}
    </SupplyShell>
  );
}
