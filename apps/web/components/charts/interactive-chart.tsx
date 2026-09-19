'use client';

import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { Download, ExternalLink, Maximize2 } from 'lucide-react';
import { IconButton, Tooltip, cn } from '@aivoryx/ui';
import { Dialog } from '@/components/ui/overlays';
import { ChartCanvas } from './chart-canvas';
import {
  CHART_KIND_LABEL,
  type ChartData,
  type ChartKind,
  kindsFor,
  resolveKind,
  summarize,
  toCsv,
} from './chart-model';

export interface RangeOption {
  value: number;
  label: string;
}

const PREF_KEY = (id: string) => `aivoryx.chart.${id}`;

function useKindPreference(id: string, data: ChartData): [ChartKind, (k: ChartKind) => void] {
  const [pref, setPref] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPref(localStorage.getItem(PREF_KEY(id)));
    } catch {
      /* default kind */
    }
  }, [id]);
  const kind = resolveKind(data.shape, pref);
  const set = (k: ChartKind) => {
    setPref(k);
    try {
      localStorage.setItem(PREF_KEY(id), k);
    } catch {
      /* not persisted */
    }
  };
  return [kind, set];
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * A reusable chart with the standard interaction model: chart-type selection
 * (only kinds valid for the dataset's shape), an optional date range, expand
 * to a focused large view with summary metrics, an "open in new tab" link to the
 * standalone report, and CSV export of exactly the data on screen. The chart
 * never fetches or decides authorisation — the caller passes already-authorised
 * data.
 */
export function InteractiveChart({
  id,
  title,
  data,
  ranges,
  range,
  onRangeChange,
  reportHref,
  standalone,
  ariaLabel,
}: {
  /** stable id — the key for the remembered chart type */
  id: string;
  title: string;
  data: ChartData;
  ranges?: RangeOption[];
  range?: number;
  onRangeChange?: (value: number) => void;
  /** standalone report URL; renders "Open in new tab" */
  reportHref?: string;
  /** the dedicated report page: no expand / new-tab controls */
  standalone?: boolean;
  ariaLabel?: string;
}) {
  const [kind, setKind] = useKindPreference(id, data);
  const [expanded, setExpanded] = useState(false);
  const kinds = kindsFor(data.shape);
  const label = ariaLabel ?? `${title}: ${CHART_KIND_LABEL[kind]} chart`;
  const kindId = useId();

  const controls = (large: boolean) => (
    <div className="flex flex-wrap items-center gap-2">
      {kinds.length > 1 ? (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="sr-only">Chart type</span>
          <select
            id={`${kindId}-${large ? 'l' : 's'}`}
            value={kind}
            onChange={(e) => setKind(e.target.value as ChartKind)}
            className="h-7 rounded-md border border-input bg-surface px-1.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {CHART_KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {ranges && ranges.length > 0 ? (
        <div
          role="group"
          aria-label="Date range"
          className="flex gap-0.5 rounded-md bg-background-muted p-0.5"
        >
          {ranges.map((r) => (
            <button
              key={r.value}
              type="button"
              aria-pressed={range === r.value}
              onClick={() => onRangeChange?.(r.value)}
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                range === r.value
                  ? 'bg-surface-raised text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );

  const actions = (
    <div className="flex items-center">
      <Tooltip label="Export CSV">
        <IconButton
          aria-label={`Export ${title} as CSV`}
          className="size-7"
          onClick={() => download(`${id}.csv`, toCsv(data))}
        >
          <Download className="size-3.5" aria-hidden />
        </IconButton>
      </Tooltip>
      {!standalone && reportHref ? (
        <Tooltip label="Open in new tab">
          <Link
            href={reportHref}
            target="_blank"
            rel="noopener"
            aria-label={`Open ${title} in a new tab`}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <ExternalLink className="size-3.5" aria-hidden />
          </Link>
        </Tooltip>
      ) : null}
      {!standalone ? (
        <Tooltip label="Expand">
          <IconButton
            aria-label={`Expand ${title}`}
            className="size-7"
            onClick={() => setExpanded(true)}
          >
            <Maximize2 className="size-3.5" aria-hidden />
          </IconButton>
        </Tooltip>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {controls(false)}
        {actions}
      </div>
      <ChartCanvas kind={kind} data={data} ariaLabel={label} size={standalone ? 'lg' : 'md'} />

      <Dialog open={expanded} onClose={() => setExpanded(false)} title={title} size="xl">
        <div className="space-y-4">
          {controls(true)}
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {summarize(data).map((m) => (
              <div key={m.label} className="rounded-md border bg-background-muted px-3 py-2">
                <dt className="text-xs text-muted-foreground">{m.label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{m.value}</dd>
              </div>
            ))}
          </dl>
          <ChartCanvas kind={kind} data={data} ariaLabel={label} size="lg" />
        </div>
      </Dialog>
    </div>
  );
}
