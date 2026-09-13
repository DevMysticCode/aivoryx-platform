import type { ComponentType } from 'react';
import type { ModuleKey } from '@aivoryx/shared';

/**
 * A dashboard widget definition (Phase 13C §3). A widget renders only when its
 * module is entitled AND the user holds every `permission`. The renderer owns
 * its own data fetch (via that module's existing hooks) — the dashboard
 * framework never imports a business service.
 *
 * A future module contributes a widget by pushing an entry into
 * `DASHBOARD_WIDGETS` (lib/dashboard/registry.tsx); the dashboard page does not
 * change.
 */
export interface DashboardWidget {
  /** stable key — also the test id */
  key: string;
  /** module the widget belongs to; undefined = always-available (e.g. quick actions) */
  module?: ModuleKey;
  /** every effective permission the user must hold */
  permissions?: string[];
  title: string;
  /** column span on the 12-col desktop grid (mobile is always full width) */
  span: 3 | 4 | 6 | 12;
  /** ascending — lower renders first */
  priority: number;
  Component: ComponentType;
  /**
   * The visual section a widget belongs to (Phase 13D §4) — e.g. "Key Metrics",
   * "Attention Required". Widgets are grouped by this label, in the order the
   * first widget of each section appears once sorted by `priority`; a section
   * with no surviving widgets (after entitlement/permission filtering) simply
   * does not render its heading. Omit for a widget that stands alone.
   */
  section?: string;
}
