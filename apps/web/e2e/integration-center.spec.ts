import { expect, test, type Page } from '@playwright/test';

/**
 * Proves the UC-4 Integration Center surface end to end: connection detail navigation, its tabs,
 * the provider-metadata-driven credential form (Meta), the mapping editor, and the Developer
 * tab's generated snippet — on top of the existing UC-3 connector flow. Opt-in, same seed/gating
 * as `pabbly-inbound.spec.ts` / `admin.spec.ts`.
 *
 *   RUN_CRM_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@acme.test E2E_ADMIN_PASSWORD='...' \
 *   E2E_BASE_URL=http://localhost:3000 \
 *   pnpm --filter @aivoryx/web test:e2e integration-center.spec.ts
 */
const ENABLED = process.env.RUN_CRM_E2E === '1';
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/admin');
}

test.describe('Integration Center (UC-4)', () => {
  test.skip(!ENABLED || !EMAIL || !PASSWORD, 'set RUN_CRM_E2E=1 + E2E_ADMIN_* to run');

  test('a generic webhook connection: detail navigation, mapping edit, developer snippet, no secret leakage', async ({
    page,
  }) => {
    await login(page);

    await page.goto('/admin/integrations');
    const sourceKey = `uc4-generic-e2e-${Date.now()}`;
    const sourceName = `UC-4 Generic E2E Source ${Date.now()}`;
    await page.getByLabel('Source key').fill(sourceKey);
    await page.getByLabel('Name').fill(sourceName);
    await page.getByRole('button', { name: 'Create source' }).click();
    const handoff = page.getByTestId('connector-handoff');
    await expect(handoff).toBeVisible();
    const handoffSecret = (await handoff.locator('code').last().textContent())?.trim();
    expect(handoffSecret).toBeTruthy();

    // navigate into the connection's detail page via its list row (name is unique per run)
    await page.getByRole('link', { name: new RegExp(sourceName) }).click();
    await page.waitForURL(/\/admin\/integrations\/sources\/.+/);
    await expect(page.getByRole('tab', { name: 'Overview' })).toBeVisible();

    // Overview never fabricates a metric the backend doesn't provide
    await expect(page.getByText(/success rate/i)).toHaveCount(0);
    await expect(page.getByText(/health score/i)).toHaveCount(0);

    // Mapping tab: add an override and save (starts empty for a freshly created source)
    await page.getByRole('tab', { name: 'Mapping' }).click();
    await page.getByRole('button', { name: 'Add mapping' }).click();
    await page.getByPlaceholder('contact_no').fill('vendor_phone');
    await page.getByPlaceholder(/canonical:phone/).fill('canonical:phone');
    await page.getByRole('button', { name: 'Save mapping' }).click();
    await expect(page.getByText('Connection updated')).toBeVisible();

    // reload and confirm the mapping persisted
    await page.reload();
    await page.getByRole('tab', { name: 'Mapping' }).click();
    await expect(page.locator('input[value="vendor_phone"]')).toBeVisible();

    // Developer tab: a snippet with a placeholder secret, never a real one
    await page.getByRole('tab', { name: 'Developer' }).click();
    await expect(page.getByText('<YOUR_SECRET>').first()).toBeVisible();
    if (handoffSecret) {
      await expect(page.getByText(handoffSecret, { exact: false })).toHaveCount(0);
    }
  });

  test('a Meta connection: the credential form is driven by provider metadata, not hardcoded', async ({
    page,
  }) => {
    await login(page);

    await page.goto('/admin/integrations');
    const sourceKey = `uc4-meta-e2e-${Date.now()}`;
    const sourceName = `UC-4 Meta E2E Source ${Date.now()}`;
    await page.getByLabel('Provider').selectOption({ label: 'Meta Lead Ads' });
    await page.getByLabel('Source key').fill(sourceKey);
    await page.getByLabel('Name').fill(sourceName);
    await page.getByRole('button', { name: 'Create source' }).click();

    await page.getByRole('link', { name: new RegExp(sourceName) }).click();
    await page.waitForURL(/\/admin\/integrations\/sources\/.+/);
    await page.getByRole('tab', { name: 'Configuration' }).click();

    // fields come from GET /admin/integrations/providers, never a hardcoded Meta branch in the page
    await expect(page.getByText('App Secret')).toBeVisible();
    await expect(page.getByText('Page Access Token')).toBeVisible();
    await expect(page.getByText('Webhook Verify Token')).toBeVisible();

    const appSecretInput = page.getByLabel('App Secret');
    await expect(appSecretInput).toHaveAttribute('type', 'password');
    await expect(appSecretInput).toHaveValue('');
  });
});
