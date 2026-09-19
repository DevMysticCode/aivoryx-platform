'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button, cn } from '@aivoryx/ui';
import { useEmployees } from '@/lib/hr/use-hr';

export interface ManagerValue {
  id: string;
  name: string;
}

const MAX_RESULTS = 8;
const DEBOUNCE_MS = 250;

/**
 * Server-searched reporting-manager picker. Never loads more than 8 rows, so it works
 * at any directory size (the old <select> only saw the current directory page).
 * ARIA 1.2 combobox: input[role=combobox] + listbox, active option via aria-activedescendant.
 */
export function ManagerPicker({
  label,
  value,
  onChange,
  excludeId,
}: {
  label: string;
  value: ManagerValue | null;
  onChange: (next: ManagerValue | null) => void;
  excludeId?: string;
}) {
  const uid = useId();
  const inputId = `${uid}-input`;
  const listId = `${uid}-list`;
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // typing is debounced; an emptied box resets immediately
    const t = setTimeout(() => setQ(text.trim()), text ? DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [text]);

  const search = useEmployees({ q: q || undefined, status: 'ACTIVE', pageSize: MAX_RESULTS });
  const options = (search.data?.items ?? []).filter((e) => e.id !== excludeId);

  const choose = (o: { id: string; displayName: string }) => {
    onChange({ id: o.id, name: o.displayName });
    setText('');
    setQ('');
    setOpen(false);
  };

  if (value) {
    return (
      <div className="space-y-1.5">
        <span className="text-sm font-medium">{label}</span>
        <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-input px-3 text-sm">
          <span className="min-w-0 truncate" data-testid="manager-selected">
            {value.name}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Clear ${label.toLowerCase()} (${value.name})`}
            onClick={() => {
              onChange(null);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
          >
            Clear
          </Button>
        </div>
      </div>
    );
  }

  const activeId = open && options[active] ? `${listId}-${options[active].id}` : undefined;

  return (
    <div className="relative space-y-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        placeholder="Search by name or number"
        value={text}
        className={cn(
          'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        )}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, Math.max(options.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter') {
            if (open && options[active]) {
              e.preventDefault();
              choose(options[active]);
            }
          } else if (e.key === 'Escape') {
            if (open) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }
        }}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={`${label} results`}
        hidden={!open}
        className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md"
      >
        {search.isLoading && <li className="px-2 py-1.5 text-muted-foreground">Searching…</li>}
        {search.error ? (
          <li className="px-2 py-1.5 text-danger">Search failed. Try again.</li>
        ) : null}
        {!search.isLoading && !search.error && options.length === 0 && (
          <li className="px-2 py-1.5 text-muted-foreground">No matches</li>
        )}
        {options.map((o, i) => (
          <li
            key={o.id}
            id={`${listId}-${o.id}`}
            role="option"
            aria-selected={i === active}
            // mousedown fires before the input blur that would close the list
            onMouseDown={(e) => {
              e.preventDefault();
              choose(o);
            }}
            onMouseEnter={() => setActive(i)}
            className={cn(
              'flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5',
              i === active && 'bg-accent',
            )}
          >
            <span className="min-w-0 truncate">{o.displayName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{o.employeeNumber}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
