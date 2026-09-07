import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Boxes,
  Building2,
  CalendarClock,
  ClipboardList,
  Contact,
  FileText,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  Send,
  Settings,
  ShieldCheck,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import type { ModuleKey } from '@aivoryx/shared';

/**
 * The centralized navigation registry (Phase 13B, ADR 0042 §8).
 *
 * The application shell renders navigation from THIS list, filtered by the
 * caller's platform role, the tenant's entitled modules, and the user's
 * effective permissions — never a hard-coded per-role menu. Hiding a link is a
 * UX affordance only; the backend guard remains authoritative (§58).
 *
 * An entry is shown when:
 *   - `module` is undefined (a platform / cross-cutting area), OR the tenant is
 *     entitled to `module`; AND
 *   - `permission` is undefined, OR the user holds it (effective permission,
 *     which already intersects entitlement).
 * A parent group is shown when at least one child passes.
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
  children?: NavEntry[];
}

/** Tenant-workspace navigation (the default shell). */
export const TENANT_NAV: NavEntry[] = [
  { key: 'dashboard', label: 'Dashboard', href: '/', icon: LayoutDashboard, order: 0 },
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
    key: 'field',
    label: 'Field Operations',
    href: '/field',
    icon: CalendarClock,
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
    key: 'inventory',
    label: 'Inventory',
    href: '/inventory/products',
    icon: Boxes,
    module: 'SUPPLY',
    permission: 'products.read',
    order: 50,
  },
  {
    key: 'procurement',
    label: 'Procurement',
    href: '/procurement/purchase-orders',
    icon: ClipboardList,
    module: 'SUPPLY',
    permission: 'procurement.read',
    order: 60,
  },
  {
    key: 'logistics',
    label: 'Logistics',
    href: '/logistics/dispatches',
    icon: Send,
    module: 'SUPPLY',
    permission: 'dispatch.read',
    order: 70,
  },
  {
    key: 'finance',
    label: 'Finance',
    href: '/finance',
    icon: Wallet,
    module: 'FINANCE',
    permission: 'finance.read',
    order: 80,
  },
  {
    key: 'hr',
    label: 'HR & Workforce',
    href: '/hr',
    icon: UserCog,
    module: 'HR',
    permission: 'hr.organization.read',
    order: 90,
  },
  {
    key: 'admin',
    label: 'Administration',
    href: '/admin',
    icon: ShieldCheck,
    permission: 'memberships.read',
    order: 100,
  },
  { key: 'settings', label: 'Settings', href: '/settings/company', icon: Settings, order: 110 },
  { key: 'health', label: 'System health', href: '/health', icon: Activity, order: 120 },
];

/** Distinct platform-administration navigation (Phase 13B §9). */
export const PLATFORM_NAV: NavEntry[] = [
  { key: 'platform.overview', label: 'Overview', href: '/platform', icon: Gauge, order: 0 },
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
  { key: 'platform.system', label: 'System health', href: '/health', icon: Activity, order: 30 },
];

/**
 * The compact set of destinations pinned to the mobile bottom bar (§6). Chosen
 * for frequency, not breadth — everything else lives in the "More" sheet.
 */
export const MOBILE_PRIMARY_KEYS = ['dashboard', 'crm', 'hr', 'field', 'admin'] as const;
