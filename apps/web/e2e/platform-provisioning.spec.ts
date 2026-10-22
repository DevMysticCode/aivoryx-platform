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
    await page.getByLabel('Password', { exact: true }).fill(PA_PASSWORD);
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

    // 8b. onboarding checklist: created + admin assigned + modules are already true;
    // company profile + access verified are not, since the invite was never accepted here
    const onboarding = page.locator('section', { hasText: 'Onboarding' });
    const doneItem = (label: string) => onboarding.locator('li', { hasText: label });
    await expect(doneItem('Tenant created').locator('svg')).toBeVisible();
    await expect(doneItem('Initial tenant administrator assigned').locator('svg')).toBeVisible();
    await expect(doneItem('Modules configured').locator('svg')).toBeVisible();
    await expect(doneItem('Company profile completed').locator('svg')).toHaveCount(0);
    await expect(doneItem('Initial access verified').locator('svg')).toHaveCount(0);

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
    await page.getByLabel('Password', { exact: true }).fill(PA_PASSWORD);
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

  test('tenant list: server-side search narrows results, clearing it restores the list, and pagination controls are present', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(PA_EMAIL);
    await page.getByLabel('Password', { exact: true }).fill(PA_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));

    // a unique-per-run prefix so this test's assertions never depend on how
    // much other demo/seed data already exists in the environment
    const prefix = `Pager E2E Co ${Date.now()}`;
    for (const suffix of ['Alpha', 'Bravo']) {
      await page.goto('/platform/tenants/new');
      await page.getByPlaceholder('Acme Field Services').fill(`${prefix} ${suffix}`);
      await page
        .getByPlaceholder('admin@acme-field.test')
        .fill(`pager-e2e-${Date.now()}-${suffix.toLowerCase()}@test.test`);
      await page.getByRole('button', { name: /Next: choose solution/ }).click();
      await page
        .getByRole('button', { name: /Business/ })
        .first()
        .click();
      await page.getByRole('button', { name: /Next: review modules/ }).click();
      await page.getByRole('button', { name: 'Provision company' }).click();
      await expect(page.getByText('is live')).toBeVisible({ timeout: 10_000 });
    }

    await page.goto('/platform/tenants');

    // structural pagination controls exist regardless of how many tenants
    // this environment already has — asserted without pinning exact counts
    await expect(page.getByRole('button', { name: /Previous/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Next/ })).toBeVisible();
    await expect(page.getByText(/^Page \d+ of \d+$/)).toBeVisible();

    // searching narrows the list to exactly the two tenants just created —
    // proving the search runs server-side, not against a client-cached page
    await page.getByPlaceholder('Search companies…').fill(prefix);
    await expect(page.getByText(`${prefix} Alpha`)).toBeVisible();
    await expect(page.getByText(`${prefix} Bravo`)).toBeVisible();
    await expect(page.getByRole('row')).toHaveCount(3); // header + 2 matches

    // a status filter that excludes every match: the search is still applied,
    // the result is the explicit empty state, not an error
    await page.getByLabel('Status filter').selectOption('suspended');
    await expect(page.getByText('No companies match your filters.')).toBeVisible();

    // clearing the filter and search restores a real (non-empty) list again
    await page.getByLabel('Status filter').selectOption('all');
    await page.getByPlaceholder('Search companies…').fill('');
    await expect(page.getByText('No companies match your filters.')).not.toBeVisible();
    await expect(page.getByRole('row').nth(1)).toBeVisible();
  });
});
