import { expect, test, type Page } from '@playwright/test';

/**
 * HR Core (Phase 17) — the workflows added on top of the Phase 12 HR module:
 * the ONBOARDING lifecycle, organisation archive/restore, HR data scope for a
 * team manager, employee self-service (clock in/out, shared documents), the
 * Field → HR employee link, the reworked HR dashboard, and a responsive
 * no-horizontal-overflow check at 390 / 768 / 1024 / 1440.
 *
 * Opt-in; needs a running web app + API + database with the demo seeds loaded,
 * including `seed:hr-demo` and `seed:hr-core-demo`:
 *
 *   RUN_HR_CORE_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 \
 *   pnpm --filter @aivoryx/web test:e2e hr-core.spec.ts
 */
const ENABLED = process.env.RUN_HR_CORE_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL ?? 'manager@clans-demo.test';
const AGENT_EMAIL = process.env.E2E_AGENT_EMAIL ?? 'agent@clans-demo.test';
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Demo-Passw0rd!';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );

test.describe('HR Core (Phase 17)', () => {
  test.skip(!ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD, 'set RUN_HR_CORE_E2E=1 + E2E_ADMIN_*');

  const stamp = Date.now().toString(36);

  test('admin: dashboard shows real metrics, what needs attention and recent activity', async ({
    page,
  }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/hr');
    await expect(page.getByRole('heading', { level: 1, name: 'HR & Workforce' })).toBeVisible();
    for (const section of ['Key metrics', 'Needs attention', 'Recent activity']) {
      await expect(page.getByRole('heading', { level: 2, name: section })).toBeVisible();
    }
    await expect(page.getByText('Present today')).toBeVisible();
    // the seeded onboarding hire is surfaced as an upcoming start, linking to their profile
    await expect(page.getByRole('link', { name: /Kabir Shah/ }).first()).toBeVisible();
  });

  test('admin: hire someone into ONBOARDING, then start them', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/hr/employees');
    await page.getByRole('button', { name: 'New employee' }).click();

    const last = `Onboard${stamp}`;
    await page.getByLabel('First name').fill('Tara');
    await page.getByLabel('Last name').fill(last);
    await page.getByLabel('Joining date').fill('2030-02-01');
    await page.getByLabel('Employment start').selectOption('ONBOARDING');

    // reporting manager: server-searched combobox, not a page-limited <select>
    const manager = page.getByRole('combobox', { name: 'Reporting manager' });
    await manager.fill('Vikram');
    await expect(page.getByRole('option', { name: /Vikram Singh/ })).toBeVisible();
    await manager.press('Enter');
    await expect(page.getByTestId('manager-selected')).toHaveText('Vikram Singh');

    await page.getByRole('button', { name: 'Create employee' }).click();
    await page.waitForURL('**/hr/employees/**');

    // the profile leads with the onboarding state and its single next action
    const banner = page.getByRole('status').filter({ hasText: 'Onboarding — starts' });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Mark as started' }).click();
    await expect(banner).toBeHidden();

    await page.getByRole('tab', { name: 'Employment' }).click();
    await expect(page.getByText(/^active$/i).first()).toBeVisible();
  });

  test('admin: rename, archive and restore a department', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/hr/organization');
    await page.getByRole('tab', { name: 'Departments' }).click();

    const name = `Temp Dept ${stamp}`;
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Code', { exact: true }).fill(`T${stamp}`.toUpperCase().slice(0, 12));
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();

    const renamed = `${name} (renamed)`;
    await page.getByRole('button', { name: `Rename ${name}` }).click();
    await page.getByLabel(`New name for ${name}`).fill(renamed);
    await page.getByLabel(`New name for ${name}`).press('Enter');
    await expect(page.getByRole('cell', { name: renamed, exact: true })).toBeVisible();

    await page.getByRole('button', { name: `Archive ${renamed}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    // archived units drop out of the default view…
    await expect(page.getByRole('cell', { name: renamed, exact: true })).toBeHidden();
    // …but stay reachable and restorable
    await page.getByLabel('Show archived').check();
    await expect(page.getByRole('cell', { name: renamed, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Restore ${renamed}` }).click();
    await page.getByLabel('Show archived').uncheck();
    await expect(page.getByRole('cell', { name: renamed, exact: true })).toBeVisible();
  });

  test('team manager: HR data scope shows only their team, never the whole company', async ({
    page,
  }) => {
    await signIn(page, MANAGER_EMAIL, DEMO_PASSWORD);
    await page.goto('/hr/employees');
    await expect(page.getByRole('heading', { level: 1, name: 'Employees' })).toBeVisible();

    // Neha + her two direct reports
    for (const person of ['Neha Kulkarni', 'Ravi Menon', 'Priya Nair']) {
      await expect(page.getByRole('link', { name: person })).toBeVisible();
    }
    // nobody outside the team, even though they hold hr.employee.read
    for (const person of ['Asha Rao', 'Vikram Singh', 'Iqbal Ahmed', 'Meera Iyer']) {
      await expect(page.getByRole('link', { name: person })).toHaveCount(0);
    }

    // and the dashboard counts the team, not the company
    await page.goto('/hr');
    await expect(page.getByRole('heading', { level: 1, name: 'HR & Workforce' })).toBeVisible();
    await expect(page.getByText(/3 active · 0 onboarding/)).toBeVisible();
  });

  test('team manager: an employee outside their team is simply not found', async ({
    page,
    browser,
  }) => {
    // find a non-report's profile URL as admin
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await signIn(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
    await adminPage.goto('/hr/employees');
    await adminPage.getByRole('link', { name: 'Iqbal Ahmed' }).click();
    await adminPage.waitForURL('**/hr/employees/**');
    const outsiderPath = new URL(adminPage.url()).pathname;
    await adminCtx.close();

    await signIn(page, MANAGER_EMAIL, DEMO_PASSWORD);
    await page.goto(outsiderPath);
    await expect(page.getByText(/does not exist in this workspace/i)).toBeVisible();
    await expect(page.getByText('Iqbal Ahmed')).toHaveCount(0);
  });

  test('employee: only documents HR has shared appear in self-service', async ({
    page,
    browser,
  }) => {
    // HR uploads a document for the field agent (Ravi Menon), starting HR-only
    const adminCtx = await browser.newContext();
    const adminPage = await adminCtx.newPage();
    await signIn(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
    await adminPage.goto('/hr/employees');
    await adminPage.getByRole('link', { name: 'Ravi Menon' }).click();
    await adminPage.waitForURL('**/hr/employees/**');
    await adminPage.getByRole('tab', { name: 'Documents' }).click();

    const title = `Contract ${stamp}`;
    await adminPage.getByLabel('Document file').setInputFiles({
      name: 'contract.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(`%PDF-1.4 e2e ${stamp}`),
    });
    await adminPage.getByLabel('Title').fill(title);
    await adminPage.getByLabel('Type').selectOption('contract');
    await adminPage.getByRole('button', { name: 'Upload' }).click();
    const row = adminPage.getByRole('row', { name: new RegExp(title) });
    await expect(row).toBeVisible();
    await expect(row.getByText('HR only')).toBeVisible();

    // the employee cannot see it yet
    await signIn(page, AGENT_EMAIL, DEMO_PASSWORD);
    await page.goto('/hr/me');
    await expect(page.getByRole('heading', { level: 2, name: 'My documents' })).toBeVisible();
    await expect(page.getByRole('cell', { name: title, exact: true })).toHaveCount(0);

    // HR shares it → now it appears, with a proxied download link (never a storage URL)
    await row.getByRole('button', { name: 'Share with employee' }).click();
    await expect(row.getByText('Shared with employee')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('cell', { name: title, exact: true })).toBeVisible();
    const link = page.getByRole('link', { name: new RegExp(`Download.*${title}`) });
    await expect(link).toHaveAttribute(
      'href',
      /\/api\/v1\/hr\/me\/documents\/[0-9a-f-]+\/download$/,
    );

    // un-share: gone again
    await row.getByRole('button', { name: 'Make HR-only' }).click();
    await expect(row.getByText('HR only')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('cell', { name: title, exact: true })).toHaveCount(0);
    await adminCtx.close();
  });

  test('employee: self-service clock in and out', async ({ page }) => {
    // the team-manager profile carries hr.attendance.self (the field-agent role does not, so
    // it is correctly never offered a clock)
    await signIn(page, MANAGER_EMAIL, DEMO_PASSWORD);
    await page.goto('/hr/me');
    await expect(page.getByRole('heading', { level: 2, name: 'Today' })).toBeVisible();

    // state-tolerant: seeded/previous runs may already have today's record
    const checkIn = page.getByRole('button', { name: 'Check in' });
    const checkOut = page.getByRole('button', { name: 'Check out' });
    if (await checkIn.isVisible()) {
      await checkIn.click();
      await expect(checkOut).toBeVisible();
    }
    if (await checkOut.isVisible()) {
      await checkOut.click();
    }
    await expect(page.getByText('Done for today')).toBeVisible();
    await expect(checkIn).toHaveCount(0);
    await expect(checkOut).toHaveCount(0);
  });

  test('admin: Field agents list links to the HR employee record', async ({ page }) => {
    await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto('/admin/field-agents');
    const link = page.getByRole('link', { name: 'Ravi Menon' });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /\/hr\/employees\/[0-9a-f-]+$/);
  });

  for (const width of [390, 768, 1024, 1440]) {
    test(`responsive: HR screens have no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);

      await page.goto('/hr/employees');
      await page.getByRole('link', { name: 'Ravi Menon' }).click();
      await page.waitForURL('**/hr/employees/**');
      const profilePath = new URL(page.url()).pathname;

      for (const path of ['/hr', '/hr/employees', profilePath, '/hr/organization', '/hr/me']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        expect(await noHorizontalScroll(page), `${path} @ ${width}px`).toBe(true);
      }

      // the create form and the documents tab are the densest screens
      await page.goto('/hr/employees');
      await page.getByRole('button', { name: 'New employee' }).click();
      await expect(page.getByRole('combobox', { name: 'Reporting manager' })).toBeVisible();
      expect(await noHorizontalScroll(page), `create form @ ${width}px`).toBe(true);

      await page.goto(profilePath);
      await page.getByRole('tab', { name: 'Documents' }).click();
      await expect(page.getByLabel('Document file')).toBeVisible();
      expect(await noHorizontalScroll(page), `documents @ ${width}px`).toBe(true);
    });
  }
});
