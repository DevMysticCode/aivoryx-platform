import { describe, expect, it } from 'vitest';
import { deliveryIdempotencyKey, notificationDedupeKey } from './idempotency.js';

const base = {
  eventId: '018f-event',
  ruleKey: 'quotation_sent.customer',
  recipientRef: 'Owner@Example.com',
  channel: 'email',
};

describe('notification idempotency keys', () => {
  it('are deterministic for identical inputs', () => {
    expect(deliveryIdempotencyKey(base)).toBe(deliveryIdempotencyKey({ ...base }));
    expect(notificationDedupeKey(base)).toBe(notificationDedupeKey({ ...base }));
  });

  it('are case-insensitive on the recipient ref (same person, one delivery)', () => {
    expect(deliveryIdempotencyKey({ ...base, recipientRef: 'owner@example.com' })).toBe(
      deliveryIdempotencyKey({ ...base, recipientRef: 'OWNER@EXAMPLE.COM' }),
    );
  });

  it('change when event, rule, recipient or channel changes', () => {
    const k = deliveryIdempotencyKey(base);
    expect(deliveryIdempotencyKey({ ...base, eventId: 'other' })).not.toBe(k);
    expect(deliveryIdempotencyKey({ ...base, ruleKey: 'other' })).not.toBe(k);
    expect(deliveryIdempotencyKey({ ...base, recipientRef: 'other@x.com' })).not.toBe(k);
    expect(deliveryIdempotencyKey({ ...base, channel: 'in_app' })).not.toBe(k);
  });

  it('delivery key differs from the notification dedupe key', () => {
    expect(deliveryIdempotencyKey(base)).not.toBe(notificationDedupeKey(base));
  });

  it('one notification identity backs deliveries on every channel', () => {
    const { eventId, ruleKey, recipientRef } = base;
    const identity = notificationDedupeKey({ eventId, ruleKey, recipientRef });
    // the delivery keys differ per channel, but they all belong to `identity`
    const inApp = deliveryIdempotencyKey({ eventId, ruleKey, recipientRef, channel: 'in_app' });
    const email = deliveryIdempotencyKey({ eventId, ruleKey, recipientRef, channel: 'email' });
    expect(inApp).not.toBe(email);
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is a hex sha-256 digest, never a timestamp', () => {
    expect(deliveryIdempotencyKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
