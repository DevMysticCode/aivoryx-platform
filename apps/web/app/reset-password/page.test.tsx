import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api/client';

const api = vi.hoisted(() => ({
  confirmPasswordReset: vi.fn(),
}));
const search = vi.hoisted(() => ({ token: 'a-valid-looking-token' }));

vi.mock('@/lib/api/admin', () => ({ confirmPasswordReset: api.confirmPasswordReset }));
vi.mock('@/lib/branding/use-branding', () => ({
  usePlatformBranding: () => null,
  platformAssetHref: () => null,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(search.token ? { token: search.token } : {}),
}));

import ResetPasswordPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  search.token = 'a-valid-looking-token';
});

const fillAndSubmit = (newPassword: string, confirmPassword: string) => {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: newPassword } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), {
    target: { value: confirmPassword },
  });
  fireEvent.click(screen.getByRole('button', { name: /reset password/i }));
};

describe('ResetPasswordPage', () => {
  it('submits the token from the URL and the new password, then shows success with no auto-login', async () => {
    api.confirmPasswordReset.mockResolvedValue({ ok: true });
    render(<ResetPasswordPage />);

    fillAndSubmit('Brand-New-Passw0rd!', 'Brand-New-Passw0rd!');

    await waitFor(() =>
      expect(api.confirmPasswordReset).toHaveBeenCalledWith(
        'a-valid-looking-token',
        'Brand-New-Passw0rd!',
      ),
    );
    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch('Your password has been reset.');
    const link = screen.getByRole('link', { name: /sign in/i });
    expect(link.getAttribute('href')).toBe('/login');
  });

  it('blocks submission and shows a mismatch error when the two password fields differ', async () => {
    render(<ResetPasswordPage />);
    fillAndSubmit('First-Passw0rd!', 'Different-Passw0rd!');

    expect((await screen.findByRole('alert')).textContent).toMatch(/don't match/i);
    expect(api.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('surfaces an invalid/expired/used token as a safe error, not a crash', async () => {
    api.confirmPasswordReset.mockRejectedValue(
      new ApiError(400, {
        error: {
          code: 'PASSWORD_RESET_INVALID',
          message: 'This password reset link is not valid or has expired.',
          correlationId: 'AIV-2',
        },
      }),
    );
    render(<ResetPasswordPage />);
    fillAndSubmit('Brand-New-Passw0rd!', 'Brand-New-Passw0rd!');

    expect((await screen.findByRole('alert')).textContent).toMatch(/not valid or has expired/i);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows an explicit message and never calls the API when the token is missing from the URL', () => {
    search.token = '';
    render(<ResetPasswordPage />);
    expect(screen.getByRole('alert').textContent).toMatch(/missing its token/i);
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(api.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('does not allow a second submission while the first is in flight', async () => {
    let resolve!: () => void;
    api.confirmPasswordReset.mockReturnValue(
      new Promise((res) => {
        resolve = () => res({ ok: true });
      }),
    );
    render(<ResetPasswordPage />);
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'Brand-New-Passw0rd!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm new password'), {
      target: { value: 'Brand-New-Passw0rd!' },
    });
    const button = screen.getByRole('button', { name: /reset password/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    resolve();
    await waitFor(() => expect(api.confirmPasswordReset).toHaveBeenCalledTimes(1));
  });

  it('never writes the token or the new password to localStorage or sessionStorage', async () => {
    api.confirmPasswordReset.mockResolvedValue({ ok: true });
    render(<ResetPasswordPage />);
    fillAndSubmit('Super-Secret-Passw0rd!', 'Super-Secret-Passw0rd!');
    await waitFor(() => expect(api.confirmPasswordReset).toHaveBeenCalled());

    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)!;
        const value = store.getItem(key) ?? '';
        expect(value).not.toContain('a-valid-looking-token');
        expect(value).not.toContain('Super-Secret-Passw0rd!');
      }
    }
  });
});
