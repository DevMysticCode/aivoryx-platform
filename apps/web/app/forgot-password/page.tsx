'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { Field, ErrorNote } from '@/components/admin/ui';
import { AuthShell } from '@/components/auth-shell';
import { requestPasswordReset } from '@/lib/api/admin';

/**
 * Request a password reset. The response is always the same generic
 * confirmation whether or not the email belongs to an account — the backend
 * guarantees this (`PasswordResetService.requestReset`), so this page never
 * branches on anything that would reveal account existence. The only things
 * that can legitimately surface here are input validation and transient
 * failures (network, rate limiting) — neither discloses whether the account
 * exists.
 */
function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return; // no duplicate submissions
    setBusy(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div
        role="status"
        className="rounded-lg border border-primary/30 bg-primary-soft p-4 text-sm"
      >
        <p className="font-medium">Check your email</p>
        <p className="mt-1 text-muted-foreground">
          If an account exists for that address, we&apos;ve sent a link to reset your password. It
          expires in 1 hour.
        </p>
        <a href="/login" className="mt-3 inline-block font-medium text-primary hover:underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Enter the email address for your account and we&apos;ll send you a link to reset your
        password.
      </p>
      <Field
        label="Email"
        type="email"
        autoComplete="username"
        autoCapitalize="none"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <ErrorNote error={error} />
      <Button type="submit" isLoading={busy} loadingText="Sending…" className="w-full">
        Send reset link
      </Button>
      <a href="/login" className="block text-center text-sm text-muted-foreground hover:underline">
        Back to sign in
      </a>
    </form>
  );
}

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Reset your password" description="We'll email you a link to get back in.">
      <ForgotPasswordForm />
    </AuthShell>
  );
}
