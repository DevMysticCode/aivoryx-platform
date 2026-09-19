'use client';

import { useState } from 'react';
import { Button } from '@aivoryx/ui';
import { Badge, type Tone } from '@/components/ui/status-badge';
import { ContextualHelp } from '@/components/help/contextual-help';
import type { CompleteVisitRequest } from '@aivoryx/contracts';

/** Visit outcomes (Phase 18) — the three that fit the Field domain. Field owns them; CRM surfaces them. */
export const VISIT_OUTCOMES = [
  {
    value: 'SUITABLE',
    label: 'Suitable',
    hint: 'A good fit — ready for a quotation.',
  },
  {
    value: 'NOT_SUITABLE',
    label: 'Not suitable',
    hint: 'The site or customer is not a fit.',
  },
  {
    value: 'FOLLOW_UP_REQUIRED',
    label: 'Follow-up required',
    hint: 'Creates a follow-up for the lead owner in CRM.',
  },
] as const;

export type VisitOutcomeValue = (typeof VISIT_OUTCOMES)[number]['value'];

export function visitOutcomeLabel(outcome: string | null | undefined): string {
  return VISIT_OUTCOMES.find((o) => o.value === outcome)?.label ?? '';
}

const TONE: Record<string, Tone> = {
  SUITABLE: 'success',
  NOT_SUITABLE: 'muted',
  FOLLOW_UP_REQUIRED: 'warning',
};

/** A small status pill for a recorded outcome; renders nothing when there is none. */
export function VisitOutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  if (!outcome) return null;
  return <Badge tone={TONE[outcome] ?? 'neutral'}>{visitOutcomeLabel(outcome) || outcome}</Badge>;
}

/**
 * The completion form: an optional structured outcome + note, then the final
 * "Mark complete" action. Recording an outcome is optional (the existing
 * completion flow is unchanged); when the agent picks "Follow-up required" they
 * may also say when it is due (CRM creates the follow-up if it is enabled).
 */
export function VisitOutcomeForm({
  pending,
  disabled,
  onSubmit,
}: {
  pending: boolean;
  disabled?: boolean;
  onSubmit: (body: CompleteVisitRequest) => void;
}) {
  const [outcome, setOutcome] = useState<VisitOutcomeValue | ''>('');
  const [note, setNote] = useState('');
  const [due, setDue] = useState('');

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...(outcome ? { outcome } : {}),
          ...(note.trim() ? { outcomeNote: note.trim() } : {}),
          ...(outcome === 'FOLLOW_UP_REQUIRED' && due
            ? { followUpDueAt: new Date(due).toISOString() }
            : {}),
        });
      }}
    >
      <fieldset className="space-y-2">
        <legend className="flex items-center gap-1.5 text-sm font-medium">
          Visit outcome (optional)
          <ContextualHelp concept="visitOutcome" />
        </legend>
        {VISIT_OUTCOMES.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
          >
            <input
              type="radio"
              name="visit-outcome"
              className="mt-0.5"
              value={o.value}
              checked={outcome === o.value}
              onChange={() => setOutcome(o.value)}
            />
            <span>
              <span className="font-medium">{o.label}</span>
              <span className="block text-xs text-muted-foreground">{o.hint}</span>
            </span>
          </label>
        ))}
        {outcome ? (
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setOutcome('')}
          >
            Clear outcome
          </button>
        ) : null}
      </fieldset>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Outcome note</span>
        <textarea
          className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What did you find? What should the office know?"
        />
      </label>
      {outcome === 'FOLLOW_UP_REQUIRED' ? (
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Follow-up due</span>
          <input
            type="datetime-local"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <span className="block text-xs text-muted-foreground">
            Leave empty for two days from now.
          </span>
        </label>
      ) : null}
      <Button
        type="submit"
        isLoading={pending}
        loadingText="Completing…"
        disabled={disabled || pending}
      >
        Mark visit complete
      </Button>
    </form>
  );
}
