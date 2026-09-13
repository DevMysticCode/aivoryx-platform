import { isSolutionKey, type SolutionKey } from './solutions.js';

/**
 * Aivoryx Plans (Phase 14 §29-31) — the commercial-packaging abstraction that
 * sits between a Solution (product preset) and a tenant's actual
 * `tenant_subscriptions` row. Deliberately minimal and code-defined: no
 * pricing, no proration, no billing-provider integration. A plan resolves to
 * a solution (and therefore a recommended module set); it is never itself an
 * authorization boundary.
 */
export interface PlanDefinition {
  key: string;
  displayName: string;
  solutionKey: SolutionKey;
}

export const PLAN_DEFINITIONS: readonly PlanDefinition[] = [
  { key: 'AIVORYX_SOLAR', displayName: 'Aivoryx Solar', solutionKey: 'SOLAR_EPC' },
  {
    key: 'AIVORYX_FIELD_SERVICE',
    displayName: 'Aivoryx Field Service',
    solutionKey: 'FIELD_SERVICE',
  },
  { key: 'AIVORYX_BUSINESS', displayName: 'Aivoryx Business', solutionKey: 'BUSINESS' },
] as const;

export type PlanKey = (typeof PLAN_DEFINITIONS)[number]['key'];

const PLAN_BY_KEY: ReadonlyMap<string, PlanDefinition> = new Map(
  PLAN_DEFINITIONS.map((p) => [p.key, p]),
);

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === 'string' && PLAN_BY_KEY.has(value);
}

export function getPlan(key: PlanKey): PlanDefinition {
  const p = PLAN_BY_KEY.get(key);
  if (!p) throw new Error(`Unknown plan key: ${key}`);
  return p;
}

/** Sanity: every plan resolves to a real solution (guards catalogue drift). */
export function assertPlanCatalogueConsistent(): void {
  for (const p of PLAN_DEFINITIONS) {
    if (!isSolutionKey(p.solutionKey)) {
      throw new Error(`Plan ${p.key} references unknown solution ${p.solutionKey}`);
    }
  }
}
