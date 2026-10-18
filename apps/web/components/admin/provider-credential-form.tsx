'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import type { ProviderCredentialField } from '@aivoryx/contracts';
import { Field } from '@/components/admin/ui';

/**
 * Renders a credential form purely from `ProviderMeta.credentialFields` (UC-4) — never a
 * hardcoded per-provider field list. Every declared field is required: the backend
 * (`ConnectorCredentialsService.set()`) always REPLACES THE ENTIRE stored credential blob, with
 * no partial merge, so there is no such thing as "leaving a field unchanged" here — a save with
 * any field blank would silently erase that field's previously-stored value. `ProviderMeta`
 * currently has no concept of an optional credential field (every provider — Meta included —
 * declares only required ones); if a future provider's metadata ever adds one, this component's
 * required-ness check must read that flag instead of treating every field as required.
 *
 * To make the destructive case impossible rather than merely documented: Save stays disabled
 * until every field has a non-empty value, and the submit handler re-checks the same condition
 * (a user could otherwise force a submit via Enter in some browsers even with the button
 * disabled).
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

  const isComplete = fields.every((f) => (values[f.key] ?? '').trim().length > 0);

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!isComplete) return;
        const data = Object.fromEntries(fields.map((f) => [f.key, values[f.key]!.trim()]));
        onSubmit(data);
      }}
    >
      <p className="text-xs text-muted-foreground">
        Saving replaces the complete credential set for this connection — every field below must be
        filled in, even to change just one of them. Values are write-only: once saved, they are
        never shown again, and this form never pre-fills a previously-stored value.
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
      <Button type="submit" size="sm" disabled={pending || !isComplete}>
        {pending ? 'Saving…' : 'Save credentials'}
      </Button>
    </form>
  );
}
