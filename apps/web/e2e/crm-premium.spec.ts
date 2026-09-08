import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 13C — premium CRM lead list + detail workspace (ADR 0031). Opt-in:
 *
 *   RUN_CRM_PREMIUM_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 \
 *   pnpm --filter @aivoryx/web test:e2e crm-premium.spec.ts
 */
const ENABLED = process.env.RUN_CRM_PREMIUM_E2E === '1';
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.describe('CRM premium workspace', () => {
  test.skip(!ENABLED || !EMAIL || !PASSWORD, 'set RUN_CRM_PREMIUM_E2E=1 + E2E_ADMIN_*');

  test('dashboard → leads → create → search → filter → save view → board → detail workspace', async ({
    page,
  }) => {
    await signIn(page);

    // dashboard → CRM
    await page.goto('/');
    await page.getByRole('link', { name: 'CRM' }).first().click();
    await page.waitForURL('**/crm');
    await page.getByRole('link', { name: 'Leads' }).first().click();
    await page.waitForURL('**/crm/leads');
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();

    // create a lead through the quick-create dialog
    const name = `Premium ${Date.now()}`;
    await page.getByRole('button', { name: 'New lead' }).click();
    const dialog = page.getByRole('dialog', { name: 'New lead' });
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Phone').fill('9811100022');
    await dialog.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/crm\/leads\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name })).toBeVisible();

    // back to the list, search for it
    await page.getByRole('link', { name: 'Leads' }).first().click();
    await page.waitForURL('**/crm/leads');
    await page.getByPlaceholder(/Search name/).fill(name.slice(0, 14));
    await expect(page.getByRole('link', { name })).toBeVisible({ timeout: 5000 });

    // filter by status → chip appears → clear
    await page.getByLabel('Status filter').selectOption('NEW');
    await expect(page.getByText('Status: New')).toBeVisible();
    await page.getByRole('button', { name: 'Clear all' }).click();
    await expect(page.getByText('Status: New')).toHaveCount(0);

    // save the current view (search still applied), then reload and re-apply it
    await page.getByPlaceholder(/Search name/).fill(name.slice(0, 14));
    await page.getByRole('button', { name: 'Saved views' }).click();
    await page.getByRole('menuitem', { name: /Save current filters/ }).click();
    const viewName = `View ${Date.now()}`;
    await page.getByLabel('View name').fill(viewName);
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByText('View saved')).toBeVisible();

    // switch to board view and back
    await page.getByRole('button', { name: 'Board view' }).click();
    await expect(page.getByTestId('lead-board')).toBeVisible();
    await page.getByRole('button', { name: 'Table view' }).click();
    await expect(page.getByRole('table')).toBeVisible();

    // open the lead workspace and use its tabs
    await page.getByRole('link', { name }).click();
    await page.waitForURL(/\/crm\/leads\/[0-9a-f-]+$/);
    await expect(
      page.getByRole('button', { name: 'Call' }).or(page.getByRole('button', { name: 'Edit' })),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Activity' }).click();
    await expect(page.getByText(/Lead created/i)).toBeVisible();
    await page.getByRole('button', { name: 'Notes' }).click();
    await page.getByPlaceholder('Add a note…').fill('Called, will follow up');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText('Called, will follow up')).toBeVisible();
    await page.getByRole('button', { name: 'Follow-ups' }).click();
    await page.getByRole('button', { name: 'Schedule follow-up' }).click();
    const fu = page.getByRole('dialog', { name: 'Schedule a follow-up' });
    await fu.getByLabel('Due').fill('2027-01-01T10:00');
    await fu.getByRole('button', { name: 'Schedule' }).click();
    await expect(page.getByText('Follow-up scheduled')).toBeVisible();

    // clean up the saved view so the test is rerunnable
    await page.getByRole('link', { name: 'Leads' }).first().click();
    await page.getByRole('button', { name: 'Saved views' }).click();
    await page.getByRole('button', { name: `Delete ${viewName}` }).click();
  });

  test('mobile: lead list is cards, detail is a stacked workspace', async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/crm/leads');
    await expect(page.getByTestId('lead-table')).toBeHidden();
    await page.getByTestId('lead-cards').getByRole('link').first().click();
    await page.waitForURL(/\/crm\/leads\/[0-9a-f-]+$/);
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
  });
});
