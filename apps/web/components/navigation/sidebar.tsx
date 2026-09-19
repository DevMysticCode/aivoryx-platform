'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Tooltip, cn } from '@aivoryx/ui';
import { BrandMark } from '@/components/brand-mark';
import { entryMatchesPath, type NavEntry } from '@/lib/navigation/registry';

const COLLAPSE_KEY = 'aivoryx.sidebar.collapsed';

/** Sidebar collapsed state, remembered per browser. */
export function useSidebarCollapsed(): [boolean, (v: boolean) => void] {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* default expanded */
    }
  }, []);
  const set = useCallback((v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0');
    } catch {
      /* not persisted */
    }
  }, []);
  return [collapsed, set];
}

/** The most specific section of `entry` that matches the path (exact Overviews win). */
function activeSection(entry: NavEntry, pathname: string): NavEntry | undefined {
  return (entry.children ?? [])
    .filter((c) => entryMatchesPath(c, pathname))
    .sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))[0];
}

const itemBase =
  'group relative flex items-center gap-2.5 rounded-md text-sm transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus';
const itemIdle = 'text-sidebar-muted hover:bg-sidebar-active/60 hover:text-sidebar-foreground';
// active = subtle tint + accent text + a thin left indicator (no saturated pill)
const itemActive =
  'bg-sidebar-active font-medium text-sidebar-active-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-primary';

/**
 * The Option C adaptive sidebar (Phase 19): light neutral in light mode, navy in
 * dark, a restrained tinted active state, and a collapsible icon rail whose
 * items expose accessible tooltips. Two levels only — module → section.
 */
export function Sidebar({
  entries,
  pathname,
  collapsed,
  onToggleCollapsed,
  platformRoute,
}: {
  entries: NavEntry[];
  pathname: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  platformRoute: boolean;
}) {
  return (
    <aside
      data-tour="sidebar"
      data-collapsed={collapsed || undefined}
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150 md:flex',
        collapsed ? 'w-[3.75rem]' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center border-b border-sidebar-border',
          collapsed ? 'justify-center px-2' : 'px-4',
        )}
      >
        <BrandMark platformRoute={platformRoute} compact={collapsed} />
      </div>

      <nav
        aria-label="Primary"
        className="flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden p-2"
      >
        {entries.map((entry) =>
          collapsed ? (
            <RailItem key={entry.key} entry={entry} pathname={pathname} />
          ) : (
            <ExpandedItem key={entry.key} entry={entry} pathname={pathname} />
          ),
        )}
      </nav>

      {platformRoute && !collapsed ? (
        <div className="border-t border-sidebar-border px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-sidebar-muted">
          Platform administration
        </div>
      ) : null}

      <div className={cn('border-t border-sidebar-border p-2', collapsed && 'flex justify-center')}>
        <Tooltip label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} side="right">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className={cn(
              itemBase,
              itemIdle,
              collapsed ? 'size-9 justify-center' : 'w-full px-3 py-2',
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" aria-hidden />
            ) : (
              <>
                <PanelLeftClose className="size-4 shrink-0" aria-hidden />
                <span>Collapse</span>
              </>
            )}
          </button>
        </Tooltip>
      </div>
    </aside>
  );
}

function ExpandedItem({ entry, pathname }: { entry: NavEntry; pathname: string }) {
  const Icon = entry.icon;
  const sections = entry.children ?? [];
  const current = sections.length ? activeSection(entry, pathname) : undefined;
  const moduleActive = sections.length ? !!current : entryMatchesPath(entry, pathname);
  const [open, setOpen] = useState(moduleActive);
  const panelId = useId();

  // navigating into a module (e.g. from search) opens its sections
  useEffect(() => {
    if (moduleActive) setOpen(true);
  }, [moduleActive]);

  if (sections.length === 0) {
    return (
      <Link
        href={entry.href ?? '#'}
        aria-current={moduleActive ? 'page' : undefined}
        className={cn(itemBase, 'px-3 py-2', moduleActive ? itemActive : itemIdle)}
      >
        <Icon className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{entry.label}</span>
      </Link>
    );
  }

  return (
    <div>
      <div className="flex items-center">
        <Link
          href={entry.href ?? '#'}
          className={cn(
            itemBase,
            'min-w-0 flex-1 px-3 py-2',
            moduleActive ? 'font-medium text-sidebar-foreground' : itemIdle,
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{entry.label}</span>
        </Link>
        <button
          type="button"
          aria-label={open ? `Collapse ${entry.label}` : `Expand ${entry.label}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((v) => !v)}
          className={cn(itemBase, itemIdle, 'size-8 shrink-0 justify-center')}
        >
          <ChevronRight
            className={cn('size-3.5 transition-transform', open && 'rotate-90')}
            aria-hidden
          />
        </button>
      </div>
      {open ? (
        <ul
          id={panelId}
          className="mb-1 ml-[1.15rem] mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2"
        >
          {sections.map((s) => {
            const active = current?.key === s.key;
            return (
              <li key={s.key}>
                <Link
                  href={s.href ?? '#'}
                  aria-current={active ? 'page' : undefined}
                  className={cn(itemBase, 'px-2.5 py-1.5', active ? itemActive : itemIdle)}
                >
                  <span className="truncate">{s.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function RailItem({ entry, pathname }: { entry: NavEntry; pathname: string }) {
  const Icon = entry.icon;
  const sections = entry.children ?? [];
  const active = sections.length
    ? !!activeSection(entry, pathname)
    : entryMatchesPath(entry, pathname);
  const cls = cn(itemBase, 'mx-auto size-9 justify-center', active ? itemActive : itemIdle);

  if (sections.length === 0) {
    return (
      <Tooltip label={entry.label} side="right">
        <Link
          href={entry.href ?? '#'}
          aria-label={entry.label}
          aria-current={active ? 'page' : undefined}
          className={cls}
        >
          <Icon className="size-[1.05rem]" aria-hidden />
        </Link>
      </Tooltip>
    );
  }
  return <RailFlyout entry={entry} pathname={pathname} active={active} className={cls} />;
}

/** A module in the collapsed rail: an icon button that opens its sections. */
function RailFlyout({
  entry,
  pathname,
  active,
  className,
}: {
  entry: NavEntry;
  pathname: string;
  active: boolean;
  className: string;
}) {
  const Icon = entry.icon;
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = activeSection(entry, pathname);

  const toggle = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setPos({ x: r.right + 8, y: r.top });
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>('a')?.focus();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <Tooltip label={entry.label} side="right" disabled={open}>
        <button
          ref={btn}
          type="button"
          aria-label={entry.label}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={toggle}
          className={cn(className, active && 'font-medium')}
        >
          <Icon className="size-[1.05rem]" aria-hidden />
        </button>
      </Tooltip>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panel}
              id={id}
              role="navigation"
              aria-label={entry.label}
              style={{ position: 'fixed', left: pos.x, top: pos.y }}
              className="z-[70] min-w-48 rounded-lg border bg-surface-raised p-1 shadow-lg"
            >
              <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-subtle">
                {entry.label}
              </p>
              {(entry.children ?? []).map((s) => (
                <Link
                  key={s.key}
                  href={s.href ?? '#'}
                  onClick={() => setOpen(false)}
                  aria-current={current?.key === s.key ? 'page' : undefined}
                  className={cn(
                    'flex items-center rounded-md px-2.5 py-1.5 text-sm hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                    current?.key === s.key && 'bg-primary-soft font-medium text-primary',
                  )}
                >
                  {s.label}
                </Link>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
