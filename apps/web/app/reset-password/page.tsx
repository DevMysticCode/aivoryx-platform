'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { Button } from '@aivoryx/ui';
import { ErrorNote } from '@/components/admin/ui';
import { PasswordField } from '@/components/auth/password-field';
import { AuthShell } from '@/components/auth-shell';
import { confirmPasswordReset } from '@/lib/api/admin';

const MIN_PASSWORD_LENGTH = 8;

/**
 * Complete a password reset with the one-time token from the email link.
 * Deliberately does NOT sign the user in afterward — the backend revokes
 * every existing session on a successful reset and returns no session
 * cookie, so a fresh, explicit sign-in with the new password is the correct
 * next step, not an automatic one.
 */
function ResetPasswordForm() {
  const token = useSearchParams().get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return; // no duplicate submissions
    setError(null);
    if (newPassword !== confirmPassword) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    setBusy(true);
    try {
      await confirmPasswordReset(token, newPassword);
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div
        role="status"
        className="rounded-lg border border-primary/30 bg-primary-soft p-4 text-sm"
      >
        <p className="font-medium">Your password has been reset.</p>
        <p className="mt-1 text-muted-foreground">
          For your security, every existing session on this account has been signed out.
        </p>
        <a href="/login" className="mt-3 inline-block font-medium text-primary hover:underline">
          Sign in
        </a>
      </div>
    );
  }

  if (!token) {
    return (
      <ErrorNote
        error={new Error('This password reset link is missing its token. Request a new one.')}
      />
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <PasswordField
        label="New password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        required
        value={newPassword}
        onChange={(e) => {
          setNewPassword(e.target.value);
          setMismatch(false);
        }}
      />
      <PasswordField
        label="Confirm new password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        required
        value={confirmPassword}
        onChange={(e) => {
          setConfirmPassword(e.target.value);
          setMismatch(false);
        }}
      />
      {mismatch ? (
        <p role="alert" className="text-sm text-danger">
          Passwords don&apos;t match.
        </p>
      ) : null}
      <ErrorNote error={error} />
      <Button type="submit" isLoading={busy} loadingText="Resetting…" className="w-full">
        Reset password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password">
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
