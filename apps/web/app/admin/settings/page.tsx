'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@aivoryx/ui';
import { useTenant, useUpdateTenant } from '@/lib/admin/use-admin';
import { Card, ErrorNote, Field, PageHeader, Skeleton } from '@/components/admin/ui';

export default function WorkspaceSettingsPage() {
  const tenant = useTenant();
  const update = useUpdateTenant();
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (tenant.data) setName(tenant.data.name);
  }, [tenant.data]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    await update.mutateAsync(name.trim());
    setSaved(true);
  }

  return (
    <section className="space-y-6">
      <PageHeader
        title="Workspace settings"
        description="Only the workspace name can be edited here. The slug and status are managed by the platform."
      />

      {tenant.isLoading ? (
        <Skeleton rows={2} />
      ) : tenant.error ? (
        <ErrorNote error={tenant.error} />
      ) : (
        <Card>
          <form onSubmit={onSubmit} className="max-w-md space-y-4">
            <Field
              label="Workspace name"
              hint="An internal identifier, shown to Aivoryx platform administrators — not the name your team sees in the app."
              required
              minLength={1}
              maxLength={200}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Looking to change the name and logo your team sees throughout the app? That's set
              separately under{' '}
              <Link href="/settings/company" className="text-primary hover:underline">
                Settings → Company profile &amp; branding
              </Link>
              .
            </p>
            <ErrorNote error={update.error} />
            <div className="flex items-center gap-3">
              <Button
                type="submit"
                disabled={
                  update.isPending || name.trim().length === 0 || name === tenant.data?.name
                }
              >
                {update.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              {saved ? <span className="text-sm text-primary">Saved.</span> : null}
            </div>
          </form>
        </Card>
      )}
    </section>
  );
}
