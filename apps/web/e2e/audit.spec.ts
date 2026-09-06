import { expect, test, type Page } from '@playwright/test';

/**
 * Global Audit Log golden path (Phase 11, ADR 0040).
 *
 * Sign in as a tenant admin → perform a meaningful audited action (rename the
 * workspace) → open Admin → Audit log → find the generated `tenant.updated`
 * entry → open its detail drawer → verify actor / action / module / changes →
 * verify a `module` filter narrows the list → verify no secret leaked. If a
 * second tenant admin is configured, verify that tenant cannot see this row.
 *
 * Opt-in. Needs a running web app + API + database and the demo seeds:
 *
 *   RUN_AUDIT_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 E2E_API_BASE_URL=http://localhost:4000 \
 *   pnpm --filter @aivoryx/web test:e2e audit.spec.ts
 */
const ENABLED = process.env.RUN_AUDIT_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const OTHER_EMAIL = process.env.E2E_OTHER_ADMIN_EMAIL ?? '';
const OTHER_PASSWORD = process.env.E2E_OTHER_ADMIN_PASSWORD ?? '';
const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

test.describe('Audit log golden path', () => {
  test.skip(!ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD, 'set RUN_AUDIT_E2E=1 + E2E_ADMIN_*');
  test.setTimeout(180_000);

  test('an audited admin action appears in the audit console with correct attribution', async ({
    page,
    browser,
  }) => {
    const stamp = Date.now();
    const newName = `Audit E2E ${stamp}`;

    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    // ---- 1. perform a meaningful audited action -----------------
    await page.goto('/admin/settings');
    const nameInput = page.getByLabel('Workspace name');
    await nameInput.fill(newName);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    // ---- 2. open Admin -> Audit log ---------------------------
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();

    // filter to the action and find the row
    await page.getByLabel('Action').fill('tenant.updated');
    const row = page.locator('tr', { hasText: 'tenant.updated' }).first();
    await expect(row).toBeVisible();
    await expect(row).toContainText('identity'); // module badge

    // ---- 3. inspect the detail drawer ------------------------
    await row.click();
    const drawer = page.locator('aside').last();
    await expect(drawer.getByRole('heading', { name: 'Audit entry' })).toBeVisible();
    await expect(drawer.getByText('tenant.updated')).toBeVisible();
    await expect(drawer.getByText('identity')).toBeVisible();
    // the change is rendered human-readably (from -> to), not raw JSON
    await expect(drawer.getByText('Changes')).toBeVisible();
    await expect(drawer.getByText(newName)).toBeVisible();
    // actor is a person, not "system", and named
    await expect(drawer.getByText('Person', { exact: true })).toBeVisible();
    // correlation id captured
    await expect(drawer.getByText('Correlation ID')).toBeVisible();
    // close the drawer before touching the filter bar again
    await drawer.getByRole('button', { name: 'Close' }).click();

    // ---- 4. the module filter narrows the list ----------------
    await page.getByLabel('Action').fill('');
    const listResponse = page.waitForResponse(
      (r) => r.url().includes('/admin/audit?') && r.url().includes('module=identity'),
    );
    await page.getByLabel('Module').selectOption('identity');
    await listResponse;
    await expect(page.locator('tbody tr').first()).toBeVisible();
    // every visible action row belongs to the identity module
    const badges = await page.locator('tbody tr td:nth-child(4)').allTextContents();
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) if (b.trim()) expect(b.trim().toLowerCase()).toBe('identity');

    // ---- 5. no secret ever leaks into an audit row -----------
    const raw = await page.request.get(`${API_BASE}/api/v1/admin/audit?pageSize=100`);
    const body = await raw.text();
    expect(body.toLowerCase()).not.toContain('password');
    expect(body).not.toContain('secretHash');
    expect(body).not.toContain('Demo-Passw0rd');

    // ---- 6. another tenant cannot see this row (optional) ----
    if (OTHER_EMAIL && OTHER_PASSWORD) {
      const other = await browser.newContext();
      const otherPage = await other.newPage();
      await signIn(otherPage, OTHER_EMAIL, OTHER_PASSWORD);
      const otherList = await otherPage.request.get(`${API_BASE}/api/v1/admin/audit?pageSize=100`);
      expect(await otherList.text()).not.toContain(newName);
      await other.close();
    }
  });
});
