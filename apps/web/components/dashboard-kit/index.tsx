'use client';

import Link from 'next/link';
import type { ComponentType, ReactNode } from 'react';
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight, Minus } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import { Badge, type Tone } from '@/components/ui/status-badge';
import { TONE, type DashboardTone } from './tones';

export { TONE, type DashboardTone } from './tones';

/**
 * The shared dashboard system (Phase 20). Every module dashboard (CRM, HR and
 * whatever comes next) composes these instead of styling its own cards. Rules
 * baked in:
 *  - tokens only (light/dark and tenant themes come for free);
 *  - restrained: subtle tints, thin borders, no gradients / glass / heavy shadows;
 *  - honest: nothing here computes or invents a number. A KPI shows a comparison
 *    ONLY when the caller passes one, and the caller must only do so when the API
 *    actually returned the comparison.
 */

type Icon = ComponentType<{ className?: string }>;

// ---- shell / header / section --------------------------------------------

export function DashboardShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('space-y-6 md:space-y-7', className)}>{children}</div>;
}

export function DashboardHeader({
  title,
  description,
  controls,
  actions,
}: {
  title: string;
  description?: string;
  /** e.g. a date-range toggle */
  controls?: ReactNode;
  /** primary / secondary buttons */
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {controls || actions ? (
        <div className="flex flex-wrap items-center gap-2">
          {controls}
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function DashboardSection({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-label={label} className={cn('space-y-3', className)}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</h2>
      {children}
    </section>
  );
}

/** A 12-col responsive grid for the operational / analysis layers. */
export function DashboardGrid({
  children,
  cols = 3,
  className,
}: {
  children: ReactNode;
  /** columns on wide screens; always 1 on phones, 2 on tablets when cols>=3 */
  cols?: 2 | 3;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4',
        cols === 2 ? 'lg:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

// ---- KPI -------------------------------------------------------------------

export interface KpiDelta {
  /** the real, API-provided percentage change */
  changePct: number;
  /** what it is compared with — must describe the real comparison, e.g. "vs prior week" */
  label: string;
  /** false when an increase is bad (e.g. absences); default true */
  upIsGood?: boolean;
}

export function DashboardKpiGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

function DeltaText({ delta }: { delta: KpiDelta }) {
  const up = delta.changePct > 0;
  const down = delta.changePct < 0;
  const good = delta.upIsGood === false ? down : up;
  const bad = delta.upIsGood === false ? up : down;
  const Arrow = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return (
    <p className="flex flex-wrap items-center gap-x-1 text-xs tabular-nums">
      <span
        className={cn(
          'inline-flex items-center gap-0.5 font-semibold',
          good && 'text-success',
          bad && 'text-danger',
          !good && !bad && 'text-muted-foreground',
        )}
      >
        <Arrow className="size-3.5" aria-hidden />
        {Math.abs(delta.changePct)}%
        <span className="sr-only">{up ? ' increase' : down ? ' decrease' : ' no change'}</span>
      </span>
      <span className="text-muted-foreground">{delta.label}</span>
    </p>
  );
}

/**
 * The KPI card: compact white surface, small label top-left, a tinted icon chip
 * top-right, a large value, then one supporting line (real data) and - only when
 * the API supplied one - a comparison. `variant="tinted"` fills the card with the
 * tone's soft tint for "needs attention" style tiles.
 */
export function DashboardKpiCard({
  label,
  value,
  icon: IconCmp,
  tone = 'teal',
  description,
  delta,
  status,
  href,
  isLoading,
  emptyText,
  variant = 'default',
}: {
  label: string;
  /** the real value; `null`/`undefined` renders an em dash */
  value: ReactNode;
  icon: Icon;
  tone?: DashboardTone;
  /** supporting text from real data, e.g. "23 active · 1 onboarding" */
  description?: ReactNode;
  /** OMIT unless the API returned the comparison */
  delta?: KpiDelta | null;
  status?: { label: string; tone: Tone };
  href?: string;
  isLoading?: boolean;
  /** shown instead of `description` when the value is empty */
  emptyText?: string;
  variant?: 'default' | 'tinted';
}) {
  const t = TONE[tone];
  const empty = value === null || value === undefined || value === '';
  const tinted = variant === 'tinted';
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-[13px] font-medium text-muted-foreground">{label}</p>
          {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
        </div>
        <span
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-lg',
            tinted ? 'bg-surface/70' : t.chip,
            t.text,
          )}
        >
          <IconCmp className="size-[1.15rem]" aria-hidden />
        </span>
      </div>
      {isLoading ? (
        <div className="mt-2 space-y-2" aria-busy="true">
          <div className="h-8 w-20 animate-pulse rounded-md bg-secondary motion-reduce:animate-none" />
          <div className="h-3 w-32 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
        </div>
      ) : (
        <div className="mt-1.5 space-y-1">
          <p
            className={cn(
              'text-[1.75rem] font-semibold leading-none tabular-nums tracking-tight',
              tinted && t.text,
            )}
          >
            {empty ? '—' : value}
          </p>
          {delta ? <DeltaText delta={delta} /> : null}
          {(empty ? emptyText : description) ? (
            <p className="text-xs text-muted-foreground">{empty ? emptyText : description}</p>
          ) : null}
        </div>
      )}
    </>
  );
  const cls = cn(
    'group relative block rounded-lg border p-4',
    tinted ? cn(t.chip, t.border) : 'bg-surface shadow-sm shadow-foreground/[0.03]',
  );
  return href ? (
    <Link
      href={href}
      className={cn(
        cls,
        'transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ---- cards -----------------------------------------------------------------

export function DashboardCard({
  title,
  description,
  icon: IconCmp,
  tone = 'teal',
  action,
  href,
  linkLabel = 'Open',
  children,
  footer,
  className,
  padded = true,
}: {
  title: string;
  description?: string;
  icon?: Icon;
  tone?: DashboardTone;
  /** arbitrary header-right content (wins over href/linkLabel) */
  action?: ReactNode;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** false for lists that run edge to edge */
  padded?: boolean;
}) {
  const t = TONE[tone];
  return (
    <section
      className={cn(
        'flex min-w-0 flex-col rounded-xl border bg-surface shadow-sm shadow-foreground/[0.03]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3 px-4 pb-1 pt-3.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {IconCmp ? (
            <span
              className={cn('grid size-7 shrink-0 place-items-center rounded-md', t.chip, t.text)}
            >
              <IconCmp className="size-3.5" aria-hidden />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>
            {description ? (
              <p className="truncate text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {action ??
          (href ? (
            <Link
              href={href}
              className="inline-flex shrink-0 items-center gap-1 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {linkLabel}
              <ArrowRight className="size-3" aria-hidden />
            </Link>
          ) : null)}
      </div>
      <div className={cn('flex-1', padded ? 'p-4 pt-3' : 'pt-2')}>{children}</div>
      {footer ? <div className="border-t border-border-subtle px-4 py-2.5">{footer}</div> : null}
    </section>
  );
}

/** A card that holds a chart (kept separate so chart cards can gain shared behaviour). */
export function DashboardChartCard(props: Parameters<typeof DashboardCard>[0]) {
  return <DashboardCard {...props} />;
}

// ---- lists -----------------------------------------------------------------

export function DashboardList({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border-subtle">{children}</ul>;
}

export function DashboardListItem({
  title,
  subtitle,
  href,
  leading,
  trailing,
  tone = 'teal',
  initial,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  /** custom leading node; otherwise an avatar with `initial` */
  leading?: ReactNode;
  trailing?: ReactNode;
  tone?: DashboardTone;
  /** avatar letter (defaults to the first char of a string title) */
  initial?: string;
}) {
  const t = TONE[tone];
  const letter = (initial ?? (typeof title === 'string' ? title : '?'))
    .trim()
    .charAt(0)
    .toUpperCase();
  const inner = (
    <>
      {leading ?? (
        <span
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold',
            t.chip,
            t.text,
          )}
          aria-hidden
        >
          {letter || '?'}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        {subtitle ? (
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 items-center gap-2 text-xs">{trailing}</span>
      ) : null}
      {href ? <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden /> : null}
    </>
  );
  const cls = 'flex items-center gap-3 px-4 py-2.5';
  return (
    <li>
      {href ? (
        <Link
          href={href}
          className={cn(
            cls,
            'transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
          )}
        >
          {inner}
        </Link>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </li>
  );
}

// ---- action center ----------------------------------------------------------

export interface ActionCenterItem {
  key: string;
  label: string;
  hint?: string;
  /** the real count; 0 means nothing needs doing */
  count: number;
  icon: Icon;
  tone?: DashboardTone;
  /** destination when one exists; the row is not a link otherwise */
  href?: string;
}

/**
 * "What needs doing": rows with a real count. A row with attention required
 * (count > 0) is emphasised with its tone; zero rows are quiet. If everything is
 * zero it says so instead of rendering a wall of zeros.
 */
export function DashboardActionCenter({
  items,
  allClearText = 'Nothing needs your attention right now.',
}: {
  items: ActionCenterItem[];
  allClearText?: string;
}) {
  const active = items.filter((i) => i.count > 0);
  if (items.length === 0 || active.length === 0) {
    return <DashboardEmptyState title="All clear" description={allClearText} />;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item) => {
        const t = TONE[item.tone ?? 'amber'];
        const attention = item.count > 0;
        const inner = (
          <>
            <span
              className={cn(
                'grid size-8 shrink-0 place-items-center rounded-lg',
                attention ? cn(t.chip, t.text) : 'bg-secondary text-subtle',
              )}
            >
              <item.icon className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block break-words text-sm',
                  attention ? 'font-medium' : 'text-muted-foreground',
                )}
              >
                {item.label}
              </span>
              {item.hint ? (
                <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
              ) : null}
            </span>
            <span
              className={cn(
                'min-w-7 rounded-full px-2 py-0.5 text-center text-xs font-semibold tabular-nums',
                attention ? cn(t.chip, t.text) : 'text-subtle',
              )}
            >
              {item.count}
            </span>
            {item.href ? (
              <ChevronRight className="size-4 shrink-0 text-subtle" aria-hidden />
            ) : null}
          </>
        );
        const cls = cn(
          'flex items-center gap-3 rounded-lg border px-3 py-2',
          attention ? t.border : 'border-transparent',
        );
        return (
          <li key={item.key}>
            {item.href ? (
              <Link
                href={item.href}
                className={cn(
                  cls,
                  'transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                )}
              >
                {inner}
              </Link>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---- quick actions -----------------------------------------------------------

export interface QuickAction {
  key: string;
  label: string;
  href: string;
  icon: Icon;
  tone?: DashboardTone;
}

/** Callers pass ONLY actions the user is authorised to perform. */
export function DashboardQuickActions({
  actions,
  title = 'Quick actions',
}: {
  actions: QuickAction[];
  title?: string;
}) {
  if (actions.length === 0) return null;
  return (
    <DashboardCard title={title}>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {actions.map((a) => {
          const t = TONE[a.tone ?? 'teal'];
          return (
            <li key={a.key}>
              <Link
                href={a.href}
                className="flex items-center gap-2.5 rounded-lg border bg-surface px-3 py-2 text-sm font-medium transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <span
                  className={cn(
                    'grid size-7 shrink-0 place-items-center rounded-md',
                    t.chip,
                    t.text,
                  )}
                >
                  <a.icon className="size-3.5" aria-hidden />
                </span>
                <span className="truncate">{a.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </DashboardCard>
  );
}

// ---- empty / range ------------------------------------------------------------

export function DashboardEmptyState({
  title,
  description,
  icon: IconCmp,
  action,
}: {
  title: string;
  description?: string;
  icon?: Icon;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border px-4 py-7 text-center">
      {IconCmp ? <IconCmp className="size-6 text-subtle" aria-hidden /> : null}
      <p className="text-sm font-medium">{title}</p>
      {description ? <p className="max-w-xs text-xs text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

export function DashboardRangeToggle<T extends number>({
  value,
  options,
  onChange,
  label = 'Date range',
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-0.5 rounded-md bg-background-muted p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
            value === o.value
              ? 'bg-surface-raised text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DashboardCardSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-9 animate-pulse rounded-md bg-secondary motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
