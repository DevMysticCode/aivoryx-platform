import { Injectable } from '@nestjs/common';
import { AppError } from '@aivoryx/shared';
import {
  type ChannelAdapter,
  type ChannelDeliveryRequest,
  type ChannelDeliveryResult,
} from './channel-adapter.js';

/**
 * WhatsApp / SMS channels (ADR 0037). Architecture + interface only this phase:
 * the engine can already route to them, but no vendor is integrated, so a
 * delivery on these channels fails **permanently** with a clear code (the
 * delivery record shows why). Wiring a real transport later means implementing
 * `deliver()` and flipping `available` — nothing else in the engine changes.
 */
abstract class UnconfiguredChannelAdapter implements ChannelAdapter {
  abstract readonly channel: 'whatsapp' | 'sms';
  readonly available = false;

  async deliver(_request: ChannelDeliveryRequest): Promise<ChannelDeliveryResult> {
    throw new AppError('NOTIFICATION_CHANNEL_UNAVAILABLE', {
      details: { channel: this.channel },
    });
  }
}

@Injectable()
export class WhatsAppChannelAdapter extends UnconfiguredChannelAdapter {
  readonly channel = 'whatsapp' as const;
}

@Injectable()
export class SmsChannelAdapter extends UnconfiguredChannelAdapter {
  readonly channel = 'sms' as const;
}
