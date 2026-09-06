'use client';

import type { ReactNode } from 'react';
import { Contact } from 'lucide-react';
import { SupplyShell } from '@/components/supply/supply-shell';

export default function CustomersLayout({ children }: { children: ReactNode }) {
  return (
    <SupplyShell
      tabs={[
        { href: '/customers', label: 'Customers', icon: Contact, permission: 'customers.read' },
      ]}
    >
      {children}
    </SupplyShell>
  );
}
