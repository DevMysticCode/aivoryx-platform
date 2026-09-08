import type { DashboardWidget } from './types';

/**
 * Pure widget selection (Phase 13C §3) — the security-shaped decision, isolated
 * from React so it is unit-testable. A widget shows iff its module is entitled
 * AND every required permission is held; results come back sorted by priority.
 */
export function selectDashboardWidgets(
  widgets: readonly DashboardWidget[],
  access: { entitledModules: ReadonlySet<string>; permissions: ReadonlySet<string> },
): DashboardWidget[] {
  return widgets
    .filter(
      (w) =>
        (w.module === undefined || access.entitledModules.has(w.module)) &&
        (w.permissions ?? []).every((p) => access.permissions.has(p)),
    )
    .slice()
    .sort((a, b) => a.priority - b.priority);
}
