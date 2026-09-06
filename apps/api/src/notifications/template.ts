import { AppError } from '@aivoryx/shared';

/**
 * Safe notification templating (ADR 0037).
 *
 * The ONLY templating feature is `{{ dotted.path }}` interpolation against a
 * whitelisted context object. There is no logic, no loops, no partials and no
 * executable code — a template can never run JavaScript or reach a value the
 * engine did not explicitly place in the context. The raw event payload is
 * never a template context.
 */

export type TemplateContext = Record<string, unknown>;

/** `{{ a.b_c.d }}` — letters, digits, underscore and dots only. */
const VARIABLE = /\{\{\s*([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)*)\s*\}\}/g;

/** Every distinct `{{ path }}` referenced by a template string. */
export function collectVariables(...templates: string[]): string[] {
  const found = new Set<string>();
  for (const template of templates) {
    for (const match of template.matchAll(VARIABLE)) {
      found.add(match[1]!);
    }
  }
  return [...found];
}

/** Resolve a dotted path against own enumerable properties only (no prototype
 *  walk, no array index tricks). Returns `undefined` for any missing segment. */
export function lookupPath(context: TemplateContext, path: string): unknown {
  let current: unknown = context;
  for (const segment of path.split('.')) {
    if (segment === '__proto__' || segment === 'constructor' || segment === 'prototype') {
      return undefined;
    }
    if (current === null || typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** A value is renderable only if it is a primitive we can safely stringify. */
function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return null;
}

export interface RenderResult {
  text: string;
  /** paths that were referenced but had no usable value */
  missing: string[];
}

/**
 * Interpolate a template. Missing / non-primitive variables render as an empty
 * string and are reported in `missing` so the caller can decide whether that is
 * acceptable (see {@link renderRequired}). The output is plain text; callers
 * that need HTML must pass it through {@link textToSafeHtml}.
 */
export function renderTemplate(template: string, context: TemplateContext): RenderResult {
  const missing: string[] = [];
  const text = template.replace(VARIABLE, (_full, path: string) => {
    const value = stringifyValue(lookupPath(context, path));
    if (value === null) {
      missing.push(path);
      return '';
    }
    return value;
  });
  return { text, missing: [...new Set(missing)] };
}

/**
 * Render, requiring that every `requiredVars` path resolves. Fails safe: a
 * missing required variable throws `NOTIFICATION_TEMPLATE_INVALID` rather than
 * sending a half-filled message.
 */
export function renderRequired(
  template: string,
  context: TemplateContext,
  requiredVars: readonly string[],
): string {
  const { text, missing } = renderTemplate(template, context);
  const missingRequired = missing.filter((m) => requiredVars.includes(m));
  if (missingRequired.length > 0) {
    throw new AppError('NOTIFICATION_TEMPLATE_INVALID', {
      details: { missing: missingRequired },
    });
  }
  return text;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/**
 * Turn already-interpolated plain text into a minimal, safe HTML body:
 * everything is HTML-escaped first (so no interpolated value can inject
 * markup), then blank-line-separated blocks become `<p>` and single newlines
 * become `<br>`. No tags survive from the input, so there is nothing to
 * sanitise and no script can execute.
 */
export function textToSafeHtml(text: string): string {
  const blocks = text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`);
  return blocks.join('\n');
}
