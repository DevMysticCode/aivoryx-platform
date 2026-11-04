import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INTEGRATION_ENABLED } from './support/env.js';
import { makeFixtures, type Fixtures } from './support/db.js';
import { bootTestApp, sessionCookie } from './support/app.js';

/**
 * Tenant timezone/currency wiring milestone: proves a tenant's configured
 * `defaultCurrency` (apps/api/src/settings/settings.dto.ts) is actually used
 * as the fallback currency across HR record-creation — replacing the
 * previously-hardcoded 'INR' literal at payroll.service.ts, expenses.service.ts,
 * compensation.service.ts and incentives.service.ts — and that a tenant with
 * no configured currency still falls back to 'INR' (existing behavior
 * preserved). Finance's `invoices.service.ts` fallback is exercised by the
 * existing invoice-from-quotation coverage in `finance.int.spec.ts`.
 */
describe.skipIf(!INTEGRATION_ENABLED)('tenant default currency fallback', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await makeFixtures();
    app = await bootTestApp();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    const db = await import('@aivoryx/db');
    await db.closeDb();
  });

  const login = (email: string, password: string) =>
    http.post('/api/v1/auth/login').send({ email, password });
  const cookieFor = async (email: string, password: string, membershipId: string) => {
    const res = await login(email, password);
    const cookie = sessionCookie(res);
    await http.post('/api/v1/auth/switch-tenant').set('Cookie', cookie).send({ membershipId });
    return cookie;
  };
  const adminCookie = () => cookieFor(fx.admin.email, fx.admin.password, fx.admin.membershipId);
  const adminBCookie = () => cookieFor(fx.adminB.email, fx.adminB.password, fx.adminB.membershipId);
  const uniq = () => Math.random().toString(36).slice(2, 7).toUpperCase();

  async function makeEmployee(cookie: string): Promise<string> {
    const res = await http
      .post('/api/v1/hr/employees')
      .set('Cookie', cookie)
      .send({
        firstName: 'Currency',
        lastName: `Test ${uniq()}`,
        email: `currency-test-${uniq()}@example.test`,
        employmentType: 'FULL_TIME',
        startDate: '2026-01-01',
        status: 'ACTIVE',
      });
    expect(res.status).toBe(200);
    return res.body.id as string;
  }

  it("uses tenant A's configured default currency (EUR) for HR records created without an explicit currency", async () => {
    const cookie = await adminCookie();

    const setCurrency = await http
      .put('/api/v1/settings/company')
      .set('Cookie', cookie)
      .send({ defaultCurrency: 'EUR' });
    expect(setCurrency.status).toBe(200);
    expect(setCurrency.body.defaultCurrency).toBe('EUR');

    const emp = await makeEmployee(cookie);

    const compensation = await http
      .post(`/api/v1/hr/employees/${emp}/compensation`)
      .set('Cookie', cookie)
      .send({ effectiveDate: '2026-01-01', baseSalary: '40000.00', payFrequency: 'MONTHLY' });
    expect(compensation.status).toBe(200);
    expect(compensation.body.currency).toBe('EUR');

    const incentive = await http.post('/api/v1/hr/incentives').set('Cookie', cookie).send({
      employeeId: emp,
      amount: '1000.00',
      type: 'performance',
    });
    expect(incentive.status).toBe(200);
    expect(incentive.body.currency).toBe('EUR');

    const category = await http
      .post('/api/v1/hr/expenses/categories')
      .set('Cookie', cookie)
      .send({ name: `Travel ${uniq()}`, code: `TR${uniq()}` });
    expect(category.status).toBe(200);

    const claim = await http.post('/api/v1/hr/expenses').set('Cookie', cookie).send({
      employeeId: emp,
      categoryId: category.body.id,
      expenseDate: '2026-05-01',
      amount: '250.00',
    });
    expect(claim.status).toBe(200);
    expect(claim.body.currency).toBe('EUR');

    const period = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({ name: `Payrun ${uniq()}`, periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    expect(period.status).toBe(200);
    expect(period.body.currency).toBe('EUR');

    // restore so later tests/files relying on the default remain unaffected
    await http
      .put('/api/v1/settings/company')
      .set('Cookie', cookie)
      .send({ defaultCurrency: 'INR' });
  });

  it('falls back to INR for a tenant that has never configured a default currency', async () => {
    const cookie = await adminBCookie();

    const profile = await http.get('/api/v1/settings/company').set('Cookie', cookie);
    expect(profile.body.defaultCurrency ?? null).toBeNull();

    const period = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({ name: `Payrun ${uniq()}`, periodStart: '2026-06-01', periodEnd: '2026-06-30' });
    expect(period.status).toBe(200);
    expect(period.body.currency).toBe('INR');
  });

  it('an explicit currency on the request still wins over the tenant default', async () => {
    const cookie = await adminCookie();
    await http
      .put('/api/v1/settings/company')
      .set('Cookie', cookie)
      .send({ defaultCurrency: 'EUR' });

    const period = await http
      .post('/api/v1/hr/payroll/periods')
      .set('Cookie', cookie)
      .send({
        name: `Payrun ${uniq()}`,
        periodStart: '2026-06-01',
        periodEnd: '2026-06-30',
        currency: 'GBP',
      });
    expect(period.status).toBe(200);
    expect(period.body.currency).toBe('GBP');

    await http
      .put('/api/v1/settings/company')
      .set('Cookie', cookie)
      .send({ defaultCurrency: 'INR' });
  });
});
