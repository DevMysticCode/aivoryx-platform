'use client';

import { useId } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@aivoryx/ui';
import {
  THEME_PRESETS,
  type ThemeColors,
  type ThemePresetKey,
  deriveTheme,
  isHexColor,
} from '@aivoryx/shared';
import { HelperText } from '@/components/help/helper-text';

export interface ThemeDraft {
  preset: ThemePresetKey;
  colors: ThemeColors;
}

/** Swatch preview of a preset: its three colours side by side. */
function Swatch({ colors }: { colors: ThemeColors }) {
  return (
    <span className="flex h-6 overflow-hidden rounded-md border border-border" aria-hidden>
      <span className="w-6" style={{ background: colors.primary }} />
      <span className="w-4" style={{ background: colors.secondary }} />
      <span className="w-3" style={{ background: colors.accent }} />
    </span>
  );
}

/**
 * The tenant theme control: a radio group of curated presets plus "Custom"
 * (Primary / Secondary / Accent). Contrast is validated live with the same
 * engine the API uses, so a colour that would be rejected on save is explained —
 * with a suggested fix — before the user tries. Status colours are not offered:
 * success / warning / danger / info always keep their platform meaning.
 */
export function ThemePicker({
  value,
  onChange,
  disabled,
}: {
  value: ThemeDraft;
  onChange: (next: ThemeDraft) => void;
  disabled?: boolean;
}) {
  const name = useId();
  const report = deriveTheme(value.colors).report;
  const primaryValid = isHexColor(value.colors.primary);

  const setColor = (key: keyof ThemeColors, hex: string) =>
    onChange({ preset: 'custom', colors: { ...value.colors, [key]: hex } });

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[...THEME_PRESETS, { key: 'custom' as const, label: 'Custom', colors: value.colors }].map(
          (p) => {
            const selected = value.preset === p.key;
            return (
              <label
                key={p.key}
                className={cn(
                  'relative flex cursor-pointer items-center gap-2.5 rounded-lg border p-2.5 text-sm transition-colors',
                  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus',
                  selected ? 'border-primary bg-primary-soft' : 'hover:bg-surface-hover',
                  disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name={name}
                  className="sr-only"
                  checked={selected}
                  disabled={disabled}
                  onChange={() =>
                    onChange({
                      preset: p.key,
                      colors: p.key === 'custom' ? value.colors : p.colors,
                    })
                  }
                />
                <Swatch colors={p.colors} />
                <span className="font-medium">{p.label}</span>
                {selected ? <Check className="ml-auto size-4 text-primary" aria-hidden /> : null}
              </label>
            );
          },
        )}
      </div>

      {value.preset === 'custom' ? (
        <div className="space-y-3 rounded-lg border bg-background-muted p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['primary', 'Primary', 'Buttons, links and highlights.'],
                ['secondary', 'Secondary', 'Headings and the sidebar identity.'],
                ['accent', 'Accent', 'Charts and occasional emphasis.'],
              ] as const
            ).map(([key, label, hint]) => {
              const hex = value.colors[key];
              const ok = isHexColor(hex);
              return (
                <div key={key} className="space-y-1.5">
                  <span className="text-sm font-medium">{label}</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      aria-label={`${label} colour picker`}
                      value={ok ? hex : '#000000'}
                      disabled={disabled}
                      onChange={(e) => setColor(key, e.target.value)}
                      className="h-9 w-11 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
                    />
                    <input
                      type="text"
                      aria-label={`${label} colour`}
                      value={hex}
                      disabled={disabled}
                      spellCheck={false}
                      onChange={(e) => setColor(key, e.target.value)}
                      className={cn(
                        'h-9 w-full min-w-0 rounded-md border bg-surface px-2.5 font-mono text-sm',
                        ok ? 'border-input' : 'border-danger',
                      )}
                    />
                  </div>
                  <HelperText>
                    {ok ? hint : 'Enter a 6-digit hex value such as #1E40AF.'}
                  </HelperText>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div
        role="status"
        className={cn(
          'rounded-md border px-3 py-2 text-xs',
          !primaryValid || !report.ok
            ? 'border-danger/30 bg-danger-soft text-danger'
            : 'border-success/30 bg-success-soft text-success',
        )}
      >
        {!primaryValid ? (
          'Primary colour must be a 6-digit hex value.'
        ) : report.ok ? (
          <>
            Readable in light and dark mode — text on buttons reaches{' '}
            {Math.min(report.fillContrastLight, report.fillContrastDark).toFixed(1)}:1 contrast (AA
            needs 4.5:1). Shades are adjusted automatically per mode.
          </>
        ) : (
          <>
            {report.problems[0]}{' '}
            {report.suggestedPrimary ? (
              <button
                type="button"
                className="font-semibold underline"
                disabled={disabled}
                onClick={() => setColor('primary', report.suggestedPrimary!)}
              >
                Use {report.suggestedPrimary}
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
