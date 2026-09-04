'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { AcceptInvitationResponse } from '@aivoryx/contracts';
import { Button } from '@aivoryx/ui';
import { apiFetch } from '@/lib/api/client';
import { ErrorNote, Field, PageHeader } from '@/components/admin/ui';

function AcceptInvitationForm() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<AcceptInvitationResponse | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<AcceptInvitationResponse>('/auth/accept-invitation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password: password || undefined,
          name: name.trim() || undefined,
        }),
      });
      setDone(res);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm">
        <p className="font-medium">You&apos;re all set.</p>
        <p className="mt-1 text-muted-foreground">
          Your account for <span className="font-mono">{done.email}</span> is active in workspace{' '}
          <span className="font-mono">{done.tenantSlug}</span>. You can now{' '}
          <a href="/login" className="font-medium text-primary hover:underline">
            sign in
          </a>
          .
        </p>
      </div>
    );
  }

  if (!token) {
    return <ErrorNote error={new Error('This invitation link is missing its token.')} />;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Choose a password to finish setting up your account. If your account already has a password,
        leave it blank.
      </p>
      <Field
        label="Password"
        type="password"
        autoComplete="new-password"
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Field label="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
      <ErrorNote error={error} />
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Accepting…' : 'Accept invitation'}
      </Button>
    </form>
  );
}

export default function AcceptInvitationPage() {
  return (
    <section className="mx-auto max-w-sm space-y-6">
      <PageHeader title="Accept your invitation" />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <AcceptInvitationForm />
      </Suspense>
    </section>
  );
}
