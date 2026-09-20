'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@aivoryx/ui';
import { Field } from '@/components/admin/ui';
import { PasswordField } from '@/components/auth/password-field';
import {
  SIGN_IN_MESSAGES,
  classifySignInFailure,
  signIn,
  type SignInError,
} from '@/lib/auth/sign-in';
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
  const [error, setError] = useState<SignInError | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return; // no duplicate submissions (double tap / Enter + click)
    setBusy(true);
    setError(null);
    try {
      // login -> verify the session cookie round-trips -> resolve the workspace. Only then navigate.
      const { me, hasWorkspace } = await signIn(email.trim(), password);
      // never carry another sign-in's cached identity into this session
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'public' });
      // A platform admin with no workspace lands in the platform console;
      // every tenant user continues to the workspace administration home.
      router.replace(!hasWorkspace && me.isPlatformAdmin ? '/platform' : '/admin');
    } catch (err) {
      // stay on the page, keep the email AND password so a recoverable failure is one tap to retry
      setError(classifySignInFailure(err));
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
          autoCapitalize="none"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? (
          <div
            role="alert"
            data-error-kind={error.kind}
            className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm"
          >
            <p className="font-medium text-danger">{SIGN_IN_MESSAGES[error.kind]}</p>
            {error.correlationId ? (
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                Reference: {error.correlationId}
              </p>
            ) : null}
          </div>
        ) : null}
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
