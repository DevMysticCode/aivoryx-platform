import type { SecurityContext } from '../security/security-context.js';

export {
  isUniqueViolation,
  pageBounds,
  scope,
  type Paged,
  type TenantScope,
} from '../supply/common.js';

/**
 * Execution visibility (Phase 7, ADR 0036 §6/§17). A caller holding
 * `projects.execution.read` sees every project's execution workspace; a field
 * agent (who does not) sees only the projects where they are the assigned
 * installation agent or a defect assignee. Always resolved server-side, never
 * trusted from client input — mirrors the Phase 4 visit-visibility pattern.
 */
export interface ExecutionVisibility {
  canSeeAll: boolean;
}

export function executionVisibility(ctx: SecurityContext): ExecutionVisibility {
  return { canSeeAll: ctx.permissions.has('projects.execution.read') };
}
