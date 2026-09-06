/**
 * Provider-neutral email interface (ADR 0037). The notification engine depends
 * on THIS ONLY — never on Gmail / Zoho / SendGrid / SES / Mailgun / Resend or
 * any specific vendor. Add a provider by implementing `EmailProvider` and
 * selecting it with `EMAIL_PROVIDER`; no engine change is required.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  /** always present — the safe plain-text body */
  text: string;
  /** optional pre-sanitised HTML body */
  html?: string;
  /** correlation metadata for provider-side tracing; never secrets */
  headers?: Record<string, string>;
}

export interface EmailSendResult {
  /** opaque provider reference, when the provider returns one */
  providerMessageId?: string;
  /** provider name for the delivery record */
  provider: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/** Error a provider throws for a retryable/permanent condition (see `retry.ts`). */
export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code = 'EMAIL_SEND_FAILED',
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}
