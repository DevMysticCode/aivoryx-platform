import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PasswordField } from './password-field';

afterEach(cleanup);

describe('PasswordField', () => {
  it('is masked by default and the toggle is labelled for the next action', () => {
    render(<PasswordField label="Password" defaultValue="s3cret" />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    expect(input.type).toBe('password');
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('show reveals, hide masks again, and aria state follows', () => {
    render(<PasswordField label="Password" defaultValue="s3cret" />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(hide);
    expect(input.type).toBe('password');
    expect(input.value).toBe('s3cret'); // value untouched
  });

  it('the toggle never submits the form and is a real button (keyboard reachable)', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <PasswordField label="Password" />
      </form>,
    );
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle.getAttribute('type')).toBe('button');
    fireEvent.click(toggle);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
