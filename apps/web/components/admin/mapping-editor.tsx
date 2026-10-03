'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@aivoryx/ui';
import { Field } from '@/components/admin/ui';

/**
 * Edits the existing flat `providerKey -> "canonical:<field>" | "custom:<key>" | "skip"`
 * dictionary (UC-4) — `mapping.ts` remains the resolution engine; this only edits the override
 * dictionary it already reads from `lead_sources.field_mapping`. The server re-validates every
 * target on save (`sources.service.ts`'s `validateFieldMapping`); this is a convenience editor,
 * not the authority.
 */
export function MappingEditor({
  value,
  onSave,
  pending,
}: {
  value: Record<string, string>;
  onSave: (next: Record<string, string>) => void;
  pending?: boolean;
}) {
  const [rows, setRows] = useState<{ key: string; target: string }[]>(
    Object.entries(value).map(([key, target]) => ({ key, target })),
  );

  const setRow = (i: number, patch: Partial<{ key: string; target: string }>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const next: Record<string, string> = {};
        for (const row of rows) {
          if (row.key.trim()) next[row.key.trim()] = row.target.trim();
        }
        onSave(next);
      }}
    >
      <p className="text-xs text-muted-foreground">
        Maps a field name from the provider&apos;s payload to a canonical lead field, a custom
        field, or &quot;skip&quot; to discard it. Fields not listed here keep the built-in defaults
        (common names like <code>phone</code>, <code>email</code>) and unmapped fields are still
        kept, never dropped.
      </p>
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex items-end gap-2">
            <div className="flex-1">
              <Field
                label={i === 0 ? 'Provider field' : ''}
                placeholder="contact_no"
                value={row.key}
                onChange={(e) => setRow(i, { key: e.target.value })}
              />
            </div>
            <div className="flex-1">
              <Field
                label={i === 0 ? 'Target' : ''}
                placeholder="canonical:phone | custom:vendorCode | skip"
                value={row.target}
                onChange={(e) => setRow(i, { target: e.target.value })}
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Remove mapping"
              onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="size-4" aria-hidden />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setRows((r) => [...r, { key: '', target: '' }])}
        >
          <Plus className="size-4" aria-hidden /> Add mapping
        </Button>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save mapping'}
        </Button>
      </div>
    </form>
  );
}
