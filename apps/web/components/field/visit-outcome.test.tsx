import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { VisitOutcomeBadge, VisitOutcomeForm, visitOutcomeLabel } from './visit-outcome';

afterEach(cleanup);

describe('VisitOutcomeForm', () => {
  it('completes with no outcome at all — the existing flow is unchanged', () => {
    const onSubmit = vi.fn();
    render(<VisitOutcomeForm pending={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark visit complete' }));
    expect(onSubmit).toHaveBeenCalledWith({});
  });

  it('offers exactly the three Field outcomes as a labelled radio group', () => {
    render(<VisitOutcomeForm pending={false} onSubmit={() => {}} />);
    expect(screen.getByRole('group', { name: /visit outcome/i })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => (r as HTMLInputElement).value)).toEqual([
      'SUITABLE',
      'NOT_SUITABLE',
      'FOLLOW_UP_REQUIRED',
    ]);
  });

  it('submits the chosen outcome with a trimmed note', () => {
    const onSubmit = vi.fn();
    render(<VisitOutcomeForm pending={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('radio', { name: /^suitable/i }));
    fireEvent.change(screen.getByLabelText('Outcome note'), { target: { value: '  Good roof  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark visit complete' }));
    expect(onSubmit).toHaveBeenCalledWith({ outcome: 'SUITABLE', outcomeNote: 'Good roof' });
  });

  it('asks when the follow-up is due only for FOLLOW_UP_REQUIRED, and sends an ISO date', () => {
    const onSubmit = vi.fn();
    render(<VisitOutcomeForm pending={false} onSubmit={onSubmit} />);
    expect(screen.queryByLabelText(/follow-up due/i)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /follow-up required/i }));
    fireEvent.change(screen.getByLabelText(/follow-up due/i), {
      target: { value: '2030-05-06T10:00' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark visit complete' }));
    const body = onSubmit.mock.calls[0]![0] as { outcome: string; followUpDueAt: string };
    expect(body.outcome).toBe('FOLLOW_UP_REQUIRED');
    expect(body.followUpDueAt).toMatch(/^2030-05-06T/);
  });

  it('a chosen outcome can be cleared, and the button is guarded while pending', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<VisitOutcomeForm pending={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole('radio', { name: /not suitable/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear outcome' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark visit complete' }));
    expect(onSubmit).toHaveBeenCalledWith({});
    rerender(<VisitOutcomeForm pending onSubmit={onSubmit} />);
    expect(
      (screen.getByRole('button', { name: /completing/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('VisitOutcomeBadge', () => {
  it('renders a readable label, and nothing when there is no outcome', () => {
    const { container, rerender } = render(<VisitOutcomeBadge outcome="FOLLOW_UP_REQUIRED" />);
    expect(screen.getByText('Follow-up required')).toBeTruthy();
    rerender(<VisitOutcomeBadge outcome={null} />);
    expect(container.textContent).toBe('');
    expect(visitOutcomeLabel('NOT_SUITABLE')).toBe('Not suitable');
    expect(visitOutcomeLabel(undefined)).toBe('');
  });
});
