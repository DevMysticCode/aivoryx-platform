/**
 * The Aivoryx **module catalogue** — the single authoritative registry of
 * product modules (Phase 13, ADR 0042).
 *
 * A "module" is a provider-neutral unit of product capability that a platform
 * administrator can enable or disable **per tenant** (`tenant_module_entitlements`).
 * Every business permission key in `PERMISSION_DEFINITIONS` belongs to exactly
 * one module through {@link moduleForPermission}; platform/identity permissions
 * belong to no module (`null`) and are always available.
 *
 * The authorization order is fixed and must never be inverted:
 *
 *   TENANT MODULE ENTITLEMENT → USER PROFILE/ROLE/PERMISSION SET → DATA SCOPE → ALLOW/DENY
 *
 * A user can never reach a module the tenant is not entitled to, regardless of
 * the permissions their profile or permission sets carry.
 */

export type ModuleKey = 'CRM' | 'FIELD' | 'SUPPLY' | 'COMMERCIAL' | 'EPC' | 'FINANCE' | 'HR';

export type ModuleCategory = 'sales' | 'operations' | 'finance' | 'people';

export interface ModuleDefinition {
  /** stable machine key — never changes once shipped */
  key: ModuleKey;
  displayName: string;
  description: string;
  /** a short, human capability summary for the provisioning UI */
  capabilitySummary: string;
  /** lucide-react icon name, resolved by the web shell */
  icon: string;
  category: ModuleCategory;
  /** ascending sort order for navigation and the module list */
  order: number;
  /** other modules that must be ENABLED for this one to be enabled */
  dependencies: ModuleKey[];
  /**
   * the permission-key prefixes this module owns. A permission key belongs to
   * this module if it `===` an entry or starts with `entry + '.'`.
   */
  permissionPrefixes: string[];
  /** whether the module can be offered to tenants at all (future kill-switch) */
  available: boolean;
}

export const MODULE_DEFINITIONS = [
  {
    key: 'CRM',
    displayName: 'CRM',
    description: 'Lead and customer management — the reusable lead domain.',
    capabilitySummary: 'Leads, customers, activities, follow-ups, qualification, assignment.',
    icon: 'Users',
    category: 'sales',
    order: 10,
    dependencies: [],
    permissionPrefixes: ['crm', 'customers'],
    available: true,
  },
  {
    key: 'FIELD',
    displayName: 'Field Operations',
    description: 'Site visits, GPS check-in/out, surveys, field-generated leads.',
    capabilitySummary: 'Visit scheduling, assignment, check-in/out, surveys, photos.',
    icon: 'MapPin',
    category: 'operations',
    order: 20,
    dependencies: [],
    permissionPrefixes: ['field'],
    available: true,
  },
  {
    key: 'SUPPLY',
    displayName: 'Supply Chain',
    description: 'Projects/orders, inventory, procurement and logistics.',
    capabilitySummary: 'Products, suppliers, warehouses, stock, purchase orders, dispatches.',
    icon: 'Boxes',
    category: 'operations',
    order: 30,
    dependencies: [],
    permissionPrefixes: [
      'projects.read',
      'projects.create',
      'projects.update',
      'projects.approve',
      'products',
      'suppliers',
      'warehouses',
      'inventory',
      'procurement',
      'dispatch',
    ],
    available: true,
  },
  {
    key: 'COMMERCIAL',
    displayName: 'Quotations',
    description: 'Customer quotations, revisions, acceptance and project booking.',
    capabilitySummary: 'Quotation drafting, revisions, send/accept, booking to a project.',
    icon: 'FileText',
    category: 'sales',
    order: 40,
    dependencies: ['CRM', 'SUPPLY'],
    permissionPrefixes: ['quotations'],
    available: true,
  },
  {
    key: 'EPC',
    displayName: 'Project Execution',
    description: 'EPC delivery — installation, QC, net metering, handover, defects.',
    capabilitySummary: 'Execution workspace, installations, QC, net metering, handover.',
    icon: 'HardHat',
    category: 'operations',
    order: 50,
    dependencies: ['COMMERCIAL', 'SUPPLY', 'FIELD'],
    permissionPrefixes: [
      'projects.execution',
      'projects.installation',
      'projects.qc',
      'projects.net_metering',
      'projects.handover',
      'projects.complete',
      'projects.defects',
    ],
    available: true,
  },
  {
    key: 'FINANCE',
    displayName: 'Finance',
    description: 'Operational invoicing, payments, allocations and credit notes.',
    capabilitySummary: 'Invoices, payments, allocations, credit notes, financial summaries.',
    icon: 'Wallet',
    category: 'finance',
    order: 60,
    dependencies: [],
    permissionPrefixes: ['finance'],
    available: true,
  },
  {
    key: 'HR',
    displayName: 'HR & Workforce',
    description: 'Employees, attendance, leave, expenses, compensation, payroll, performance.',
    capabilitySummary: 'Org, employees, attendance, leave, expenses, payroll, performance.',
    icon: 'UserCog',
    category: 'people',
    order: 70,
    dependencies: [],
    permissionPrefixes: ['hr'],
    available: true,
  },
] as const satisfies readonly ModuleDefinition[];

/** Widened view — the `as const satisfies` above keeps per-entry literal types
 *  (e.g. CRM's `dependencies` as `readonly []`), which makes `.includes()` on a
 *  `ModuleKey` fail. Internal helpers iterate this instead. */
const DEFS: readonly ModuleDefinition[] = MODULE_DEFINITIONS;

export const MODULE_KEYS: readonly ModuleKey[] = DEFS.map((m) => m.key);

const MODULE_BY_KEY: ReadonlyMap<string, ModuleDefinition> = new Map(DEFS.map((m) => [m.key, m]));

export function isModuleKey(value: unknown): value is ModuleKey {
  return typeof value === 'string' && MODULE_BY_KEY.has(value);
}

export function getModule(key: ModuleKey): ModuleDefinition {
  const m = MODULE_BY_KEY.get(key);
  if (!m) throw new Error(`Unknown module key: ${key}`);
  return m;
}

const PERMISSION_MODULE_CACHE = new Map<string, ModuleKey | null>();

/**
 * The module that owns a permission key, or `null` for a platform/identity
 * permission that is always available (users, roles, tenants, notifications,
 * settings, audit, and this phase's platform/access permissions).
 *
 * Memoized — called once per guarded request in the security guard.
 */
export function moduleForPermission(permissionKey: string): ModuleKey | null {
  const cached = PERMISSION_MODULE_CACHE.get(permissionKey);
  if (cached !== undefined) return cached;
  let result: ModuleKey | null = null;
  outer: for (const m of DEFS) {
    for (const prefix of m.permissionPrefixes) {
      if (permissionKey === prefix || permissionKey.startsWith(`${prefix}.`)) {
        result = m.key;
        break outer;
      }
    }
  }
  PERMISSION_MODULE_CACHE.set(permissionKey, result);
  return result;
}

/** Every permission key owned by a module (used by the profile editor). */
export function permissionsForModule(
  permissionKeys: readonly string[],
  moduleKey: ModuleKey,
): string[] {
  return permissionKeys.filter((k) => moduleForPermission(k) === moduleKey);
}

/**
 * The transitive dependency closure of a module (its dependencies, and theirs).
 * Order is not significant.
 */
export function moduleDependencyClosure(key: ModuleKey): ModuleKey[] {
  const seen = new Set<ModuleKey>();
  const walk = (k: ModuleKey): void => {
    for (const dep of getModule(k).dependencies) {
      if (!seen.has(dep)) {
        seen.add(dep);
        walk(dep);
      }
    }
  };
  walk(key);
  return [...seen];
}

/** Modules that declare `key` as a direct dependency. */
export function modulesDependingOn(key: ModuleKey): ModuleKey[] {
  return DEFS.filter((m) => m.dependencies.includes(key)).map((m) => m.key);
}

export interface EntitlementValidationResult {
  ok: boolean;
  /** dependency module keys that are required but not in the enabled set */
  missingDependencies: ModuleKey[];
}

/** Can `moduleKey` be enabled given the current `enabled` set? */
export function validateEnable(
  moduleKey: ModuleKey,
  enabled: readonly ModuleKey[],
): EntitlementValidationResult {
  const enabledSet = new Set(enabled);
  const missing = getModule(moduleKey).dependencies.filter((d) => !enabledSet.has(d));
  return { ok: missing.length === 0, missingDependencies: missing };
}

export interface DisableValidationResult {
  ok: boolean;
  /** enabled modules that would be left with an unmet dependency */
  blockingDependants: ModuleKey[];
}

/** Can `moduleKey` be disabled without orphaning another enabled module? */
export function validateDisable(
  moduleKey: ModuleKey,
  enabled: readonly ModuleKey[],
): DisableValidationResult {
  const remaining = new Set(enabled.filter((k) => k !== moduleKey));
  const blocking = [...remaining].filter((k) => getModule(k).dependencies.includes(moduleKey));
  return { ok: blocking.length === 0, blockingDependants: blocking };
}
