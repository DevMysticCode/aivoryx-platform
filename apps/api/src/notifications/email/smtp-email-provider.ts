import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { AppError } from '@aivoryx/shared';
import {
  type EmailMessage,
  EmailSendError,
  type EmailProvider,
  type EmailSendResult,
} from './email-provider.js';

/**
 * Provider-neutral SMTP transport (ADR 0037). "SMTP", not a vendor — the same
 * adapter works against SES, Mailgun, Postmark, a corporate relay, etc.
 * Configuration is entirely from the environment (`EMAIL_SMTP_URL`,
 * `EMAIL_FROM`); no credentials in source. Selected only when
 * `EMAIL_PROVIDER=smtp`.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider {
  readonly name = 'smtp';
  private readonly logger = new Logger('EmailProvider');
  private transporter: Transporter | null = null;

  constructor(
    private readonly smtpUrl: string | undefined,
    private readonly from: string,
  ) {}

  private transport(): Transporter {
    if (!this.smtpUrl) {
      throw new AppError('EMAIL_PROVIDER_NOT_CONFIGURED', {
        details: { reason: 'EMAIL_SMTP_URL is not set' },
      });
    }
    this.transporter ??= nodemailer.createTransport(this.smtpUrl);
    return this.transporter;
  }

  async send(message: EmailMessage): Promise<EmailSendResult> {
    try {
      const info = await this.transport().sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        headers: message.headers,
      });
      return { providerMessageId: info.messageId, provider: this.name };
    } catch (err) {
      if (err instanceof AppError) throw err;
      // nodemailer surfaces `responseCode` for SMTP replies: 4xx = try again,
      // 5xx = permanent. Socket errors (no code) are transient.
      const code = (err as { responseCode?: number }).responseCode;
      const retryable = code === undefined || (code >= 400 && code < 500);
      this.logger.warn(`smtp send failed (retryable=${retryable}) code=${code ?? 'n/a'}`);
      throw new EmailSendError(
        (err as Error).message ?? 'SMTP send failed',
        retryable,
        `SMTP_${code ?? 'ERROR'}`,
      );
    }
  }
}
