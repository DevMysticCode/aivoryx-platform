import { expect, test } from '@playwright/test';

/**
 * Focused tenant-admin smoke (ADR 0030). Opt-in: it needs a running web app + API
 * + database and a seeded TENANT_ADMIN account. Enable with:
 *
 *   RUN_ADMIN_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@acme.test E2E_ADMIN_PASSWORD='...' \
 *   E2E_BASE_URL=http://localhost:3000 \
 *   pnpm --filter @aivoryx/web test:e2e admin.spec.ts
 */
const ENABLED = process.env.RUN_ADMIN_E2E === '1';
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

test.describe('tenant admin smoke', () => {
  test.skip(!ENABLED || !EMAIL || !PASSWORD, 'set RUN_ADMIN_E2E=1 + E2E_ADMIN_* to run');

  test('authenticate, view the workspace + members, and invite a member', async ({ page }) => {
    // 1. authenticate as the tenant admin
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // 2. land on /admin and see the workspace overview (tenant name + member summary)
    await page.waitForURL('**/admin');
    await expect(page.getByRole('heading', { name: 'Workspace administration' })).toBeVisible();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();
    await expect(page.getByText('Suspended', { exact: true })).toBeVisible();

    // 3. view members — the admin sees at least their own row
    await page.getByRole('navigation').getByRole('link', { name: 'Members' }).click();
    await page.waitForURL('**/admin/members');
    await expect(page.getByRole('heading', { name: 'Members' })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('cell', { name: EMAIL })).toBeVisible();

    // 4. perform one safe admin operation: invite a new member
    const email = `smoke+${Date.now()}@e2e.test`;
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send invite' }).click();

    // 5. verify the result: the one-time invitation link is shown and the row appears
    await expect(page.getByText(`Invitation created for ${email}`)).toBeVisible();
    await expect(page.getByRole('cell', { name: email })).toBeVisible();
  });
});
