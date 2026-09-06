import { Injectable } from '@nestjs/common';
import {
  type EmailMessage,
  EmailSendError,
  type EmailProvider,
  type EmailSendResult,
} from './email-provider.js';

/**
 * Deterministic in-memory email provider for automated tests (ADR 0037).
 * Captures every message; never opens a socket; never sends real email.
 *
 * Failure simulation is driven by the recipient address so a test can assert
 * retry/permanent-failure behaviour without touching internals:
 *   - `fail-once@…`  -> throws a retryable error on the first attempt only
 *   - `fail-always@…`-> throws a retryable error every attempt
 *   - `bounce@…`     -> throws a permanent error
 */
@Injectable()
export class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake';
  readonly sent: (EmailMessage & { providerMessageId: string })[] = [];
  private readonly attempts = new Map<string, number>();
  private counter = 0;

  reset(): void {
    this.sent.length = 0;
    this.attempts.clear();
    this.counter = 0;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const to = message.to.toLowerCase();
    const n = (this.attempts.get(to) ?? 0) + 1;
    this.attempts.set(to, n);

    if (to.startsWith('bounce@')) {
      throw new EmailSendError('Recipient rejected', false, 'EMAIL_BOUNCED');
    }
    if (to.startsWith('fail-always@')) {
      throw new EmailSendError('Temporary provider failure', true, 'EMAIL_PROVIDER_TEMPORARY');
    }
    if (to.startsWith('fail-once@') && n === 1) {
      throw new EmailSendError('Temporary provider failure', true, 'EMAIL_PROVIDER_TEMPORARY');
    }

    const providerMessageId = `fake-${Date.now()}-${++this.counter}`;
    this.sent.push({ ...message, providerMessageId });
    return { providerMessageId, provider: this.name };
  }
}
