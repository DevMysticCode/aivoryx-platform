'use client';

import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { BookOpen, ExternalLink, LifeBuoy, Play, Search } from 'lucide-react';
import { Sheet } from '@/components/ui/overlays';
import {
  HELP_CATEGORIES,
  HELP_TOPICS,
  type HelpTopicKey,
  docsHomeUrl,
  helpTopicForPath,
  helpUrl,
  searchHelpTopics,
  supportMailto,
} from '@/lib/help/topics';
import { TOURS, startTour } from '@/lib/help/tours';

/**
 * The in-app Help Center: search, "help for this page", short guides by area,
 * tours, and links out to the documentation site / support. It is a thin index —
 * the documentation itself lives on the external site (topics carry a stable
 * path), so no docs platform is embedded here.
 */
export function HelpCenter({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname() ?? '/';
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchHelpTopics(query), [query]);
  const here = helpTopicForPath(pathname);
  const docs = docsHomeUrl();
  const support = supportMailto();

  return (
    <Sheet open={open} onClose={onClose} title="Help" size="md">
      <div className="space-y-5 p-2">
        <label className="relative block">
          <span className="sr-only">Search help</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help"
            className="h-9 w-full rounded-md border border-input bg-surface pl-9 pr-3 text-sm placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
        </label>

        {query.trim() ? (
          <TopicList
            heading={`${results.length} result${results.length === 1 ? '' : 's'}`}
            keys={results.map((r) => r.key)}
          />
        ) : (
          <>
            <TopicList heading="Help for this page" keys={[here]} />
            <section aria-labelledby="help-tours" className="space-y-2">
              <h3
                id="help-tours"
                className="text-xs font-semibold uppercase tracking-wide text-subtle"
              >
                Quick tours
              </h3>
              <ul className="space-y-1">
                {TOURS.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        // let the sheet unmount before the tour highlights the page
                        window.setTimeout(() => startTour(t.id), 50);
                      }}
                      className="flex w-full items-start gap-2.5 rounded-md p-2 text-left hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    >
                      <Play className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <span>
                        <span className="block text-sm font-medium">{t.title}</span>
                        <span className="block text-xs text-muted-foreground">{t.description}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            {HELP_CATEGORIES.map((category) => {
              const keys = (Object.keys(HELP_TOPICS) as HelpTopicKey[]).filter(
                (k) => HELP_TOPICS[k].category === category,
              );
              return keys.length ? (
                <TopicList key={category} heading={category} keys={keys} />
              ) : null;
            })}
          </>
        )}

        {docs || support ? (
          <div className="space-y-1 border-t pt-3 text-sm">
            {docs ? (
              <a
                href={docs}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-2 rounded-md p-2 hover:bg-surface-hover"
              >
                <BookOpen className="size-4 text-muted-foreground" aria-hidden />
                Documentation
                <ExternalLink className="ml-auto size-3.5 text-subtle" aria-hidden />
              </a>
            ) : null}
            {support ? (
              <a
                href={support}
                className="flex items-center gap-2 rounded-md p-2 hover:bg-surface-hover"
              >
                <LifeBuoy className="size-4 text-muted-foreground" aria-hidden />
                Contact support
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

function TopicList({ heading, keys }: { heading: string; keys: HelpTopicKey[] }) {
  if (keys.length === 0) {
    return <p className="px-1 text-sm text-muted-foreground">No help topics match your search.</p>;
  }
  return (
    <section className="space-y-2" aria-label={heading}>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle">{heading}</h3>
      <ul className="space-y-1">
        {keys.map((key) => {
          const topic = HELP_TOPICS[key];
          const url = helpUrl(key);
          return (
            <li key={key} className="rounded-md p-2 hover:bg-surface-hover">
              <p className="text-sm font-medium">{topic.title}</p>
              <p className="text-xs text-muted-foreground">{topic.summary}</p>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  Read the guide
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
