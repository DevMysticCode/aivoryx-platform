import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  DEFAULT_TEMPLATES,
  effectiveRulesForEvent,
  HANDLED_EVENT_TYPES,
  mergeRule,
  mergeTemplate,
} from './catalogue.js';

describe('notification catalogue', () => {
  it('every rule points at a real template and a supported strategy', () => {
    const templateKeys = new Set(DEFAULT_TEMPLATES.map((t) => t.key));
    for (const rule of DEFAULT_RULES) {
      expect(templateKeys, rule.key).toContain(rule.templateKey);
      expect(rule.channels.length).toBeGreaterThan(0);
      expect(['USER', 'ACTOR', 'ASSIGNED_USER', 'ROLE', 'CUSTOMER']).toContain(
        rule.recipientStrategy,
      );
      if (rule.recipientStrategy === 'ROLE') expect(rule.roleKey).toBeTruthy();
      if (rule.recipientStrategy === 'ASSIGNED_USER' || rule.recipientStrategy === 'CUSTOMER') {
        expect(rule.entity).toBeTruthy();
      }
    }
  });

  it('rule keys are unique and every handled event type is covered', () => {
    const keys = DEFAULT_RULES.map((r) => r.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const rule of DEFAULT_RULES) expect(HANDLED_EVENT_TYPES.has(rule.eventType)).toBe(true);
  });

  it('a tenant override can disable a rule', () => {
    const base = DEFAULT_RULES[0]!;
    const merged = mergeRule(base, { key: base.key, isActive: false, channels: null });
    expect(merged.isActive).toBe(false);
    expect(merged.overridden).toBe(true);
  });

  it('a tenant override can only narrow channels to a subset of the default', () => {
    const base = DEFAULT_RULES.find((r) => r.channels.length > 1)!;
    const merged = mergeRule(base, {
      key: base.key,
      isActive: true,
      channels: [base.channels[0]!, 'sms'],
    });
    expect(merged.channels).toEqual([base.channels[0]]);
  });

  it('an empty channel override falls back to the default channels (never zero)', () => {
    const base = DEFAULT_RULES[0]!;
    const merged = mergeRule(base, { key: base.key, isActive: true, channels: [] });
    expect(merged.channels).toEqual(base.channels);
  });

  it('effectiveRulesForEvent merges overrides by key', () => {
    const rules = effectiveRulesForEvent('quotation.sent', [
      { key: 'quotation_sent.customer', isActive: false, channels: null },
    ]);
    const customerRule = rules.find((r) => r.key === 'quotation_sent.customer');
    expect(customerRule?.isActive).toBe(false);
    expect(rules.find((r) => r.key === 'quotation_sent.owner')?.isActive).toBe(true);
  });

  it('mergeTemplate returns the default until an active override exists', () => {
    const dflt = mergeTemplate('quotation_sent', 'in_app', undefined)!;
    expect(dflt.overridden).toBe(false);
    const overridden = mergeTemplate('quotation_sent', 'in_app', {
      key: 'quotation_sent',
      channel: 'in_app',
      title: 'Custom {{quotation.number}}',
      body: 'Body',
      emailSubject: null,
      emailBody: null,
      isActive: true,
    })!;
    expect(overridden.title).toBe('Custom {{quotation.number}}');
    expect(overridden.requiredVars).toContain('quotation.number');
    expect(overridden.overridden).toBe(true);
  });
});
