import { Logger, Module } from '@nestjs/common';
import { type ServerEnv } from '@aivoryx/config';
import { SERVER_ENV } from '../../config/config.module.js';
import { EMAIL_PROVIDER, type EmailProvider } from './email-provider.js';
import { FakeEmailProvider } from './fake-email-provider.js';
import { ConsoleEmailProvider } from './console-email-provider.js';
import { SmtpEmailProvider } from './smtp-email-provider.js';

/**
 * Selects the active `EmailProvider` from configuration only (ADR 0037). Real
 * email is never sent from automated tests: `NODE_ENV=test` forces the fake
 * provider regardless of `EMAIL_PROVIDER`.
 */
@Module({
  providers: [
    FakeEmailProvider,
    ConsoleEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [SERVER_ENV, FakeEmailProvider, ConsoleEmailProvider],
      useFactory: (
        env: ServerEnv,
        fake: FakeEmailProvider,
        console: ConsoleEmailProvider,
      ): EmailProvider => {
        const logger = new Logger('EmailProvider');
        if (env.NODE_ENV === 'test') return fake;
        switch (env.EMAIL_PROVIDER) {
          case 'fake':
            return fake;
          case 'smtp':
            if (!env.EMAIL_SMTP_URL) {
              logger.warn(
                'EMAIL_PROVIDER=smtp but EMAIL_SMTP_URL is unset — using console provider',
              );
              return console;
            }
            logger.log('email provider: smtp');
            return new SmtpEmailProvider(env.EMAIL_SMTP_URL, env.EMAIL_FROM);
          case 'console':
          default:
            return console;
        }
      },
    },
  ],
  exports: [EMAIL_PROVIDER, FakeEmailProvider],
})
export class EmailModule {}
