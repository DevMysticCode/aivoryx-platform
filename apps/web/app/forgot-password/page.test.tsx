import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api/client';

const api = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
}));
vi.mock('@/lib/api/admin', () => ({ requestPasswordReset: api.requestPasswordReset }));
vi.mock('@/lib/branding/use-branding', () => ({
  usePlatformBranding: () => null,
  platformAssetHref: () => null,
}));

import ForgotPasswordPage from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ForgotPasswordPage', () => {
  it('shows the identical generic confirmation after a successful request, never account-specific text', async () => {
    api.requestPasswordReset.mockResolvedValue({ ok: true });
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'someone@test.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    await waitFor(() => expect(api.requestPasswordReset).toHaveBeenCalledWith('someone@test.test'));
    expect((await screen.findByRole('status')).textContent).toMatch('Check your email');
    // the confirmation never echoes the submitted address or implies existence either way
    expect(screen.queryByText('someone@test.test')).toBeNull();
  });

  it('shows a generic confirmation even when the backend throws AUTH-unrelated errors is never asserted — only a safe failure (e.g. rate limit) surfaces as an error, not a success', async () => {
    api.requestPasswordReset.mockRejectedValue(
      new ApiError(429, {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many password reset requests for this account.',
          correlationId: 'AIV-1',
        },
      }),
    );
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@test.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(
      /too many password reset requests/i,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a network-failure message without claiming success', async () => {
    api.requestPasswordReset.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@test.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not allow a second submission while the first is in flight', async () => {
    let resolve!: () => void;
    api.requestPasswordReset.mockReturnValue(
      new Promise((res) => {
        resolve = () => res({ ok: true });
      }),
    );
    render(<ForgotPasswordPage />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@test.test' } });
    const button = screen.getByRole('button', { name: /send reset link/i });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    resolve();
    await waitFor(() => expect(api.requestPasswordReset).toHaveBeenCalledTimes(1));
  });

  it('provides a link back to sign-in', () => {
    render(<ForgotPasswordPage />);
    const link = screen.getByRole('link', { name: /back to sign in/i });
    expect(link.getAttribute('href')).toBe('/login');
  });

  it('never writes the submitted email to localStorage or sessionStorage', async () => {
    api.requestPasswordReset.mockResolvedValue({ ok: true });
    render(<ForgotPasswordPage />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'private@test.test' } });
    fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() => expect(api.requestPasswordReset).toHaveBeenCalled());

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!;
      expect(localStorage.getItem(key)).not.toContain('private@test.test');
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i)!;
      expect(sessionStorage.getItem(key)).not.toContain('private@test.test');
    }
  });
});
