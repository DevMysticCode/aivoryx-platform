'use client';

import type { ReactNode } from 'react';
import { Boxes, Package, Truck, Warehouse } from 'lucide-react';
import { SupplyShell } from '@/components/supply/supply-shell';

export default function InventoryLayout({ children }: { children: ReactNode }) {
  return (
    <SupplyShell
      tabs={[
        {
          href: '/inventory/products',
          label: 'Products',
          icon: Package,
          permission: 'products.read',
        },
        {
          href: '/inventory/suppliers',
          label: 'Suppliers',
          icon: Truck,
          permission: 'suppliers.read',
        },
        {
          href: '/inventory/warehouses',
          label: 'Warehouses',
          icon: Warehouse,
          permission: 'warehouses.read',
        },
        { href: '/inventory/stock', label: 'Stock', icon: Boxes, permission: 'inventory.read' },
      ]}
    >
      {children}
    </SupplyShell>
  );
}
