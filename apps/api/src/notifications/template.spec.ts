import { describe, expect, it } from 'vitest';
import { AppError } from '@aivoryx/shared';
import {
  collectVariables,
  escapeHtml,
  lookupPath,
  renderRequired,
  renderTemplate,
  textToSafeHtml,
} from './template.js';

describe('notification template renderer', () => {
  it('collects distinct dotted variables', () => {
    expect(
      collectVariables('Hi {{ customer.name }}, {{quotation.number}} {{customer.name}}'),
    ).toEqual(['customer.name', 'quotation.number']);
  });

  it('interpolates primitives and reports missing paths', () => {
    const r = renderTemplate(
      'Hello {{customer.name}} — total {{quotation.total}} / {{missing.x}}',
      {
        customer: { name: 'Acme' },
        quotation: { total: 1500 },
      },
    );
    expect(r.text).toBe('Hello Acme — total 1500 / ');
    expect(r.missing).toEqual(['missing.x']);
  });

  it('never resolves through the prototype chain', () => {
    expect(lookupPath({}, '__proto__.polluted')).toBeUndefined();
    expect(lookupPath({}, 'constructor.name')).toBeUndefined();
    const r = renderTemplate('{{__proto__.x}} {{constructor}}', {});
    expect(r.text.trim()).toBe('');
  });

  it('treats objects / nullish as missing (never "[object Object]")', () => {
    const r = renderTemplate('{{a}}', { a: { nested: 1 } });
    expect(r.text).toBe('');
    expect(r.missing).toEqual(['a']);
  });

  it('renderRequired throws NOTIFICATION_TEMPLATE_INVALID when a required var is absent', () => {
    expect(() => renderRequired('{{a}} {{b}}', { a: 'x' }, ['a', 'b'])).toThrowError(AppError);
    try {
      renderRequired('{{a}} {{b}}', { a: 'x' }, ['a', 'b']);
    } catch (err) {
      expect((err as AppError).code).toBe('NOTIFICATION_TEMPLATE_INVALID');
      expect((err as AppError).details).toEqual({ missing: ['b'] });
    }
  });

  it('renderRequired passes when only non-required vars are missing', () => {
    expect(renderRequired('{{a}} {{b}}', { a: 'x' }, ['a'])).toBe('x ');
  });

  it('has no executable-template features (no logic, no eval)', () => {
    const r = renderTemplate('{{#if x}}danger{{/if}} {{ 7*7 }} {{a b}}', { x: 1, a: 'A' });
    // `{{ 7*7 }}` and `{{a b}}` are not valid variable syntax -> left verbatim
    expect(r.text).toContain('{{#if x}}');
    expect(r.text).toContain('{{ 7*7 }}');
  });

  it('escapes HTML and turns text into safe paragraphs', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    const html = textToSafeHtml('Hello <b>x</b>\nsecond line\n\nnew para');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('<br>');
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it('an interpolated value cannot inject markup into the email HTML', () => {
    const text = renderTemplate('Name: {{n}}', { n: '<img src=x onerror=alert(1)>' }).text;
    const html = textToSafeHtml(text);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
