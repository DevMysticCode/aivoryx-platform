'use client';

import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, LayoutDashboard, Plus, Search, Users } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import { listLeads } from '@/lib/api/crm';
import { listCustomers } from '@/lib/api/commercial';
import { useAccess } from '@/lib/navigation/use-access';

interface Command {
  id: string;
  label: string;
  hint?: string;
  group: 'Navigate' | 'Create' | 'Leads' | 'Customers' | 'Account';
  icon: ReactNode;
  run: () => void;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * The Cmd/Ctrl-K command palette (§21, §54). Every command is filtered by the
 * caller's entitlements + effective permissions — a "Create lead" command never
 * appears without CRM entitlement AND `crm.leads.create`.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const access = useAccess();
  const [queryText, setQueryText] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const debounced = useDebounced(queryText.trim(), 200);

  const go = useCallback(
    (href: string) => {
      onClose();
      router.push(href);
    },
    [onClose, router],
  );

  useEffect(() => {
    if (open) {
      setQueryText('');
      setActiveIndex(0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 10);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const canSearchLeads = access.hasModule('CRM') && access.can('crm.leads.read');
  const canSearchCustomers = access.hasModule('CRM') && access.can('customers.read');

  const leads = useQuery({
    queryKey: ['cmdk', 'leads', debounced],
    queryFn: () => listLeads({ q: debounced, pageSize: 6 }),
    enabled: open && canSearchLeads && debounced.length >= 2,
    staleTime: 10_000,
  });
  const customers = useQuery({
    queryKey: ['cmdk', 'customers', debounced],
    queryFn: () => listCustomers({ q: debounced, pageSize: 6 }),
    enabled: open && canSearchCustomers && debounced.length >= 2,
    staleTime: 10_000,
  });

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [];
    const nav = (id: string, label: string, href: string, icon: ReactNode): Command => ({
      id,
      label,
      group: 'Navigate',
      icon,
      run: () => go(href),
    });
    base.push(nav('nav-dashboard', 'Open Dashboard', '/', <LayoutDashboard className="size-4" />));
    if (access.hasModule('CRM')) {
      base.push(nav('nav-crm', 'Open CRM', '/crm', <Users className="size-4" />));
      if (access.can('crm.leads.read'))
        base.push(nav('nav-leads', 'Open Leads', '/crm/leads', <Users className="size-4" />));
    }
    if (access.isPlatformAdmin)
      base.push(
        nav('nav-platform', 'Open Platform', '/platform', <LayoutDashboard className="size-4" />),
      );
    base.push(
      nav(
        'nav-notifications',
        'Open Notifications',
        '/settings/notifications',
        <ArrowRight className="size-4" />,
      ),
    );

    if (access.hasModule('CRM') && access.can('crm.leads.create'))
      base.push({
        id: 'create-lead',
        label: 'Create Lead',
        group: 'Create',
        icon: <Plus className="size-4" />,
        run: () => go('/crm/leads?new=1'),
      });
    if (access.hasModule('CRM') && access.can('customers.create'))
      base.push({
        id: 'create-customer',
        label: 'Create Customer',
        group: 'Create',
        icon: <Plus className="size-4" />,
        run: () => go('/customers?new=1'),
      });
    if (access.hasModule('COMMERCIAL') && access.can('quotations.create'))
      base.push({
        id: 'create-quote',
        label: 'Create Quotation',
        group: 'Create',
        icon: <Plus className="size-4" />,
        run: () => go('/quotations?new=1'),
      });

    for (const lead of leads.data?.items ?? []) {
      base.push({
        id: `lead-${lead.id}`,
        label: lead.name ?? lead.phone ?? 'Untitled lead',
        hint: [lead.city, lead.status].filter(Boolean).join(' · '),
        group: 'Leads',
        icon: <Users className="size-4" />,
        run: () => go(`/crm/leads/${lead.id}`),
      });
    }
    for (const c of customers.data?.items ?? []) {
      base.push({
        id: `cust-${c.id}`,
        label: c.name,
        hint: c.number,
        group: 'Customers',
        icon: <Users className="size-4" />,
        run: () => go(`/customers/${c.id}`),
      });
    }
    return base;
  }, [access, leads.data, customers.data, go]);

  const filtered = useMemo(() => {
    const q = debounced.toLowerCase();
    if (!q) return commands.filter((c) => c.group === 'Navigate' || c.group === 'Create');
    return commands.filter(
      (c) =>
        c.group === 'Leads' ||
        c.group === 'Customers' ||
        c.label.toLowerCase().includes(q) ||
        c.hint?.toLowerCase().includes(q),
    );
  }, [commands, debounced]);

  useEffect(() => {
    setActiveIndex(0);
  }, [debounced, filtered.length]);

  if (!open) return null;

  const grouped = filtered.reduce<Record<string, Command[]>>((acc, c) => {
    (acc[c.group] ??= []).push(c);
    return acc;
  }, {});
  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-foreground/40 p-4 pt-[12vh] backdrop-blur-[1px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-xl border bg-background shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            ref={inputRef}
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                filtered[activeIndex]?.run();
              }
            }}
            placeholder="Search leads, customers, or type a command…"
            aria-controls={listId}
            aria-activedescendant={
              filtered[activeIndex] ? `cmd-${filtered[activeIndex].id}` : undefined
            }
            className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="hidden rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>
        <ul id={listId} role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches{debounced ? ` for “${debounced}”` : ''}.
            </li>
          ) : (
            Object.entries(grouped).map(([group, items]) => (
              <li key={group}>
                <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group}
                </p>
                <ul>
                  {items.map((c) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    return (
                      <li key={c.id}>
                        <button
                          id={`cmd-${c.id}`}
                          type="button"
                          role="option"
                          aria-selected={idx === activeIndex}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => c.run()}
                          className={cn(
                            'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm',
                            idx === activeIndex
                              ? 'bg-accent text-accent-foreground'
                              : 'text-foreground',
                          )}
                        >
                          <span className="text-muted-foreground">{c.icon}</span>
                          <span className="flex-1 truncate">{c.label}</span>
                          {c.hint ? (
                            <span className="truncate text-xs text-muted-foreground">{c.hint}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
