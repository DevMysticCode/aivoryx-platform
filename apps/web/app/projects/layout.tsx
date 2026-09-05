'use client';

import type { ReactNode } from 'react';
import { FolderKanban } from 'lucide-react';
import { SupplyShell } from '@/components/supply/supply-shell';

export default function ProjectsLayout({ children }: { children: ReactNode }) {
  return (
    <SupplyShell
      tabs={[
        {
          href: '/projects',
          label: 'Projects',
          icon: FolderKanban,
          permission: 'projects.read',
        },
      ]}
    >
      {children}
    </SupplyShell>
  );
}
