'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button, cn } from '@aivoryx/ui';

export interface Snippet {
  label: string;
  code: string;
}

/**
 * Reusable multi-language code sample viewer (UC-4 Developer tab). Deliberately plain
 * `<pre>` + Tailwind — no syntax-highlighting dependency for one feature (CLAUDE.md §17 /
 * explicit UC-4 scope). Callers pass already-rendered snippet strings; this component only
 * handles the tab switch and the copy-to-clipboard affordance.
 */
export function CodeSnippet({ snippets }: { snippets: Snippet[] }) {
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);
  const current = snippets[active];

  return (
    <div className="space-y-2">
      <div className="flex gap-1 border-b">
        {snippets.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => {
              setActive(i);
              setCopied(false);
            }}
            className={cn(
              '-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors',
              i === active
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="relative">
        <pre className="max-h-80 overflow-auto rounded-lg border bg-background p-3 font-mono text-xs">
          {current?.code}
        </pre>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="absolute right-2 top-2"
          onClick={async () => {
            if (!current) return;
            await navigator.clipboard.writeText(current.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? (
            <>
              <Check className="size-3.5" aria-hidden /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" aria-hidden /> Copy
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
