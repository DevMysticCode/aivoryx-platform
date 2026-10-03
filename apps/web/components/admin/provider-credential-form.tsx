'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import type { ProviderCredentialField } from '@aivoryx/contracts';
import { Field } from '@/components/admin/ui';

/**
 * Renders a credential form purely from `ProviderMeta.credentialFields` (UC-4) — never a
 * hardcoded per-provider field list. Every field is a secret: it never shows a previously-stored
 * value (the backend never returns one either) and is submitted only if the admin typed a new
 * value, so saving does not accidentally blank out an unrelated field.
 */
export function ProviderCredentialForm({
  fields,
  onSubmit,
  pending,
}: {
  fields: readonly ProviderCredentialField[];
  onSubmit: (data: Record<string, string>) => void;
  pending?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const data = Object.fromEntries(
          Object.entries(values).filter(([, v]) => v.trim().length > 0),
        );
        onSubmit(data);
      }}
    >
      <p className="text-xs text-muted-foreground">
        Replaces the entire credential set for this connection. Values are write-only — never shown
        again after saving, and left unchanged here unless you type a new one.
      </p>
      {fields.map((f) => (
        <Field
          key={f.key}
          label={f.label}
          type={f.secret ? 'password' : 'text'}
          autoComplete="off"
          value={values[f.key] ?? ''}
          onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
        />
      ))}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Save credentials'}
      </Button>
    </form>
  );
}
