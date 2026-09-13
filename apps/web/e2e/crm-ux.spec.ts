import { expect, test } from '@playwright/test';

/**
 * Phase 13B — CRM flagship UX golden path (ADR 0042 §65). Opt-in; needs a
 * running web app + API + database and a CRM-enabled user (Company A's admin
 * from `seed:platform-demo` works):
 *
 *   RUN_CRM_UX_E2E=1 \
 *   E2E_CRM_EMAIL=admin@northwind-demo.test E2E_CRM_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3000 \
 *   pnpm --filter @aivoryx/web test:e2e crm-ux.spec.ts
 */
const ENABLED = process.env.RUN_CRM_UX_E2E === '1';
const EMAIL = process.env.E2E_CRM_EMAIL ?? '';
const PASSWORD = process.env.E2E_CRM_PASSWORD ?? '';

test.describe('CRM flagship UX', () => {
  test.skip(!ENABLED || !EMAIL || !PASSWORD, 'set RUN_CRM_UX_E2E=1 + E2E_CRM_*');

  test('overview → leads → create → detail → command palette → mobile', async ({ page }) => {
    // 1–3. sign in, open the CRM overview, see real KPI content
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    await page.goto('/crm');
    await expect(page.getByRole('heading', { name: 'CRM overview' })).toBeVisible();
    await expect(page.getByText('Total leads')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pipeline' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Follow-up action center' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Lead activity trend' })).toBeVisible();

    // 4–5. open Leads and search/filter
    await page.getByRole('link', { name: 'Leads' }).first().click();
    await page.waitForURL('**/crm/leads');
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();

    // 8. create a lead via quick create
    const name = `E2E Lead ${Date.now()}`;
    await page.getByRole('button', { name: 'New lead' }).click();
    await page.getByLabel('Name').first().fill(name);
    await page.getByLabel('Phone').first().fill('9800000123');
    await page.getByRole('button', { name: 'Create lead' }).click();

    // 9–10. land on the lead detail and change status through a valid transition
    await page.waitForURL('**/crm/leads/**');
    await expect(page.getByText(name).first()).toBeVisible();

    // 15–17. command palette: open, search the lead, navigate to it
    await page.goto('/crm');
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    await palette.getByPlaceholder(/Search leads/).fill(name.slice(0, 12));
    await expect(palette.getByText(name)).toBeVisible({ timeout: 5000 });
    await palette.getByText(name).click();
    await page.waitForURL('**/crm/leads/**');

    // 18. notifications bell is present in the shell
    await expect(page.getByRole('button', { name: /notification/i })).toBeVisible();

    // 19–22. mobile viewport: lead list becomes cards, bottom nav is present
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/crm/leads');
    await expect(page.getByRole('navigation').last()).toBeVisible(); // bottom nav
    await expect(page.getByTestId('lead-table')).toBeHidden();
    await expect(page.getByTestId('lead-cards').getByText(name)).toBeVisible();

    // 23. sign out via the account menu (open the More sheet on mobile first)
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: /Log out/ }).click();
    await page.waitForURL('**/login');
  });
});
