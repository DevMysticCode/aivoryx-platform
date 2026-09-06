import { Inject, Injectable } from '@nestjs/common';
import { textToSafeHtml } from '../template.js';
import { EMAIL_PROVIDER, type EmailProvider } from '../email/email-provider.js';
import {
  type ChannelAdapter,
  type ChannelDeliveryRequest,
  type ChannelDeliveryResult,
} from './channel-adapter.js';

/**
 * Email channel (ADR 0037). Renders the plain-text body to safe escaped HTML
 * (no author-supplied markup, so nothing to sanitise) and hands off to the
 * provider-neutral `EmailProvider`. Correlation ids travel as headers for
 * provider-side tracing — never secrets.
 */
@Injectable()
export class EmailChannelAdapter implements ChannelAdapter {
  readonly channel = 'email' as const;
  readonly available = true;

  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  async deliver(request: ChannelDeliveryRequest): Promise<ChannelDeliveryResult> {
    const text = request.emailBody ?? request.body;
    const result = await this.provider.send({
      to: request.recipientRef,
      subject: request.emailSubject ?? request.title,
      text,
      html: textToSafeHtml(text),
      headers: {
        'X-Aivoryx-Notification': request.correlation.notificationId,
        'X-Aivoryx-Delivery': request.correlation.deliveryId,
      },
    });
    return { provider: result.provider, providerMessageId: result.providerMessageId };
  }
}
