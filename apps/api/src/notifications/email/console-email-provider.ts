import { Injectable, Logger } from '@nestjs/common';
import { type EmailMessage, type EmailProvider, type EmailSendResult } from './email-provider.js';

/**
 * Development / default provider (ADR 0037). Logs a SAFE summary of the email
 * (recipient, subject, body length — never headers/secrets, never the full
 * body at info level) and "accepts" it. Real email requires configuring
 * `EMAIL_PROVIDER=smtp`; this keeps local dev and any un-configured deployment
 * from silently doing nothing while never sending anything real.
 */
@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';
  private readonly logger = new Logger('EmailProvider');
  private counter = 0;

  async send(message: EmailMessage): Promise<EmailSendResult> {
    const providerMessageId = `console-${Date.now()}-${++this.counter}`;
    this.logger.log(
      `email (not sent — console provider) to=${redactEmail(message.to)} ` +
        `subject=${JSON.stringify(message.subject)} bodyChars=${message.text.length} ` +
        `ref=${providerMessageId}`,
    );
    return { providerMessageId, provider: this.name };
  }
}

function redactEmail(address: string): string {
  const [local, domain] = address.split('@');
  if (!domain || !local) return '***';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}
