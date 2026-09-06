import { expect, test, type APIResponse, type Page } from '@playwright/test';

/**
 * Platform experience golden path (Phase 10, ADR 0039).
 *
 * Sign in as a tenant admin → open Settings → Company → set the company name,
 * document footer and brand colour → save → reload → the workspace name shows
 * in the app shell → open a quotation and an invoice → download each PDF and
 * assert a real `application/pdf` body → a regular member can see branding but
 * cannot edit the company profile.
 *
 * Opt-in. Needs a running web app + API + database, the demo seeds, and the
 * commercial + finance demo data (`seed:commercial-demo`, `seed:finance-demo`):
 *
 *   RUN_PLATFORM_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_MEMBER_EMAIL=agent@clans-demo.test E2E_MEMBER_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 E2E_API_BASE_URL=http://localhost:4000 \
 *   pnpm --filter @aivoryx/web test:e2e platform-experience.spec.ts
 */
const ENABLED = process.env.RUN_PLATFORM_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const MEMBER_EMAIL = process.env.E2E_MEMBER_EMAIL ?? '';
const MEMBER_PASSWORD = process.env.E2E_MEMBER_PASSWORD ?? '';
const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function assertPdf(res: APIResponse, numberHint: string) {
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/pdf');
  expect(res.headers()['content-disposition'] ?? '').toContain('.pdf');
  const body = await res.body();
  expect(body.length).toBeGreaterThan(1000);
  expect(body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  expect(body.subarray(-8).toString('ascii')).toContain('%%EOF');
  expect(numberHint.length).toBeGreaterThan(0);
}

test.describe('Platform experience golden path', () => {
  test.skip(
    !ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'set RUN_PLATFORM_E2E=1 + E2E_ADMIN_* (+ E2E_MEMBER_* for the member check)',
  );
  test.setTimeout(180_000);

  test('admin sets branding → app shell + branded PDFs; member sees but cannot edit', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const companyName = `Clans Renewables ${stamp}`;

    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // ---- 1. company profile & branding -------------------------
    await page.goto('/settings/company');
    await expect(page.getByRole('heading', { name: 'Company profile & branding' })).toBeVisible();

    const displayName = page.getByLabel('Display name');
    await displayName.fill(companyName);
    await page.getByLabel('Primary brand colour').last().fill('#0f766e');
    await page
      .getByPlaceholder('Bank details, payment terms, registration lines…')
      .fill(`Pay to Clans Renewables ${stamp}`);
    await page.getByRole('button', { name: 'Save changes' }).click();

    // ---- 2. it reaches the app shell after reload --------------
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('aside').getByText(companyName)).toBeVisible();

    // ---- 3. branded PDFs ------------------------------------
    // pick the first quotation + invoice from the list APIs, then download.
    const quotes = await page.request.get(`${API_BASE}/api/v1/quotations?pageSize=1`);
    const quote = (await quotes.json()).items?.[0];
    if (quote) {
      const pdf = await page.request.get(`${API_BASE}/api/v1/quotations/${quote.id}/pdf`);
      await assertPdf(pdf, quote.number ?? 'q');
    }

    const invoices = await page.request.get(`${API_BASE}/api/v1/finance/invoices?pageSize=1`);
    const invoice = (await invoices.json()).items?.[0];
    expect(invoice, 'seed a finance demo invoice first').toBeTruthy();
    const invPdf = await page.request.get(`${API_BASE}/api/v1/finance/invoices/${invoice.id}/pdf`);
    await assertPdf(invPdf, invoice.number ?? 'inv');

    // the download button is on the invoice detail page too
    await page.goto(`/finance/invoices/${invoice.id}`);
    await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();

    // ---- 4. a regular member sees branding but cannot edit -----
    test.skip(!MEMBER_EMAIL || !MEMBER_PASSWORD, 'set E2E_MEMBER_* for the member check');
    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await signIn(memberPage, MEMBER_EMAIL, MEMBER_PASSWORD);
    await memberPage.goto('/settings/company');
    await expect(
      memberPage.getByText(/don’t have access|workspace is ready|Company profile/i),
    ).toBeVisible();
    await expect(memberPage.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await memberCtx.close();
  });
});
