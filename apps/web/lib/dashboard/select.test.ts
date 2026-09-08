import { describe, expect, it } from 'vitest';
import { selectDashboardWidgets } from './select';
import type { DashboardWidget } from './types';

const noop = () => null;
const w = (over: Partial<DashboardWidget>): DashboardWidget => ({
  key: 'k',
  title: 't',
  span: 6,
  priority: 0,
  Component: noop,
  ...over,
});

const WIDGETS: DashboardWidget[] = [
  w({ key: 'quick', priority: 0 }),
  w({ key: 'crm', module: 'CRM', permissions: ['crm.leads.read'], priority: 20 }),
  w({ key: 'crm-early', module: 'CRM', permissions: ['crm.leads.read'], priority: 10 }),
  w({ key: 'hr', module: 'HR', permissions: ['hr.organization.read'], priority: 30 }),
  w({ key: 'finance', module: 'FINANCE', permissions: ['finance.read'], priority: 40 }),
];

describe('selectDashboardWidgets', () => {
  it('drops a widget whose module is not entitled, even with the permission', () => {
    const out = selectDashboardWidgets(WIDGETS, {
      entitledModules: new Set(['CRM']),
      permissions: new Set(['crm.leads.read', 'hr.organization.read', 'finance.read']),
    });
    expect(out.map((x) => x.key)).toEqual(['quick', 'crm-early', 'crm']);
  });

  it('drops a widget whose permission is missing, even with the module', () => {
    const out = selectDashboardWidgets(WIDGETS, {
      entitledModules: new Set(['CRM', 'HR', 'FINANCE']),
      permissions: new Set(['crm.leads.read']),
    });
    expect(out.map((x) => x.key).sort()).toEqual(['crm', 'crm-early', 'quick']);
  });

  it('module-less widgets are always kept', () => {
    const out = selectDashboardWidgets(WIDGETS, {
      entitledModules: new Set(),
      permissions: new Set(),
    });
    expect(out.map((x) => x.key)).toEqual(['quick']);
  });

  it('returns widgets sorted by priority', () => {
    const out = selectDashboardWidgets(WIDGETS, {
      entitledModules: new Set(['CRM', 'HR', 'FINANCE']),
      permissions: new Set(['crm.leads.read', 'hr.organization.read', 'finance.read']),
    });
    expect(out.map((x) => x.priority)).toEqual([0, 10, 20, 30, 40]);
  });

  it('a CRM-only tenant never sees HR or Finance widgets', () => {
    const out = selectDashboardWidgets(WIDGETS, {
      entitledModules: new Set(['CRM', 'SUPPLY']),
      permissions: new Set([
        'crm.leads.read',
        'hr.organization.read', // held, but HR not entitled
        'finance.read',
      ]),
    });
    expect(out.some((x) => x.key === 'hr' || x.key === 'finance')).toBe(false);
  });
});
