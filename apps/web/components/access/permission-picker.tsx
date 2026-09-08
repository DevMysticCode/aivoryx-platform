'use client';

import { useMemo } from 'react';
import { cn } from '@aivoryx/ui';
import type { AvailablePermission } from '@aivoryx/contracts';

/**
 * A permission chooser grouped by module (§14/§15). Only entitled-module
 * permissions and platform permissions are ever offered — the list comes from
 * `GET /admin/access/available-permissions`, which the server already filters.
 * Raw permission keys are shown only as secondary metadata.
 */
export function PermissionPicker({
  available,
  selected,
  onChange,
}: {
  available: AvailablePermission[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const groups = useMemo(() => {
    const byModule = new Map<string, AvailablePermission[]>();
    for (const p of available) {
      const key = p.module ?? 'Platform';
      const list = byModule.get(key) ?? [];
      list.push(p);
      byModule.set(key, list);
    }
    return [...byModule.entries()].sort(([a], [b]) =>
      a === 'Platform' ? 1 : b === 'Platform' ? -1 : a.localeCompare(b),
    );
  }, [available]);

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  const toggleGroup = (keys: string[], allOn: boolean) => {
    const next = new Set(selected);
    for (const k of keys) {
      if (allOn) next.delete(k);
      else next.add(k);
    }
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {groups.map(([module, perms]) => {
        const keys = perms.map((p) => p.key);
        const onCount = keys.filter((k) => selected.has(k)).length;
        const allOn = onCount === keys.length;
        return (
          <fieldset key={module} className="rounded-lg border">
            <legend className="sr-only">{module}</legend>
            <div className="flex items-center justify-between border-b bg-secondary/30 px-3 py-2">
              <span className="text-sm font-medium">{module}</span>
              <button
                type="button"
                onClick={() => toggleGroup(keys, allOn)}
                className="text-xs font-medium text-primary hover:underline"
              >
                {allOn ? 'Clear all' : `Select all (${keys.length})`}
              </button>
            </div>
            <ul className="divide-y">
              {perms.map((p) => {
                const on = selected.has(p.key);
                return (
                  <li key={p.key}>
                    <label className="flex cursor-pointer items-start gap-2.5 px-3 py-2 hover:bg-accent/40">
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(p.key)}
                        className="mt-0.5 size-4 rounded border-input"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm">
                          <span className="font-medium capitalize">
                            {p.resource.replace(/[._]/g, ' ')}
                          </span>
                          <span className={cn('ml-1.5 text-muted-foreground')}>
                            — {p.action.replace(/[._]/g, ' ')}
                          </span>
                        </span>
                        <span className="block text-xs text-muted-foreground">{p.description}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
