import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ManagerPicker } from './manager-picker';

const useEmployees = vi.fn();
vi.mock('@/lib/hr/use-hr', () => ({ useEmployees: (f: unknown) => useEmployees(f) }));

const PEOPLE = [
  { id: 'e1', displayName: 'Asha Rao', employeeNumber: 'EMP-000001' },
  { id: 'e2', displayName: 'Vikram Singh', employeeNumber: 'EMP-000002' },
  { id: 'e3', displayName: 'Neha Kulkarni', employeeNumber: 'EMP-000003' },
];

beforeEach(() => {
  vi.useFakeTimers();
  useEmployees.mockReturnValue({ data: { items: PEOPLE }, isLoading: false, error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('ManagerPicker', () => {
  it('is a labelled combobox that opens a listbox of options', () => {
    render(<ManagerPicker label="Reporting manager" value={null} onChange={() => {}} />);
    const box = screen.getByRole('combobox', { name: 'Reporting manager' });
    expect(box.getAttribute('aria-expanded')).toBe('false');
    fireEvent.focus(box);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Asha RaoEMP-000001',
      'Vikram SinghEMP-000002',
      'Neha KulkarniEMP-000003',
    ]);
  });

  it('selects with the keyboard: ArrowDown moves, Enter chooses', () => {
    const onChange = vi.fn();
    render(<ManagerPicker label="Reporting manager" value={null} onChange={onChange} />);
    const box = screen.getByRole('combobox');
    fireEvent.focus(box);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ id: 'e2', name: 'Vikram Singh' });
  });

  it('Escape closes the list without choosing', () => {
    const onChange = vi.fn();
    render(<ManagerPicker label="Reporting manager" value={null} onChange={onChange} />);
    const box = screen.getByRole('combobox');
    fireEvent.focus(box);
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never offers the employee being edited as their own manager', () => {
    render(
      <ManagerPicker label="Reporting manager" value={null} onChange={() => {}} excludeId="e2" />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.queryByText('Vikram Singh')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('searches on the server, debounced, and never asks for more than 8 people', () => {
    render(<ManagerPicker label="Reporting manager" value={null} onChange={() => {}} />);
    const box = screen.getByRole('combobox');
    fireEvent.change(box, { target: { value: 'nei' } });
    // not yet — still inside the debounce window
    expect(useEmployees).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'nei' }));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(useEmployees).toHaveBeenLastCalledWith({ q: 'nei', status: 'ACTIVE', pageSize: 8 });
  });

  it('says so when nothing matches', () => {
    useEmployees.mockReturnValue({ data: { items: [] }, isLoading: false, error: null });
    render(<ManagerPicker label="Reporting manager" value={null} onChange={() => {}} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('shows the chosen manager with a clear button that resets the value', () => {
    const onChange = vi.fn();
    render(
      <ManagerPicker
        label="Reporting manager"
        value={{ id: 'e1', name: 'Asha Rao' }}
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId('manager-selected').textContent).toBe('Asha Rao');
    fireEvent.click(screen.getByRole('button', { name: /clear reporting manager \(asha rao\)/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
