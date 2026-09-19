import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LeadPicker } from './lead-picker';

const useLeads = vi.fn();
vi.mock('@/lib/crm/use-crm', () => ({ useLeads: (p: unknown) => useLeads(p) }));

const LEADS = [
  { id: 'l1', name: 'Asha Rao', phone: '9000000001', status: 'NEW' },
  { id: 'l2', name: 'Vikram Singh', phone: '9000000002', status: 'QUALIFIED' },
  { id: 'l3', name: 'Closed Lead', phone: '9000000003', status: 'DISQUALIFIED' },
  { id: 'l4', name: 'Won Lead', phone: '9000000004', status: 'CONVERTED' },
];

beforeEach(() => {
  vi.useFakeTimers();
  useLeads.mockReturnValue({ data: { items: LEADS }, isLoading: false, error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('LeadPicker', () => {
  it('is a labelled combobox listing name, phone and status', () => {
    render(<LeadPicker label="Lead" value={null} onChange={() => {}} />);
    const box = screen.getByRole('combobox', { name: 'Lead' });
    fireEvent.focus(box);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Asha Rao9000000001new',
      'Vikram Singh9000000002qualified',
    ]);
  });

  it('never offers disqualified or converted leads', () => {
    render(<LeadPicker label="Lead" value={null} onChange={() => {}} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.queryByText('Closed Lead')).toBeNull();
    expect(screen.queryByText('Won Lead')).toBeNull();
  });

  it('selects with the keyboard', () => {
    const onChange = vi.fn();
    render(<LeadPicker label="Lead" value={null} onChange={onChange} />);
    const box = screen.getByRole('combobox');
    fireEvent.focus(box);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ id: 'l2', name: 'Vikram Singh' });
  });

  it('searches on the server, debounced, never asking for more than 8', () => {
    render(<LeadPicker label="Lead" value={null} onChange={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ash' } });
    expect(useLeads).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'ash' }));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(useLeads).toHaveBeenLastCalledWith({ q: 'ash', pageSize: 8 });
  });

  it('says so when nothing matches', () => {
    useLeads.mockReturnValue({ data: { items: [] }, isLoading: false, error: null });
    render(<LeadPicker label="Lead" value={null} onChange={() => {}} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('shows the chosen lead with a clear button', () => {
    const onChange = vi.fn();
    render(<LeadPicker label="Lead" value={{ id: 'l1', name: 'Asha Rao' }} onChange={onChange} />);
    expect(screen.getByTestId('lead-selected').textContent).toBe('Asha Rao');
    fireEvent.click(screen.getByRole('button', { name: /clear lead \(asha rao\)/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
