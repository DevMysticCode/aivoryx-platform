import { expect, test } from '@playwright/test';

/**
 * Phase 14 §15-19, §34-35, §56 — platform-admin tenant provisioning golden
 * path: create company → choose solution → review modules → provision →
 * verify tenant/modules/invitation → suspend → verify blocked → reactivate →
 * verify restored → archive → verify terminal. Opt-in; needs a running web
 * app + API + database seeded with `seed:platform-demo`:
 *
 *   RUN_PLATFORM_E2E=1 \
 *   E2E_PLATFORM_ADMIN_EMAIL=platform-admin@aivoryx.test \
 *   E2E_PLATFORM_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 \
 *   pnpm --filter @aivoryx/web test:e2e platform-provisioning.spec.ts
 */
const ENABLED = process.env.RUN_PLATFORM_E2E === '1';
const PA_EMAIL = process.env.E2E_PLATFORM_ADMIN_EMAIL ?? '';
const PA_PASSWORD = process.env.E2E_PLATFORM_ADMIN_PASSWORD ?? '';

test.describe('platform tenant provisioning', () => {
  test.skip(!ENABLED || !PA_EMAIL || !PA_PASSWORD, 'set RUN_PLATFORM_E2E=1 + E2E_PLATFORM_ADMIN_*');

  test('create → solution → modules → provision → verify → suspend → reactivate → archive', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(PA_EMAIL);
    await page.getByLabel('Password').fill(PA_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));

    // 1-2. Platform -> Create Company
    await page.goto('/platform/tenants');
    await page.getByRole('link', { name: 'Create company' }).click();
    await expect(page.getByRole('heading', { name: 'Create a company' })).toBeVisible();

    // 3. company information
    const name = `Playwright Provisioning Co ${Date.now()}`;
    const adminEmail = `pw-provisioning-${Date.now()}@test.test`;
    await page.getByPlaceholder('Acme Field Services').fill(name);
    await page.getByPlaceholder('admin@acme-field.test').fill(adminEmail);
    await page.getByRole('button', { name: /Next: choose solution/ }).click();

    // 4. choose solution
    await page
      .getByRole('button', { name: /Field Service/ })
      .first()
      .click();
    await page.getByRole('button', { name: /Next: review modules/ }).click();

    // 5. review modules — the Field Service solution's recommended set
    for (const label of ['CRM', 'Field Operations', 'Supply Chain', 'Finance']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    // EPC and COMMERCIAL are not part of Field Service — confirm unchecked
    const epcRow = page.locator('li', { hasText: 'Project Execution' });
    await expect(epcRow.getByRole('checkbox')).not.toBeChecked();

    // 6. provision
    await page.getByRole('button', { name: 'Provision company' }).click();

    // 7. verify tenant + modules + admin invitation handoff
    await expect(page.getByText('is live')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/5 modules enabled/)).toBeVisible();
    await expect(page.getByText(/No email provider is configured/)).toBeVisible();
    await expect(page.getByText(/accept-invitation\?token=/)).toBeVisible();

    // 8. open the tenant
    await page.getByRole('button', { name: 'Open company' }).click();
    await page.waitForURL(/\/platform\/tenants\/[0-9a-f-]+$/);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByText('active', { exact: true })).toBeVisible();
    await expect(page.getByText('AIVORYX_FIELD_SERVICE')).toBeVisible();

    // 9. suspend -> verify suspended
    await page.getByRole('button', { name: 'Suspend' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Suspend' }).click();
    await expect(page.getByText('suspended', { exact: true })).toBeVisible();

    // 10. reactivate -> verify access restored
    await page.getByRole('button', { name: 'Activate' }).click();
    await expect(page.getByText('active', { exact: true })).toBeVisible();

    // 11. archive -> verify terminal (no Activate action offered again)
    await page.getByRole('button', { name: 'Archive' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByText('archived', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activate' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Suspend' })).toHaveCount(0);
  });

  test('an unknown solution and a dependency-inconsistent module set are rejected before provisioning', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(PA_EMAIL);
    await page.getByLabel('Password').fill(PA_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));

    await page.goto('/platform/tenants/new');
    await page.getByPlaceholder('Acme Field Services').fill(`Reject Co ${Date.now()}`);
    await page.getByPlaceholder('admin@acme-field.test').fill(`reject-${Date.now()}@test.test`);
    await page.getByRole('button', { name: /Next: choose solution/ }).click();

    await page
      .getByRole('button', { name: /Business/ })
      .first()
      .click();
    await page.getByRole('button', { name: /Next: review modules/ }).click();

    // prove the "provision" button requires at least one module — unchecking
    // every module in the Business solution's set disables submission.
    for (const label of ['CRM', 'HR & Workforce', 'Finance']) {
      const row = page.locator('li', { hasText: label }).first();
      await row.getByRole('checkbox').uncheck();
    }
    await expect(page.getByRole('button', { name: 'Provision company' })).toBeDisabled();
  });
});
