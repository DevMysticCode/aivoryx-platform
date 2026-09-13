import { type ModuleKey, validateEnable } from '../modules/catalogue.js';

/**
 * Aivoryx Solutions (Phase 14 §17-19) — code-defined product presets, NOT a
 * second authorization boundary. A solution only ever *recommends* a module
 * set; the authoritative technical truth remains
 * `tenant_module_entitlements`, and a platform admin can still adjust modules
 * away from the solution's default during provisioning or later. Nothing in
 * this file, and nothing that reads it, may branch business logic on a
 * solution key (`if (solution === 'SOLAR_EPC')`) — that would make the preset
 * a security mechanism, which it explicitly must never be.
 */
export interface SolutionDefinition {
  key: string;
  displayName: string;
  description: string;
  moduleKeys: readonly ModuleKey[];
}

export const SOLUTION_DEFINITIONS: readonly SolutionDefinition[] = [
  {
    key: 'SOLAR_EPC',
    displayName: 'Solar & EPC',
    description: 'Lead-to-installation delivery for solar/EPC contractors.',
    moduleKeys: ['CRM', 'FIELD', 'SUPPLY', 'COMMERCIAL', 'EPC', 'FINANCE', 'HR'],
  },
  {
    key: 'FIELD_SERVICE',
    displayName: 'Field Service',
    description: 'Site visits, dispatch and inventory for a field service business.',
    moduleKeys: ['CRM', 'FIELD', 'SUPPLY', 'FINANCE', 'HR'],
  },
  {
    key: 'BUSINESS',
    displayName: 'Business',
    description: 'CRM, HR and Finance for a general SME.',
    moduleKeys: ['CRM', 'HR', 'FINANCE'],
  },
] as const;

export type SolutionKey = (typeof SOLUTION_DEFINITIONS)[number]['key'];

const SOLUTION_BY_KEY: ReadonlyMap<string, SolutionDefinition> = new Map(
  SOLUTION_DEFINITIONS.map((s) => [s.key, s]),
);

export function isSolutionKey(value: unknown): value is SolutionKey {
  return typeof value === 'string' && SOLUTION_BY_KEY.has(value);
}

export function getSolution(key: SolutionKey): SolutionDefinition {
  const s = SOLUTION_BY_KEY.get(key);
  if (!s) throw new Error(`Unknown solution key: ${key}`);
  return s;
}

export interface ModuleSetValidationResult {
  ok: boolean;
  /** module -> the dependencies it is missing from the candidate set */
  unmet: { module: ModuleKey; missingDependencies: ModuleKey[] }[];
}

/**
 * Is this candidate module set internally dependency-consistent? Used both to
 * validate a solution definition (in tests) and to validate a platform
 * admin's adjusted module selection during provisioning — every module's
 * direct dependencies must also be present in the set.
 */
export function validateModuleSet(moduleKeys: readonly ModuleKey[]): ModuleSetValidationResult {
  const unmet = moduleKeys
    .map((m) => ({ module: m, check: validateEnable(m, moduleKeys) }))
    .filter((r) => !r.check.ok)
    .map((r) => ({ module: r.module, missingDependencies: r.check.missingDependencies }));
  return { ok: unmet.length === 0, unmet };
}
