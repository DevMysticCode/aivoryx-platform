import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { expect } from 'vitest';
import { makeFixtures, rawPool, type Fixtures } from './db.js';
import { bootTestApp, sessionCookie } from './app.js';

/**
 * Shared helpers for the inbound-connector contract suites (Universal Connector UC-0).
 *
 * These deliberately talk to the system only through its public HTTP surface and
 * read persisted side effects with plain SQL on the physical tables — never
 * through application classes — so the same suites keep working while the
 * internals are refactored (adapter registry, canonical ingestion, consumers).
 */

/** Webhook routes under contract. UC-4 adds the provider-neutral route to this list. */
export const WEBHOOK_ROUTES = [
  { name: 'pabbly alias', path: (key: string) => `/api/v1/integrations/webhooks/pabbly/${key}` },
] as const;
export type WebhookRoute = (typeof WEBHOOK_ROUTES)[number];

export interface ConnectorHarness {
  app: INestApplication;
  http: ReturnType<typeof request>;
  fx: Fixtures;
  close(): Promise<void>;
  login(email: string, password: string): request.Test;
  adminCookie(): Promise<string>;
  adminBCookie(): Promise<string>;
  uniqueKey(label: string): string;
  createSource(
    cookie: string,
    key: string,
    fieldMapping?: Record<string, string>,
  ): Promise<{ sourceId: string; secret: string; key: string }>;
  webhook(
    route: WebhookRoute,
    key: string,
    secret: string | null,
    body: unknown,
    headers?: Record<string, string>,
  ): request.Test;
  /** run a read-only SQL query as the superuser (bypasses RLS on purpose: checks what is PERSISTED) */
  sql<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export async function startConnectorHarness(): Promise<ConnectorHarness> {
  const fx = await makeFixtures();
  const app = await bootTestApp();
  const http = request(app.getHttpServer());

  const login = (email: string, password: string) =>
    http.post('/api/v1/auth/login').send({ email, password });

  const h: ConnectorHarness = {
    app,
    http,
    fx,
    login,
    async close() {
      await app.close();
      const db = await import('@aivoryx/db');
      await db.closeDb();
    },
    async adminCookie() {
      const res = await login(fx.admin.email, fx.admin.password);
      const cookie = sessionCookie(res);
      await http
        .post('/api/v1/auth/switch-tenant')
        .set('Cookie', cookie)
        .send({ membershipId: fx.admin.membershipId });
      return cookie;
    },
    async adminBCookie() {
      return sessionCookie(await login(fx.adminB.email, fx.adminB.password));
    },
    uniqueKey: (label) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    async createSource(cookie, key, fieldMapping) {
      const res = await http
        .post('/api/v1/admin/integrations/sources')
        .set('Cookie', cookie)
        .send({ key, name: `Source ${key}`, ...(fieldMapping ? { fieldMapping } : {}) });
      expect(res.status).toBe(200);
      return { sourceId: res.body.source.id, secret: res.body.credential.secret, key };
    },
    webhook(route, key, secret, body, headers = {}) {
      const req = http.post(route.path(key));
      if (secret) req.set('Authorization', `Bearer ${secret}`);
      for (const [k, v] of Object.entries(headers)) req.set(k, v);
      return req.send(body as object);
    },
    async sql<T>(text: string, params: unknown[] = []) {
      const pool = await rawPool();
      try {
        const { rows } = await pool.query(text, params);
        return rows as T[];
      } finally {
        await pool.end();
      }
    },
  };
  return h;
}
