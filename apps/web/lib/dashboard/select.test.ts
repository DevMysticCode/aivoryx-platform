import { describe, expect, it } from 'vitest';
import { groupWidgetsBySection, selectDashboardWidgets } from './select';
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

describe('groupWidgetsBySection', () => {
  const sectioned: DashboardWidget[] = [
    w({ key: 'a', priority: 0, section: 'Key Metrics' }),
    w({ key: 'b', priority: 1, section: 'Key Metrics' }),
    w({ key: 'c', priority: 2, section: 'Attention' }),
    w({ key: 'lonely', priority: 3 }),
  ];

  it('groups consecutive same-section widgets under one heading, preserving order', () => {
    const groups = groupWidgetsBySection(sectioned);
    expect(groups.map((g) => [g.section, g.widgets.map((x) => x.key)])).toEqual([
      ['Key Metrics', ['a', 'b']],
      ['Attention', ['c']],
      [undefined, ['lonely']],
    ]);
  });

  it('a section with zero surviving widgets never appears (filter first, then group)', () => {
    const survivors = sectioned.filter((x) => x.key !== 'c'); // "Attention" entirely filtered out
    const groups = groupWidgetsBySection(survivors);
    expect(groups.some((g) => g.section === 'Attention')).toBe(false);
  });

  it('an empty widget list groups to an empty array', () => {
    expect(groupWidgetsBySection([])).toEqual([]);
  });
});
