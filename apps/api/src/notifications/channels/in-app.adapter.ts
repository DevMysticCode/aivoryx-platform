import { Injectable } from '@nestjs/common';
import {
  type ChannelAdapter,
  type ChannelDeliveryRequest,
  type ChannelDeliveryResult,
} from './channel-adapter.js';

/**
 * In-app channel (ADR 0037). Fully functional: the `notifications` row created
 * by the engine *is* the deliverable, so "delivery" here is just confirming it
 * is visible. No external call, so this never fails transiently.
 */
@Injectable()
export class InAppChannelAdapter implements ChannelAdapter {
  readonly channel = 'in_app' as const;
  readonly available = true;

  async deliver(_request: ChannelDeliveryRequest): Promise<ChannelDeliveryResult> {
    return { provider: 'in_app' };
  }
}
