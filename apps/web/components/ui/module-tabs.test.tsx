import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Gauge, Users } from 'lucide-react';
import { ModuleTabs } from './module-tabs';

// This vitest config has no global RTL setup file (no other component tests
// exist yet to have needed one) — clean up the DOM between tests locally.
afterEach(cleanup);

describe('ModuleTabs', () => {
  it('renders every item as a link with its href and label', () => {
    render(
      <ModuleTabs
        items={[
          { href: '/crm', label: 'Overview', icon: Gauge, current: true },
          { href: '/crm/leads', label: 'Leads', icon: Users, current: false },
          { href: '/customers', label: 'Customers', current: false },
          { href: '/crm/visits', label: 'Visits', current: false },
        ]}
      />,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/crm');
    expect(screen.getByRole('link', { name: 'Leads' }).getAttribute('href')).toBe('/crm/leads');
    expect(screen.getByRole('link', { name: 'Customers' }).getAttribute('href')).toBe('/customers');
    expect(screen.getByRole('link', { name: 'Visits' }).getAttribute('href')).toBe('/crm/visits');
  });

  it('marks exactly the current item with aria-current="page"', () => {
    render(
      <ModuleTabs
        items={[
          { href: '/crm', label: 'Overview', current: false },
          { href: '/crm/leads', label: 'Leads', current: true },
        ]}
      />,
    );

    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('link', { name: 'Leads' }).getAttribute('aria-current')).toBe('page');
  });

  it('renders as a single non-wrapping scrollable row, never a wrapped list', () => {
    const { container } = render(
      <ModuleTabs
        items={[
          { href: '/a', label: 'Alpha', current: false },
          { href: '/b', label: 'Beta', current: false },
          { href: '/c', label: 'Gamma', current: false },
          { href: '/d', label: 'Delta', current: false },
        ]}
      />,
    );

    const row = container.querySelector('.overflow-x-auto');
    expect(row).not.toBeNull();
    expect(row?.className).toContain('flex');
    expect(row?.className).not.toContain('flex-wrap');
    for (const link of screen.getAllByRole('link')) {
      expect(link.className).toContain('shrink-0');
    }
  });

  it('renders without crashing when ResizeObserver is unavailable (e.g. this test environment)', () => {
    expect(typeof ResizeObserver).toBe('undefined');
    expect(() =>
      render(<ModuleTabs items={[{ href: '/crm', label: 'Overview', current: true }]} />),
    ).not.toThrow();
  });
});
