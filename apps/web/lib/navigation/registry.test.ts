import { describe, expect, it } from 'vitest';
import { filterEntries } from './use-navigation';
import { TENANT_NAV, entryMatchesPath } from './registry';

const view = (modules: string[], perms: string[]) =>
  filterEntries(
    TENANT_NAV,
    (p) => p === undefined || perms.includes(p),
    (m) => m === undefined || modules.includes(m),
  );

const keys = (entries: { key: string }[]) => entries.map((e) => e.key);

describe('navigation registry (module → section)', () => {
  it('is exactly two levels deep — a section never has children', () => {
    for (const e of TENANT_NAV)
      for (const c of e.children ?? []) expect(c.children).toBeUndefined();
  });

  it('an employee who can only reach "My HR" still sees HR, with only that section', () => {
    const nav = view(['HR'], ['hr.attendance.self']);
    const hr = nav.find((e) => e.key === 'hr');
    expect(hr?.children?.map((c) => c.key)).toEqual(['hr.me']);
    expect(hr?.href).toBe('/hr/me');
  });

  it('never shows a module the tenant is not entitled to, whatever the permissions', () => {
    const nav = view(['CRM'], ['hr.employee.read', 'finance.read', 'field.visits.read']);
    expect(keys(nav)).not.toContain('hr');
    expect(keys(nav)).not.toContain('finance');
    expect(keys(nav)).not.toContain('field');
  });

  it('drops a module whose sections are all forbidden', () => {
    const nav = view(['FINANCE'], []);
    expect(keys(nav)).not.toContain('finance');
  });

  it('a module links to the first section the caller can open', () => {
    const nav = view(['FINANCE'], ['finance.invoices.read']);
    expect(nav.find((e) => e.key === 'finance')?.href).toBe('/finance/invoices');
  });

  it('shows supply sections independently by permission', () => {
    const nav = view(['SUPPLY'], ['products.read', 'dispatch.read']);
    expect(nav.find((e) => e.key === 'supply')?.children?.map((c) => c.key)).toEqual([
      'supply.products',
      'supply.dispatches',
    ]);
  });
});

describe('entryMatchesPath', () => {
  it('an Overview entry is exact; siblings match by prefix', () => {
    const overview = { href: '/crm', exact: true };
    const leads = { href: '/crm/leads' };
    expect(entryMatchesPath(overview, '/crm')).toBe(true);
    expect(entryMatchesPath(overview, '/crm/leads')).toBe(false);
    expect(entryMatchesPath(leads, '/crm/leads/abc')).toBe(true);
    expect(entryMatchesPath(leads, '/crm/leadsx')).toBe(false);
  });
});
