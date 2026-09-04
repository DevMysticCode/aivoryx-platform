import type { INestApplication } from '@nestjs/common';
import type { Response } from 'supertest';
import { ensureIntegrationEnv } from './env.js';

/**
 * Boot a real Nest application against the (already migrated + seeded) test
 * database, configured exactly like production (`configureApp`). Dynamic imports
 * keep this file inert for a CI run that skips the integration suites.
 */
export async function bootTestApp(): Promise<INestApplication> {
  ensureIntegrationEnv();
  const [{ Test }, { AppModule }, { configureApp }, { loadServerEnv, resetServerEnvCache }] =
    await Promise.all([
      import('@nestjs/testing'),
      import('../../src/app.module.js'),
      import('../../src/bootstrap/configure-app.js'),
      import('@aivoryx/config'),
    ]);

  resetServerEnvCache();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app, loadServerEnv());
  await app.init();
  return app;
}

/** Pull the session cookie value out of a login `Set-Cookie` header. */
export function sessionCookie(res: Response, cookieName = 'aivoryx_session'): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const header = (raw ?? []).find((c) => c.startsWith(`${cookieName}=`));
  if (!header) throw new Error('no session cookie in response');
  return header.split(';')[0]!; // "aivoryx_session=<token>"
}

/** True when the Set-Cookie header clears the session (logout). */
export function clearsSessionCookie(res: Response, cookieName = 'aivoryx_session'): boolean {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const header = (raw ?? []).find((c) => c.startsWith(`${cookieName}=`));
  return !!header && /(^|;)\s*Expires=Thu, 01 Jan 1970|(=;|=\s*;)/i.test(header);
}
