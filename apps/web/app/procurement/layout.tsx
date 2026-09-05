'use client';

import type { ReactNode } from 'react';
import { ClipboardList } from 'lucide-react';
import { SupplyShell } from '@/components/supply/supply-shell';

export default function ProcurementLayout({ children }: { children: ReactNode }) {
  return (
    <SupplyShell
      tabs={[
        {
          href: '/procurement/purchase-orders',
          label: 'Purchase orders',
          icon: ClipboardList,
          permission: 'procurement.read',
        },
      ]}
    >
      {children}
    </SupplyShell>
  );
}
