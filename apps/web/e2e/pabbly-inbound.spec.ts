import { expect, test } from '@playwright/test';

/**
 * Proves the Pabbly connector as a working product capability end to end
 * (phase brief §25): configure a source in the browser, send a Pabbly-style
 * request straight at the API, then confirm the resulting lead is visible in
 * the CRM UI. Opt-in, same seed as `admin.spec.ts` / `crm.spec.ts`.
 *
 *   RUN_CRM_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@acme.test E2E_ADMIN_PASSWORD='...' \
 *   E2E_API_BASE_URL=http://localhost:4000 \
 *   E2E_BASE_URL=http://localhost:3000 \
 *   pnpm --filter @aivoryx/web test:e2e pabbly-inbound.spec.ts
 */
const ENABLED = process.env.RUN_CRM_E2E === '1';
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000';

test.describe('Pabbly inbound connector', () => {
  test.skip(!ENABLED || !EMAIL || !PASSWORD, 'set RUN_CRM_E2E=1 + E2E_ADMIN_* to run');

  test('a Pabbly-style request reaches the API, creates a lead, and is visible in the CRM', async ({
    page,
    request,
  }) => {
    // 1. login and configure a connector source in the admin UI
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    await page.goto('/admin/integrations');
    const sourceKey = `pabbly-e2e-${Date.now()}`;
    await page.getByLabel('Source key').fill(sourceKey);
    await page.getByLabel('Name').fill('Pabbly E2E Source');
    await page.getByRole('button', { name: 'Create source' }).click();

    const secretBlock = page.locator('code').last();
    await expect(secretBlock).toBeVisible();
    const secret = (await secretBlock.textContent())?.trim();
    expect(secret).toBeTruthy();

    // 2. send a Pabbly-style lead payload straight at the API (no browser session)
    const leadName = `Pabbly E2E ${Date.now()}`;
    const phone = `9${Math.floor(Math.random() * 1_000_000_000)}`.slice(0, 10);
    const res = await request.post(
      `${API_BASE_URL}/api/v1/integrations/webhooks/pabbly/${sourceKey}`,
      {
        headers: { Authorization: `Bearer ${secret}` },
        data: { full_name: leadName, phone_number: phone, email_address: `${phone}@e2e.test` },
      },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ accepted: true, status: 'DONE' });

    // 3. the resulting lead is visible in the CRM
    await page.goto('/crm/leads');
    await page.getByPlaceholder(/Search name/).fill(leadName);
    await expect(page.getByRole('link', { name: leadName })).toBeVisible();
  });
});
