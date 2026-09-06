'use client';

import type { ReactNode } from 'react';
import { FileText } from 'lucide-react';
import { SupplyShell } from '@/components/supply/supply-shell';

export default function QuotationsLayout({ children }: { children: ReactNode }) {
  return (
    <SupplyShell
      tabs={[
        { href: '/quotations', label: 'Quotations', icon: FileText, permission: 'quotations.read' },
      ]}
    >
      {children}
    </SupplyShell>
  );
}
