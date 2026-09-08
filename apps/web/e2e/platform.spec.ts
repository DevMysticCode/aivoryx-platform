import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 13B — platform-administration golden path + module-entitlement negative
 * tests (ADR 0042 §64, §66). Opt-in; needs a running web app + API + database
 * seeded with `seed:platform-demo`:
 *
 *   RUN_PLATFORM_E2E=1 \
 *   E2E_PLATFORM_ADMIN_EMAIL=platform-admin@aivoryx.test \
 *   E2E_PLATFORM_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_TENANT_B_ADMIN_EMAIL=admin@southbridge-demo.test \
 *   E2E_TENANT_B_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3000 \
 *   pnpm --filter @aivoryx/web test:e2e platform.spec.ts
 */
const ENABLED = process.env.RUN_PLATFORM_E2E === '1';
const PA_EMAIL = process.env.E2E_PLATFORM_ADMIN_EMAIL ?? '';
const PA_PASSWORD = process.env.E2E_PLATFORM_ADMIN_PASSWORD ?? '';
const B_EMAIL = process.env.E2E_TENANT_B_ADMIN_EMAIL ?? '';
const B_PASSWORD = process.env.E2E_TENANT_B_ADMIN_PASSWORD ?? '';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test.describe('platform administration', () => {
  test.skip(
    !ENABLED || !PA_EMAIL || !PA_PASSWORD || !B_EMAIL || !B_PASSWORD,
    'set RUN_PLATFORM_E2E=1 + E2E_PLATFORM_ADMIN_* + E2E_TENANT_B_ADMIN_*',
  );

  test('platform admin manages module entitlements; Company B is limited to CRM + Supply', async ({
    page,
  }) => {
    // 1–2. sign in as the platform admin → land on the platform overview
    await signIn(page, PA_EMAIL, PA_PASSWORD);
    await page.waitForURL('**/platform');
    await expect(page.getByRole('heading', { name: 'Platform overview' })).toBeVisible();
    await expect(page.getByText('Companies', { exact: true }).first()).toBeVisible();

    // 3–4. open Companies, then Company A (Northwind — all seven modules)
    await page.goto('/platform/tenants');
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
    await page.getByRole('link', { name: 'Northwind Energy (Demo)' }).first().click();
    await page.waitForURL('**/platform/tenants/**');

    // 5–6. Company A has every module enabled
    await expect(page.getByRole('heading', { name: 'Module entitlements' })).toBeVisible();
    for (const key of ['CRM', 'FIELD', 'SUPPLY', 'FINANCE', 'HR']) {
      await expect(
        page.getByTestId(`module-${key}`).getByText('ENABLED', { exact: true }),
      ).toBeVisible();
    }
    // SUPPLY cannot be disabled here — COMMERCIAL and EPC depend on it
    await expect(
      page.getByTestId('module-SUPPLY').getByRole('button', { name: 'Disable' }),
    ).toBeDisabled();
    await expect(page.getByTestId('module-SUPPLY')).toContainText(/depend/i);

    // 7–8. Company B (Southbridge) — only CRM + Supply enabled
    await page.goto('/platform/tenants');
    await page.getByRole('link', { name: 'Southbridge Retail (Demo)' }).first().click();
    await page.waitForURL('**/platform/tenants/**');
    await expect(page.getByRole('heading', { name: 'Module entitlements' })).toBeVisible();
    const row = (key: string) => page.getByTestId(`module-${key}`);
    await expect(row('CRM').getByText('ENABLED', { exact: true })).toBeVisible();
    await expect(row('SUPPLY').getByText('ENABLED', { exact: true })).toBeVisible();
    await expect(row('HR').getByText('DISABLED', { exact: true })).toBeVisible();
    await expect(row('FIELD').getByText('DISABLED', { exact: true })).toBeVisible();

    // 9–10. dependency handling. Normalise COMMERCIAL to DISABLED, then:
    //   enable it → SUPPLY can no longer be disabled → disable it again.
    if (await row('COMMERCIAL').getByRole('button', { name: 'Disable' }).isVisible()) {
      await row('COMMERCIAL').getByRole('button', { name: 'Disable' }).click();
      await page.getByRole('button', { name: 'Disable module' }).click();
      await expect(row('COMMERCIAL').getByText('DISABLED', { exact: true })).toBeVisible();
    }
    await row('COMMERCIAL').getByRole('button', { name: 'Enable' }).click();
    await expect(row('COMMERCIAL').getByText('ENABLED', { exact: true })).toBeVisible();
    await expect(row('SUPPLY').getByRole('button', { name: 'Disable' })).toBeDisabled();
    await row('COMMERCIAL').getByRole('button', { name: 'Disable' }).click();
    await page.getByRole('button', { name: 'Disable module' }).click();
    await expect(row('COMMERCIAL').getByText('DISABLED', { exact: true })).toBeVisible();

    // 11–13. sign in as the Company B tenant admin — no HR / Field / Finance nav
    await signIn(page, B_EMAIL, B_PASSWORD);
    await page.waitForURL('**/admin');
    const sidebar = page.getByRole('complementary');
    await expect(sidebar.getByRole('link', { name: 'CRM' })).toBeVisible();
    await expect(sidebar.getByRole('link', { name: 'HR & Workforce' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Finance' })).toHaveCount(0);
    await expect(sidebar.getByRole('link', { name: 'Field Operations' })).toHaveCount(0);

    // 14–15. a direct HR route is denied by the backend (entitlement) and the
    // page surfaces the stable message rather than data.
    await page.goto('/hr/employees');
    await expect(
      page.getByText(
        /not enabled for your workspace|access unavailable|do not have access|permission/i,
      ),
    ).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);

    // 16–18. Access management offers only entitled-module permissions
    await page.goto('/admin/access');
    await page.getByRole('button', { name: 'Profiles' }).click();
    await page.getByRole('button', { name: /New profile/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('CRM', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('HR', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel' }).click();

    // 19. sign out
    await page
      .getByRole('button', { name: /Account menu/ })
      .first()
      .click();
    await page.getByRole('menuitem', { name: /Log out/ }).click();
    await page.waitForURL('**/login');
  });
});
