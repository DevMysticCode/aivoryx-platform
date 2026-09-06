import { describe, expect, it } from 'vitest';
import { NotificationPreferencesService } from './notification-preferences.service.js';

const svc = new NotificationPreferencesService();

describe('preference evaluation', () => {
  it('blocks a channel the user disabled', () => {
    expect(svc.channelAllowed({ inAppEnabled: false, emailEnabled: true }, 'in_app')).toBe(false);
    expect(svc.channelAllowed({ inAppEnabled: true, emailEnabled: false }, 'email')).toBe(false);
  });

  it('allows a channel the user enabled', () => {
    expect(svc.channelAllowed({ inAppEnabled: true, emailEnabled: true }, 'in_app')).toBe(true);
    expect(svc.channelAllowed({ inAppEnabled: true, emailEnabled: true }, 'email')).toBe(true);
  });

  it('does not gate whatsapp/sms on the (not-yet-existing) toggles', () => {
    expect(svc.channelAllowed({ inAppEnabled: false, emailEnabled: false }, 'whatsapp')).toBe(true);
    expect(svc.channelAllowed({ inAppEnabled: false, emailEnabled: false }, 'sms')).toBe(true);
  });
});
