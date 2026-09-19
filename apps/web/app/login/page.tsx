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
import { platformAssetHref, usePlatformBranding } from '@/lib/branding/use-branding';
import { resolveBranding } from '@aivoryx/shared';

function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const workspace = useSearchParams().get('workspace');
  const { branding, isLoading } = usePublicLoginBranding(workspace);
  const platform = usePlatformBranding();
  // ONE resolver: tenant branding (when the workspace is known) over platform branding over defaults
  const resolved = resolveBranding(
    platform,
    branding
      ? {
          displayName: branding.displayName,
          themePreset: branding.themePreset,
          primaryColor: branding.primaryColor,
          secondaryColor: branding.secondaryColor,
          accentColor: branding.accentColor,
          hasLoginLogo: branding.hasLogo,
          welcomeMessage: branding.welcomeMessage,
          description: branding.description,
          showPoweredBy: branding.showPoweredBy,
        }
      : null,
  );
  const themeCss = resolved.theme ? themeCssFor(resolved.theme) : null;
  const ref = resolved.logo('login', 'light');
  const logoUrl =
    ref?.source === 'tenant' && branding
      ? publicLoginLogoUrl(branding.slug)
      : platformAssetHref(ref, platform);
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
      title={resolved.login.heading || 'Sign in'}
      description={
        resolved.login.text ||
        (branding
          ? `Sign in to ${branding.displayName}.`
          : `Access your ${resolved.name} workspace.`)
      }
      brand={{
        displayName: resolved.name,
        logoUrl,
        showPoweredBy: !!branding && resolved.login.showPoweredBy,
        tenantBranded: !!branding,
      }}
      footer="Trouble signing in? Ask your workspace administrator to reset your access."
    >
      {themeCss ? <style data-aivoryx-brand="">{themeCss}</style> : null}
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
