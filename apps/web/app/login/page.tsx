'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { login, switchTenant } from '@/lib/api/admin';
import { ErrorNote, Field, PageHeader } from '@/components/admin/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await login(email.trim(), password);
      let hasWorkspace = !!me.active;
      if (!hasWorkspace) {
        const usable = me.memberships.find(
          (m) => m.status === 'active' && m.tenantStatus === 'active',
        );
        if (usable) {
          await switchTenant(usable.id);
          hasWorkspace = true;
        }
      }
      // A platform admin with no workspace lands in the platform console;
      // every tenant user continues to the workspace administration home.
      router.replace(!hasWorkspace && me.isPlatformAdmin ? '/platform' : '/admin');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-sm space-y-6">
      <PageHeader title="Sign in" description="Access your Aivoryx workspace administration." />
      <form onSubmit={onSubmit} className="space-y-4">
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <ErrorNote error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </section>
  );
}
