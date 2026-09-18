import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TabBar } from './tab-bar';

afterEach(cleanup);

const TABS = [
  { key: 'a', label: 'Alpha' },
  { key: 'b', label: 'Beta' },
  { key: 'c', label: 'Gamma' },
] as const;

describe('TabBar', () => {
  it('renders real ARIA tabs — a tablist of tabs, exactly one selected', () => {
    render(<TabBar tabs={[...TABS]} active="b" onChange={() => {}} />);

    expect(screen.getByRole('tablist')).toBeTruthy();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Gamma' }).getAttribute('aria-selected')).toBe('false');
  });

  it('gives only the selected tab a 0 tabindex (roving tabindex)', () => {
    render(<TabBar tabs={[...TABS]} active="a" onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Alpha' }).getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('tabindex')).toBe('-1');
    expect(screen.getByRole('tab', { name: 'Gamma' }).getAttribute('tabindex')).toBe('-1');
  });

  it('clicking a tab calls onChange with its key', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={[...TABS]} active="a" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Gamma' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('ArrowRight/ArrowLeft move selection to the next/previous tab, wrapping at the ends', () => {
    const onChange = vi.fn();
    render(<TabBar tabs={[...TABS]} active="a" onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('b');

    onChange.mockClear();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('c'); // wraps to the last tab
  });
});
