import { expect, test } from '@playwright/test';

/**
 * Focused CRM smoke (ADR 0031). Opt-in: needs a running web app + API +
 * database and a seeded TENANT_ADMIN account (same seed as `admin.spec.ts`).
 *
 *   RUN_CRM_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@acme.test E2E_ADMIN_PASSWORD='...' \
 *   E2E_BASE_URL=http://localhost:3000 \
 *   pnpm --filter @aivoryx/web test:e2e crm.spec.ts
 */
const ENABLED = process.env.RUN_CRM_E2E === '1';
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

test.describe('CRM smoke', () => {
  test.skip(!ENABLED || !EMAIL || !PASSWORD, 'set RUN_CRM_E2E=1 + E2E_ADMIN_* to run');

  test('login, create a lead, assign it, note it, follow up, qualify it, verify the timeline', async ({
    page,
  }) => {
    // 1. login
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    // 2. navigate to CRM → the overview, then into Leads
    await page.getByRole('link', { name: 'CRM' }).first().click();
    await page.waitForURL('**/crm');
    await page.getByRole('link', { name: 'Leads' }).first().click();
    await page.waitForURL('**/crm/leads');
    await expect(page.getByRole('heading', { name: 'Leads' })).toBeVisible();

    // 3. create + open a lead
    const leadName = `E2E Lead ${Date.now()}`;
    await page.getByRole('button', { name: 'New lead' }).click();
    await page.getByLabel('Name').first().fill(leadName);
    const phone = `9${Math.floor(Math.random() * 1_000_000_000)}`.slice(0, 10);
    await page.getByLabel('Phone').first().fill(phone);
    await page.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/crm\/leads\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name: leadName })).toBeVisible();

    // 4. assign it (Overview tab, "Owner" select)
    await page.getByRole('combobox').first().selectOption({ index: 1 });
    await expect(
      page.getByText('ASSIGNED', { exact: true }).or(page.getByText('NEW', { exact: true })),
    ).toBeVisible();

    // 5. add a note (Notes tab)
    await page.getByRole('button', { name: 'Notes' }).click();
    await page.getByPlaceholder('Add a note…').fill('Called and left a voicemail.');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Called and left a voicemail.')).toBeVisible();

    // 6. create a follow-up (Follow-ups tab → dialog)
    await page.getByRole('button', { name: 'Follow-ups' }).click();
    await page.getByRole('button', { name: 'Schedule follow-up' }).click();
    const due = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
    await page.getByLabel('Due').fill(due);
    await page
      .getByRole('dialog', { name: 'Schedule a follow-up' })
      .getByRole('button', { name: 'Schedule' })
      .click();
    await expect(page.getByText('pending', { exact: true })).toBeVisible();

    // 7. qualify (back on Overview tab)
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByRole('button', { name: 'Qualify', exact: true }).click();
    await expect(page.getByText('QUALIFIED', { exact: true }).first()).toBeVisible();

    // 8. verify the activity timeline recorded everything
    await page.getByRole('button', { name: 'Activity' }).click();
    await expect(page.getByText('Lead created')).toBeVisible();
    await expect(page.getByText('Note added')).toBeVisible();
    await expect(page.getByText('Qualified', { exact: true })).toBeVisible();
  });
});
