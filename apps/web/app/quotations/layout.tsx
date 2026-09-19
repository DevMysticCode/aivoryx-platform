'use client';

import type { ReactNode } from 'react';
import { ModuleShell } from '@/components/navigation/module-shell';

export default function QuotationsLayout({ children }: { children: ReactNode }) {
  return <ModuleShell>{children}</ModuleShell>;
}
