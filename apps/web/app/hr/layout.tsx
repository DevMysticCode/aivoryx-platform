'use client';

import type { ReactNode } from 'react';
import {
  BarChart3,
  Building2,
  CalendarClock,
  LayoutDashboard,
  Receipt,
  User,
  Users,
  Wallet,
} from 'lucide-react';
import { SupplyShell } from '@/components/supply/supply-shell';

/**
 * HR & Workforce section chrome (Phase 12, ADR 0041). A permission-aware tab
 * strip over the same shell the other operational surfaces use. Sensitive
 * areas (compensation, bank details, payroll) live on tabs gated by their own
 * dedicated permissions inside the employee detail view, not here.
 */
export default function HrLayout({ children }: { children: ReactNode }) {
  return (
    <SupplyShell
      tabs={[
        { href: '/hr', label: 'Dashboard', icon: LayoutDashboard, permission: 'hr.employee.read' },
        { href: '/hr/employees', label: 'Employees', icon: Users, permission: 'hr.employee.read' },
        {
          href: '/hr/organization',
          label: 'Organisation',
          icon: Building2,
          permission: 'hr.organization.read',
        },
        {
          href: '/hr/attendance',
          label: 'Attendance',
          icon: CalendarClock,
          permission: 'hr.attendance.read',
        },
        { href: '/hr/leave', label: 'Leave', icon: CalendarClock, permission: 'hr.leave.read' },
        { href: '/hr/expenses', label: 'Expenses', icon: Receipt, permission: 'hr.expense.read' },
        { href: '/hr/payroll', label: 'Payroll', icon: Wallet, permission: 'hr.payroll.read' },
        {
          href: '/hr/performance',
          label: 'Performance',
          icon: BarChart3,
          permission: 'hr.performance.read',
        },
        { href: '/hr/me', label: 'My HR', icon: User, permission: 'hr.attendance.self' },
      ]}
    >
      {children}
    </SupplyShell>
  );
}
