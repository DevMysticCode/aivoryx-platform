'use client';

import type { ReactNode } from 'react';
import { CreditCard, FileText, Receipt, Wallet } from 'lucide-react';
import { SupplyShell } from '@/components/supply/supply-shell';

export default function FinanceLayout({ children }: { children: ReactNode }) {
  return (
    <SupplyShell
      tabs={[
        { href: '/finance', label: 'Overview', icon: Wallet, permission: 'finance.read' },
        {
          href: '/finance/invoices',
          label: 'Invoices',
          icon: FileText,
          permission: 'finance.invoices.read',
        },
        {
          href: '/finance/payments',
          label: 'Payments',
          icon: Receipt,
          permission: 'finance.payments.read',
        },
        {
          href: '/finance/credit-notes',
          label: 'Credit notes',
          icon: CreditCard,
          permission: 'finance.credit_notes.read',
        },
      ]}
    >
      {children}
    </SupplyShell>
  );
}
