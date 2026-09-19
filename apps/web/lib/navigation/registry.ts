import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BarChart3,
  Bell,
  Boxes,
  Building2,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  Contact,
  FileText,
  FolderKanban,
  Gauge,
  HardHat,
  KeyRound,
  LayoutDashboard,
  MapPin,
  Package,
  Palette,
  Plug,
  Receipt,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  Truck,
  User,
  UserCog,
  Users,
  Wallet,
  Warehouse,
} from 'lucide-react';
import type { ModuleKey } from '@aivoryx/shared';

/**
 * The centralized navigation registry (Phase 13B, ADR 0042 §8; restructured in
 * Phase 19, ADR 0046).
 *
 * The application shell — the sidebar, the collapsed rail, the mobile "More"
 * sheet AND every module's in-page section strip — renders from THIS list,
 * filtered by the caller's platform role, the tenant's entitled modules, and
 * the user's effective permissions — never a hard-coded per-role menu. Hiding a
 * link is a UX affordance only; the backend guard remains authoritative (§58).
 *
 * Exactly two levels: MODULE → SECTION. A section is a real route the module
 * already owns; statuses and filters are never navigation (they live inside the
 * page). An entry is shown when:
 *   - `module` is undefined (a platform / cross-cutting area), OR the tenant is
 *     entitled to `module`; AND
 *   - `permission` is undefined, OR the user holds it (effective permission,
 *     which already intersects entitlement).
 * A module (parent) is shown when at least one section passes; it carries no
 * permission of its own. So an employee who can only reach "My HR" still sees
 * HR & Workforce → My HR — capability-driven, no role names.
 */
export interface NavEntry {
  /** stable key — also the analytics / test id */
  key: string;
  label: string;
  /** absolute route; a group without its own page omits this */
  href?: string;
  icon: LucideIcon;
  /** the module this area belongs to; undefined = always-available platform area */
  module?: ModuleKey;
  /** an effective permission the user must hold to see this entry */
  permission?: string;
  /** ascending display order within its section */
  order: number;
  /** match the route exactly (an "Overview" whose href prefixes its siblings) */
  exact?: boolean;
  children?: NavEntry[];
}

/** Tenant-workspace navigation (the default shell). */
export const TENANT_NAV: NavEntry[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/', icon: LayoutDashboard, order: 0, exact: true },
  {
    key: 'crm',
    label: 'CRM',
    href: '/crm',
    icon: Users,
    module: 'CRM',
    order: 10,
    children: [
      {
        key: 'crm.overview',
        label: 'Overview',
        href: '/crm',
        icon: Gauge,
        module: 'CRM',
        order: 0,
        exact: true,
      },
      {
        key: 'crm.leads',
        label: 'Leads',
        href: '/crm/leads',
        icon: Users,
        module: 'CRM',
        permission: 'crm.leads.read',
        order: 10,
      },
      {
        key: 'crm.customers',
        label: 'Customers',
        href: '/customers',
        icon: Contact,
        module: 'CRM',
        permission: 'customers.read',
        order: 20,
      },
      {
        key: 'crm.visits',
        label: 'Visits',
        href: '/crm/visits',
        icon: CalendarClock,
        module: 'FIELD',
        permission: 'field.visits.read',
        order: 30,
      },
    ],
  },
  {
    // The Field Agent app is its own mobile-first PWA with its own chrome
    // (ADR 0033) — a single entry, not a section list.
    key: 'field',
    label: 'Field Operations',
    href: '/field',
    icon: HardHat,
    module: 'FIELD',
    permission: 'field.visits.read',
    order: 20,
  },
  {
    key: 'quotations',
    label: 'Quotations',
    href: '/quotations',
    icon: FileText,
    module: 'COMMERCIAL',
    permission: 'quotations.read',
    order: 30,
  },
  {
    key: 'projects',
    label: 'Projects',
    href: '/projects',
    icon: FolderKanban,
    module: 'SUPPLY',
    permission: 'projects.read',
    order: 40,
  },
  {
    key: 'supply',
    label: 'Supply chain',
    href: '/inventory/products',
    icon: Boxes,
    module: 'SUPPLY',
    order: 50,
    children: [
      {
        key: 'supply.products',
        label: 'Products',
        href: '/inventory/products',
        icon: Package,
        module: 'SUPPLY',
        permission: 'products.read',
        order: 0,
      },
      {
        key: 'supply.stock',
        label: 'Stock',
        href: '/inventory/stock',
        icon: Boxes,
        module: 'SUPPLY',
        permission: 'inventory.read',
        order: 10,
      },
      {
        key: 'supply.suppliers',
        label: 'Suppliers',
        href: '/inventory/suppliers',
        icon: Truck,
        module: 'SUPPLY',
        permission: 'suppliers.read',
        order: 20,
      },
      {
        key: 'supply.warehouses',
        label: 'Warehouses',
        href: '/inventory/warehouses',
        icon: Warehouse,
        module: 'SUPPLY',
        permission: 'warehouses.read',
        order: 30,
      },
      {
        key: 'supply.purchase-orders',
        label: 'Purchase orders',
        href: '/procurement/purchase-orders',
        icon: ClipboardList,
        module: 'SUPPLY',
        permission: 'procurement.read',
        order: 40,
      },
      {
        key: 'supply.dispatches',
        label: 'Dispatches',
        href: '/logistics/dispatches',
        icon: Send,
        module: 'SUPPLY',
        permission: 'dispatch.read',
        order: 50,
      },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    href: '/finance',
    icon: Wallet,
    module: 'FINANCE',
    order: 80,
    children: [
      {
        key: 'finance.overview',
        label: 'Overview',
        href: '/finance',
        icon: Gauge,
        module: 'FINANCE',
        permission: 'finance.read',
        order: 0,
        exact: true,
      },
      {
        key: 'finance.invoices',
        label: 'Invoices',
        href: '/finance/invoices',
        icon: Receipt,
        module: 'FINANCE',
        permission: 'finance.invoices.read',
        order: 10,
      },
      {
        key: 'finance.payments',
        label: 'Payments',
        href: '/finance/payments',
        icon: Wallet,
        module: 'FINANCE',
        permission: 'finance.payments.read',
        order: 20,
      },
      {
        key: 'finance.credit-notes',
        label: 'Credit notes',
        href: '/finance/credit-notes',
        icon: FileText,
        module: 'FINANCE',
        permission: 'finance.credit_notes.read',
        order: 30,
      },
    ],
  },
  {
    key: 'hr',
    label: 'HR & Workforce',
    href: '/hr',
    icon: UserCog,
    module: 'HR',
    order: 90,
    children: [
      {
        key: 'hr.dashboard',
        label: 'Overview',
        href: '/hr',
        icon: Gauge,
        module: 'HR',
        permission: 'hr.employee.read',
        order: 0,
        exact: true,
      },
      {
        key: 'hr.employees',
        label: 'Employees',
        href: '/hr/employees',
        icon: Users,
        module: 'HR',
        permission: 'hr.employee.read',
        order: 10,
      },
      {
        key: 'hr.organization',
        label: 'Organisation',
        href: '/hr/organization',
        icon: Building2,
        module: 'HR',
        permission: 'hr.organization.read',
        order: 20,
      },
      {
        key: 'hr.attendance',
        label: 'Attendance',
        href: '/hr/attendance',
        icon: CalendarClock,
        module: 'HR',
        permission: 'hr.attendance.read',
        order: 30,
      },
      {
        key: 'hr.leave',
        label: 'Leave',
        href: '/hr/leave',
        icon: CalendarDays,
        module: 'HR',
        permission: 'hr.leave.read',
        order: 40,
      },
      {
        key: 'hr.expenses',
        label: 'Expenses',
        href: '/hr/expenses',
        icon: Receipt,
        module: 'HR',
        permission: 'hr.expense.read',
        order: 50,
      },
      {
        key: 'hr.payroll',
        label: 'Payroll',
        href: '/hr/payroll',
        icon: Wallet,
        module: 'HR',
        permission: 'hr.payroll.read',
        order: 60,
      },
      {
        key: 'hr.performance',
        label: 'Performance',
        href: '/hr/performance',
        icon: BarChart3,
        module: 'HR',
        permission: 'hr.performance.read',
        order: 70,
      },
      {
        key: 'hr.me',
        label: 'My HR',
        href: '/hr/me',
        icon: User,
        module: 'HR',
        permission: 'hr.attendance.self',
        order: 80,
      },
    ],
  },
  {
    key: 'admin',
    label: 'Administration',
    href: '/admin',
    icon: ShieldCheck,
    order: 100,
    children: [
      {
        key: 'admin.overview',
        label: 'Overview',
        href: '/admin',
        icon: ShieldCheck,
        permission: 'memberships.read',
        order: 0,
        exact: true,
      },
      {
        key: 'admin.members',
        label: 'Members',
        href: '/admin/members',
        icon: Users,
        permission: 'memberships.read',
        order: 10,
      },
      {
        key: 'admin.access',
        label: 'Access',
        href: '/admin/access',
        icon: KeyRound,
        permission: 'roles.read',
        order: 20,
      },
      {
        key: 'admin.field-agents',
        label: 'Field agents',
        href: '/admin/field-agents',
        icon: MapPin,
        module: 'FIELD',
        permission: 'field.agents.manage',
        order: 30,
      },
      {
        key: 'admin.settings',
        label: 'Workspace settings',
        href: '/admin/settings',
        icon: Building2,
        permission: 'tenants.read',
        order: 40,
      },
      {
        key: 'admin.integrations',
        label: 'Integrations',
        href: '/admin/integrations',
        icon: Plug,
        permission: 'memberships.read',
        order: 50,
      },
      {
        key: 'admin.notifications',
        label: 'Notifications',
        href: '/admin/notifications',
        icon: Bell,
        permission: 'notifications.templates.read',
        order: 60,
      },
      {
        key: 'admin.audit',
        label: 'Audit log',
        href: '/admin/audit',
        icon: ScrollText,
        permission: 'audit.read',
        order: 70,
      },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    href: '/settings/company',
    icon: Settings,
    order: 110,
    children: [
      {
        key: 'settings.company',
        label: 'Company',
        href: '/settings/company',
        icon: Building2,
        permission: 'settings.company.read',
        order: 0,
      },
      {
        key: 'settings.branding',
        label: 'Branding & themes',
        href: '/settings/branding',
        icon: Palette,
        permission: 'settings.company.read',
        order: 10,
      },
      {
        key: 'settings.notifications',
        label: 'Notifications',
        href: '/settings/notifications',
        icon: Bell,
        order: 20,
      },
    ],
  },
  { key: 'health', label: 'System health', href: '/health', icon: Activity, order: 120 },
];

/** Distinct platform-administration navigation (Phase 13B §9). */
export const PLATFORM_NAV: NavEntry[] = [
  {
    key: 'platform.overview',
    label: 'Overview',
    href: '/platform',
    icon: Gauge,
    order: 0,
    exact: true,
  },
  {
    key: 'platform.tenants',
    label: 'Companies',
    href: '/platform/tenants',
    icon: Building2,
    order: 10,
  },
  {
    key: 'platform.modules',
    label: 'Modules',
    href: '/platform/modules',
    icon: Boxes,
    order: 20,
  },
  {
    key: 'platform.branding',
    label: 'Branding',
    href: '/platform/settings/branding',
    icon: Palette,
    order: 25,
  },
  { key: 'platform.system', label: 'System health', href: '/health', icon: Activity, order: 30 },
];

/**
 * The compact set of destinations pinned to the mobile bottom bar (§6). Chosen
 * for frequency, not breadth — everything else lives in the "More" sheet.
 */
export const MOBILE_PRIMARY_KEYS = ['dashboard', 'crm', 'hr', 'field', 'admin'] as const;

/** Does `pathname` belong to `entry` (exact for overview entries, prefix otherwise)? */
export function entryMatchesPath(
  entry: Pick<NavEntry, 'href' | 'exact'>,
  pathname: string,
): boolean {
  const href = entry.href;
  if (!href) return false;
  if (href === '/' || entry.exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
