import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 13C — role/module/permission-aware dashboard (ADR 0042 §2–4). Opt-in:
 *
 *   RUN_DASHBOARD_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_SUPPLY_TENANT_EMAIL=admin@southbridge-demo.test E2E_SUPPLY_TENANT_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 \
 *   pnpm --filter @aivoryx/web test:e2e dashboard.spec.ts
 */
const ENABLED = process.env.RUN_DASHBOARD_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const B_EMAIL = process.env.E2E_SUPPLY_TENANT_EMAIL ?? '';
const B_PASSWORD = process.env.E2E_SUPPLY_TENANT_PASSWORD ?? '';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.describe('role-aware dashboard', () => {
  test.skip(!ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD, 'set RUN_DASHBOARD_E2E=1 + E2E_ADMIN_*');

  test('a full-access tenant admin sees CRM + Field + Finance + HR widgets and quick actions', async ({
    page,
  }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Welcome back|Dashboard/ })).toBeVisible();

    await expect(page.getByTestId('widget-quick-actions')).toBeVisible();
    await expect(page.getByTestId('widget-crm-pipeline')).toBeVisible();
    await expect(page.getByTestId('widget-crm-pipeline').getByText('Lead pipeline')).toBeVisible();
    await expect(page.getByTestId('widget-field-visits')).toBeVisible();
    await expect(page.getByTestId('widget-finance-receivables')).toBeVisible();
    await expect(page.getByTestId('widget-hr-workforce')).toBeVisible();

    // a KPI/chart renders real content, not a spinner
    await expect(page.getByTestId('widget-crm-pipeline').getByText(/Conversion/)).toBeVisible();

    // quick action → CRM quick create
    await page.getByTestId('widget-quick-actions').getByRole('link', { name: 'New lead' }).click();
    await page.waitForURL('**/crm/leads**');
    await expect(page.getByRole('dialog', { name: 'New lead' })).toBeVisible();
  });

  test('a CRM + Supply tenant never sees HR / Finance / Field widgets', async ({ page }) => {
    test.skip(!B_EMAIL || !B_PASSWORD, 'set E2E_SUPPLY_TENANT_*');
    await signIn(page, B_EMAIL, B_PASSWORD);
    await page.goto('/');
    await expect(page.getByTestId('widget-crm-pipeline')).toBeVisible();
    await expect(page.getByTestId('widget-hr-workforce')).toHaveCount(0);
    await expect(page.getByTestId('widget-finance-receivables')).toHaveCount(0);
    await expect(page.getByTestId('widget-field-visits')).toHaveCount(0);
  });

  test('mobile: widgets stack and are readable at 390px', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.getByTestId('widget-crm-pipeline')).toBeVisible();
    // no horizontal overflow: the widget fits the viewport
    const box = await page.getByTestId('widget-crm-pipeline').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
  });
});
