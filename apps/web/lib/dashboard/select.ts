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

export interface DashboardSectionGroup {
  /** undefined for widgets with no `section` (rendered without a heading) */
  section: string | undefined;
  widgets: DashboardWidget[];
}

/**
 * Group an already-selected, already-sorted widget list into visual sections
 * (Phase 13D §4), preserving priority order. A section heading only ever
 * appears when at least one of its widgets survived `selectDashboardWidgets` —
 * there is no separate "is this section visible" check to keep in sync.
 */
export function groupWidgetsBySection(
  widgets: readonly DashboardWidget[],
): DashboardSectionGroup[] {
  const groups: DashboardSectionGroup[] = [];
  for (const widget of widgets) {
    const last = groups[groups.length - 1];
    if (last && last.section === widget.section) {
      last.widgets.push(widget);
    } else {
      groups.push({ section: widget.section, widgets: [widget] });
    }
  }
  return groups;
}
