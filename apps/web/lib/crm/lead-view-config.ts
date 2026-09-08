/**
 * The lead-list filter state a saved view captures (Phase 13C §12). Pure — kept
 * separate from the React-Query hooks so it is unit-testable without the app
 * alias graph. Only fields the leads API actually supports; date / source /
 * follow-up filters need extra backend params and are deferred.
 */
export interface LeadViewConfig {
  q?: string;
  status?: string;
  assignedMembershipId?: string;
  board?: boolean;
}

/** Serialize a live filter state to a persistable config (drops empties). */
export function serializeViewConfig(c: LeadViewConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (v !== undefined && v !== '' && v !== false) out[k] = v;
  }
  return out;
}

/** Parse a persisted config back to a filter state (ignores unknown keys). */
export function parseViewConfig(config: Record<string, unknown> | undefined): LeadViewConfig {
  const c = config ?? {};
  const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : undefined);
  return {
    q: str('q'),
    status: str('status'),
    assignedMembershipId: str('assignedMembershipId'),
    board: c.board === true,
  };
}
