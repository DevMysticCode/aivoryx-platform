import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Users } from 'lucide-react';
import {
  DashboardActionCenter,
  DashboardCard,
  DashboardEmptyState,
  DashboardKpiCard,
  DashboardKpiGrid,
  DashboardList,
  DashboardListItem,
  DashboardQuickActions,
  TONE,
} from './index';

afterEach(cleanup);

describe('DashboardKpiCard', () => {
  it('shows the real value and supporting text, and NO comparison unless one is passed', () => {
    const { container } = render(
      <DashboardKpiCard label="Total leads" value={5} icon={Users} description="7 active" />,
    );
    expect(screen.getByText('Total leads')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('7 active')).toBeTruthy();
    expect(container.textContent).not.toMatch(/%|vs /);
  });

  it('renders a comparison only from the caller-supplied real delta, with a text equivalent', () => {
    render(
      <DashboardKpiCard
        label="New this week"
        value={5}
        icon={Users}
        delta={{ changePct: 25, label: 'vs prior week' }}
      />,
    );
    expect(screen.getByText('vs prior week')).toBeTruthy();
    expect(screen.getByText(/25%/).textContent).toMatch(/increase/);
  });

  it('an increase can be the bad direction (e.g. absences)', () => {
    const { container } = render(
      <DashboardKpiCard
        label="Absent"
        value={3}
        icon={Users}
        delta={{ changePct: 50, label: 'vs yesterday', upIsGood: false }}
      />,
    );
    expect(container.innerHTML).toContain('text-danger');
    expect(container.innerHTML).not.toContain('text-success');
  });

  it('empty value renders an em dash with the empty text, not a fabricated number', () => {
    render(
      <DashboardKpiCard
        label="Outstanding"
        value={null}
        icon={Users}
        emptyText="No invoices raised yet"
        description="should not show"
      />,
    );
    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByText('No invoices raised yet')).toBeTruthy();
    expect(screen.queryByText('should not show')).toBeNull();
  });

  it('loading shows a busy skeleton and no value', () => {
    const { container } = render(
      <DashboardKpiCard label="Total" value={9} icon={Users} isLoading />,
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(screen.queryByText('9')).toBeNull();
  });

  it('is a real link when it has a destination', () => {
    render(<DashboardKpiCard label="Leads" value={1} icon={Users} href="/crm/leads" />);
    expect(screen.getByRole('link').getAttribute('href')).toBe('/crm/leads');
  });

  it('lays out 1 / 2 / 4 columns through the grid classes', () => {
    const { container } = render(
      <DashboardKpiGrid>
        <span />
      </DashboardKpiGrid>,
    );
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain('grid-cols-1');
    expect(cls).toContain('sm:grid-cols-2');
    expect(cls).toContain('xl:grid-cols-4');
  });

  it('every tone uses theme tokens only (no raw colours) so dark mode and tenant themes apply', () => {
    for (const t of Object.values(TONE)) {
      for (const cls of Object.values(t)) {
        expect(cls).not.toMatch(/#|rgb|\b(white|black|slate|gray|zinc|amber-\d|emerald-\d)\b/);
      }
    }
  });
});

describe('DashboardActionCenter', () => {
  const icon = Users;
  it('emphasises rows that need attention, links rows that have a destination', () => {
    render(
      <DashboardActionCenter
        items={[
          { key: 'a', label: 'Overdue', count: 3, icon, tone: 'red', href: '/x' },
          { key: 'b', label: 'Upcoming', count: 0, icon },
        ]}
      />,
    );
    expect(screen.getByRole('link', { name: /Overdue/ }).getAttribute('href')).toBe('/x');
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Upcoming/ })).toBeNull();
  });

  it('says so when nothing needs doing instead of rendering a wall of zeros', () => {
    render(<DashboardActionCenter items={[{ key: 'a', label: 'Overdue', count: 0, icon }]} />);
    expect(screen.getByText('All clear')).toBeTruthy();
    expect(screen.queryByText('Overdue')).toBeNull();
  });
});

describe('cards, lists, quick actions, empty states', () => {
  it('DashboardCard renders its title as a heading and an optional link', () => {
    render(
      <DashboardCard title="Pipeline" href="/crm/leads" linkLabel="All leads">
        body
      </DashboardCard>,
    );
    expect(screen.getByRole('heading', { name: 'Pipeline' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /All leads/ }).getAttribute('href')).toBe('/crm/leads');
  });

  it('list items show an initial avatar and are links only with an href', () => {
    render(
      <DashboardList>
        <DashboardListItem title="Ravi Menon" subtitle="Manual" href="/crm/leads/1" />
        <DashboardListItem title="Static row" />
      </DashboardList>,
    );
    expect(screen.getByText('R')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('quick actions render nothing when the caller passes none (nothing unauthorised is shown)', () => {
    const { container } = render(<DashboardQuickActions actions={[]} />);
    expect(container.textContent).toBe('');
  });

  it('empty state explains and offers an action', () => {
    render(
      <DashboardEmptyState
        title="No data"
        description="Nothing yet"
        action={<button type="button">Add</button>}
      />,
    );
    expect(screen.getByText('No data')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add' })).toBeTruthy();
  });
});
