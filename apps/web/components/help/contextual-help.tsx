'use client';

import { ExternalLink } from 'lucide-react';
import { GLOSSARY, type GlossaryKey } from '@/lib/help/glossary';
import { helpUrl } from '@/lib/help/topics';
import { InfoPopover } from './info-popover';

/**
 * Contextual help for a domain concept, driven by the shared glossary so the
 * same definition reads the same everywhere (Data scope in Administration and in
 * HR, visit outcomes in Field and CRM, …). Shows a "Learn more" link only when a
 * docs site is configured.
 */
export function ContextualHelp({
  concept,
  align,
}: {
  concept: GlossaryKey;
  align?: 'start' | 'end';
}) {
  const entry = GLOSSARY[concept] as {
    title: string;
    intro?: string;
    items: readonly { term: string; description: string }[];
    topic?: Parameters<typeof helpUrl>[0];
  };
  const url = entry.topic ? helpUrl(entry.topic) : null;
  return (
    <InfoPopover label={`About ${entry.title.toLowerCase()}`} align={align}>
      <p className="font-medium">{entry.title}</p>
      {entry.intro ? <p className="mt-0.5 text-muted-foreground">{entry.intro}</p> : null}
      <dl className="mt-2 space-y-1.5">
        {entry.items.map((i) => (
          <div key={i.term}>
            <dt className="font-medium">{i.term}</dt>
            <dd className="text-muted-foreground">{i.description}</dd>
          </div>
        ))}
      </dl>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-2 inline-flex items-center gap-1 font-medium text-primary hover:underline"
        >
          Learn more
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ) : null}
    </InfoPopover>
  );
}
