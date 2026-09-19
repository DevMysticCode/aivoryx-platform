import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { InfoPopover } from './info-popover';
import { ContextualHelp } from './contextual-help';
import { FeatureTourHost } from './feature-tour';
import { helpTopicForPath, searchHelpTopics } from '@/lib/help/topics';
import { startTour } from '@/lib/help/tours';

afterEach(cleanup);

describe('InfoPopover', () => {
  it('toggles with aria-expanded and closes on Escape', () => {
    render(<InfoPopover label="About x">Explained</InfoPopover>);
    const btn = screen.getByRole('button', { name: 'About x' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Explained')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Explained')).toBeNull();
  });
});

describe('ContextualHelp', () => {
  it('explains all four data scopes from the shared glossary', () => {
    render(<ContextualHelp concept="dataScope" />);
    fireEvent.click(screen.getByRole('button', { name: /about data scope/i }));
    for (const term of ['Own', 'Team', 'Department', 'Company']) {
      expect(screen.getByText(term)).toBeTruthy();
    }
  });
});

describe('help topics', () => {
  it('search matches title and summary; route → topic mapping', () => {
    expect(searchHelpTopics('leave').map((r) => r.key)).toContain('hr.leave');
    expect(searchHelpTopics('zzzz')).toEqual([]);
    expect(helpTopicForPath('/crm/visits/abc')).toBe('field.visits');
    expect(helpTopicForPath('/admin/access')).toBe('admin.access');
    expect(helpTopicForPath('/')).toBe('start.navigation');
  });
});

describe('FeatureTourHost', () => {
  it('runs a short tour, steps through it, and can be skipped', () => {
    render(<FeatureTourHost />);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => startTour('workspace'));
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toMatch(/step 1 of 4/);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toMatch(/step 2 of 4/);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
