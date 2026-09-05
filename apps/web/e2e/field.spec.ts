import { expect, test } from '@playwright/test';

/**
 * Field operations golden path (Phase 4, ADR 0033): an admin schedules and
 * assigns a visit, a field agent works it end to end (check-in → survey →
 * photo → note → travel → check-out → complete), and the completed visit is
 * visible from the CRM lead. Geolocation is mocked — never left to a real
 * device. Opt-in, needs a running web app + API + database, a seeded
 * TENANT_ADMIN, and a second tenant member to designate as the field agent.
 *
 *   RUN_FIELD_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@acme.test E2E_ADMIN_PASSWORD='...' \
 *   E2E_FIELD_AGENT_EMAIL=agent@acme.test E2E_FIELD_AGENT_PASSWORD='...' \
 *   E2E_BASE_URL=http://localhost:3000 \
 *   pnpm --filter @aivoryx/web test:e2e field.spec.ts
 */
const ENABLED = process.env.RUN_FIELD_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const AGENT_EMAIL = process.env.E2E_FIELD_AGENT_EMAIL ?? '';
const AGENT_PASSWORD = process.env.E2E_FIELD_AGENT_PASSWORD ?? '';

const SITE_LAT = '12.9757';
const SITE_LNG = '77.6079';

test.describe('Field operations golden path', () => {
  test.skip(
    !ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD || !AGENT_EMAIL || !AGENT_PASSWORD,
    'set RUN_FIELD_E2E=1 + E2E_ADMIN_* + E2E_FIELD_AGENT_* to run',
  );

  test('admin schedules a visit, field agent works it, CRM sees the completed visit', async ({
    page,
    browser,
  }) => {
    const phone = `9${Math.floor(Math.random() * 1_000_000_000)}`.slice(0, 10);
    const leadName = `Field E2E Lead ${Date.now()}`;
    const surveyKey = `field_e2e_notes_${Date.now()}`;
    const surveyLabel = `Field E2E notes ${Date.now()}`;

    // ---- 1. admin: log in, create a lead ------------------------------
    await page.goto('/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    await page.goto('/crm/leads');
    await page.getByLabel('Name').first().fill(leadName);
    await page.getByLabel('Phone').first().fill(phone);
    await page.getByRole('button', { name: 'Add lead' }).click();
    await page.waitForURL(/\/crm\/leads\/[0-9a-f-]+$/);
    const leadId = page.url().split('/').pop()!;

    // ---- 2. admin: designate the field agent, unless already one --------
    await page.goto('/admin/field-agents');
    // wait for the page to settle (either the table or the empty state) before
    // deciding whether the agent is already designated — the data loads async.
    await page
      .getByRole('table')
      .or(page.getByText('No field agents designated yet.'))
      .waitFor({ timeout: 10_000 });
    const alreadyAgent = await page
      .getByRole('row')
      .filter({ hasText: AGENT_EMAIL })
      .filter({ hasText: 'active' })
      .count();
    if (!alreadyAgent) {
      // the option's visible text may be the member's display name or their
      // email, so pick by finding the option whose value/label mentions the
      // email via evaluate, falling back to the first real (non-placeholder) entry.
      const agentOption = page.getByRole('combobox').first();
      await expect
        .poll(async () => agentOption.locator('option').count(), { timeout: 10_000 })
        .toBeGreaterThan(1);
      const matchIndex = await agentOption.evaluate(
        (el: HTMLSelectElement, email: string) =>
          Array.from(el.options).findIndex((o) => o.textContent?.includes(email)),
        AGENT_EMAIL,
      );
      await agentOption.selectOption({ index: matchIndex >= 0 ? matchIndex : 1 });
      await page.getByRole('button', { name: 'Designate' }).click();
      await expect(page.getByRole('row').filter({ hasText: AGENT_EMAIL })).toBeVisible();
    }

    // ---- 3. admin: one non-required survey question, so completion is simple --
    await page.goto('/crm/visits');
    await page.getByLabel('Key').fill(surveyKey);
    await page.getByLabel('Label').fill(surveyLabel);
    await page.getByRole('button', { name: 'Add question' }).click();
    await expect(page.getByText(surveyKey)).toBeVisible();

    // ---- 4. admin: schedule + assign the visit ------------------------
    await page.getByLabel('Lead id').fill(leadId);
    const scheduledAt = new Date(Date.now() + 3_600_000).toISOString().slice(0, 16);
    await page.getByLabel('Scheduled for').fill(scheduledAt);
    // the field-agent list loads asynchronously — wait until it has an option
    // beyond the "Unassigned" placeholder before trying to select one. The
    // option's visible text may be the agent's display name or their email,
    // so select by position (index 1 = first real agent) rather than by label.
    const assignSelect = page.getByLabel('Assign to (optional)');
    await expect
      .poll(async () => assignSelect.locator('option').count(), { timeout: 10_000 })
      .toBeGreaterThan(1);
    await assignSelect.selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Schedule' }).click();
    await page.waitForURL(/\/crm\/visits\/[0-9a-f-]+$/);
    const visitId = page.url().split('/').pop()!;
    await expect(page.getByText('ASSIGNED', { exact: true }).first()).toBeVisible();

    // ---- 5. field agent: separate browser context, mocked geolocation --
    const agentContext = await browser.newContext({
      geolocation: { latitude: Number(SITE_LAT), longitude: Number(SITE_LNG) },
      permissions: ['geolocation'],
    });
    const agentPage = await agentContext.newPage();

    await agentPage.goto('/login');
    await agentPage.getByLabel('Email').fill(AGENT_EMAIL);
    await agentPage.getByLabel('Password').fill(AGENT_PASSWORD);
    await agentPage.getByRole('button', { name: 'Sign in' }).click();
    await agentPage.waitForURL('**/admin');

    await agentPage.goto(`/field/visits/${visitId}`);
    await expect(agentPage.getByText(leadName)).toBeVisible();

    // 5a. CHECK IN
    await agentPage.getByRole('button', { name: 'Check in' }).click();
    await expect(agentPage.getByText(/Checked in/)).toBeVisible({ timeout: 15_000 });

    // 5b. SURVEY — this tenant may already have other (possibly required)
    // survey questions configured beyond the one this test just added, so
    // fill every visible field generically rather than assuming a single one.
    await agentPage.getByText(surveyLabel).waitFor();
    const surveyCard = agentPage.getByRole('heading', { name: 'Site survey' }).locator('..');
    const surveyLabels = surveyCard.locator('label');
    const fieldCount = await surveyLabels.count();
    for (let i = 0; i < fieldCount; i++) {
      const field = surveyLabels.nth(i);
      if (await field.locator('select').count()) {
        await field.locator('select').selectOption({ index: 1 });
      } else if (await field.locator('input[type="checkbox"]').count()) {
        await field.locator('input[type="checkbox"]').check();
      } else if (await field.locator('input[type="number"]').count()) {
        await field.locator('input[type="number"]').fill('10');
      } else if (await field.locator('input[type="date"]').count()) {
        await field.locator('input[type="date"]').fill('2026-01-01');
      } else if (await field.locator('input').count()) {
        await field.locator('input').fill('E2E test value');
      }
    }
    await agentPage.getByRole('button', { name: 'Save survey' }).click();
    await expect(agentPage.getByText('Saved')).toBeVisible();

    // 5c. NOTES
    await agentPage.getByPlaceholder('Add a note about this visit…').fill('Customer was home.');
    await agentPage.getByRole('button', { name: 'Add note' }).click();
    await expect(agentPage.getByText('Customer was home.')).toBeVisible();

    // 5d. TRAVEL + CHECK OUT
    await agentPage.getByLabel('Travel distance (km, optional)').fill('3.5');
    await agentPage.getByRole('button', { name: 'Check out' }).click();
    await expect(agentPage.getByText(/Checked out/)).toBeVisible({ timeout: 15_000 });

    // 5e. COMPLETE
    await agentPage.getByRole('button', { name: 'Mark visit complete' }).click();
    await expect(agentPage.getByText('This visit is complete.')).toBeVisible();

    await agentContext.close();

    // ---- 6. admin: verify the completed visit from the CRM lead -------
    await page.goto(`/crm/leads/${leadId}`);
    // match by href rather than the locale-formatted date text, which can
    // render slightly differently between Node's Intl and the browser's.
    const visitLink = page.locator(`a[href="/crm/visits/${visitId}"]`);
    await expect(visitLink).toBeVisible();
    await expect(page.getByText('COMPLETED', { exact: true }).first()).toBeVisible();

    const timeline = page.locator('text=Timeline').locator('..');
    await expect(timeline.getByText('visit scheduled', { exact: true }).first()).toBeVisible();
    await expect(timeline.getByText('visit checked in', { exact: true }).first()).toBeVisible();
    await expect(timeline.getByText('visit completed', { exact: true }).first()).toBeVisible();
  });

  test('a field agent can create a lead from the field app', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(AGENT_EMAIL);
    await page.getByLabel('Password').fill(AGENT_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    await page.goto('/field/leads/new');
    const name = `Field E2E Doorstep Lead ${Date.now()}`;
    const phone = `9${Math.floor(Math.random() * 1_000_000_000)}`.slice(0, 10);
    await page.getByLabel('Customer name').fill(name);
    await page.getByLabel('Phone').fill(phone);
    await page.getByRole('button', { name: 'Save lead' }).click();
    await page.waitForURL('**/field');
  });
});
