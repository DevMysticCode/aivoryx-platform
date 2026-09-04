import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { CORRELATION_ID_HEADER } from '@aivoryx/shared';
import { loadServerEnv } from '@aivoryx/config';
import { normalizeCorrelationId } from './correlation.js';

const env = loadServerEnv();
const isDev = env.APP_ENV === 'development';

/**
 * Structured logging with Pino (ADR 0014). Each log line carries the request
 * correlation id. Sensitive fields are redacted. Pretty output in development,
 * JSON everywhere else.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        genReqId: (req, res) => {
          const inbound = req.headers[CORRELATION_ID_HEADER];
          const id = normalizeCorrelationId(Array.isArray(inbound) ? inbound[0] : inbound);
          res.setHeader(CORRELATION_ID_HEADER, id);
          return id;
        },
        customProps: (req) => ({ correlationId: (req as { id?: string }).id }),
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["set-cookie"]',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.token',
            'req.body.secret',
          ],
          remove: true,
        },
        transport: isDev
          ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
          : undefined,
        autoLogging: {
          ignore: (req) => req.url === '/api/v1/health/live',
        },
      },
    }),
  ],
})
export class AppLoggerModule {}
