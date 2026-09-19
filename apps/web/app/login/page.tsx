'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@aivoryx/ui';
import { login, switchTenant } from '@/lib/api/admin';
import { ErrorNote, Field } from '@/components/admin/ui';
import { AuthShell } from '@/components/auth-shell';
import { themeCssFor } from '@/components/brand-provider';
import { publicLoginLogoUrl } from '@/lib/api/public';
import { usePublicLoginBranding } from '@/lib/settings/use-public-branding';

function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const workspace = useSearchParams().get('workspace');
  const { branding, isLoading } = usePublicLoginBranding(workspace);
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
      // never carry another sign-in's cached identity into this session
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'public' });
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
    <AuthShell
      title={branding?.welcomeMessage || 'Sign in'}
      description={
        branding?.description ||
        (branding ? `Sign in to ${branding.displayName}.` : 'Access your Aivoryx workspace.')
      }
      brand={
        branding
          ? {
              displayName: branding.displayName,
              logoUrl: branding.hasLogo ? publicLoginLogoUrl(branding.slug) : null,
              showPoweredBy: branding.showPoweredBy,
            }
          : null
      }
      footer="Trouble signing in? Ask your workspace administrator to reset your access."
    >
      {branding ? <style data-aivoryx-brand="">{themeCssFor(branding) ?? ''}</style> : null}
      {isLoading ? (
        <span className="sr-only" role="status">
          Loading workspace…
        </span>
      ) : null}
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
        <Button type="submit" isLoading={busy} loadingText="Signing in…" className="w-full">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
