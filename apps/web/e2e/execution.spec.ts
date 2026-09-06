import { expect, test, type Page } from '@playwright/test';

/**
 * EPC project execution golden path (Phase 7, ADR 0036).
 *
 * A booked project is driven through the whole execution lifecycle in the
 * browser: start execution, assign an installation to a field agent, the field
 * agent works it in the PWA (start → checklist → photo → complete), the office
 * runs QC (checklist → pass), records net metering + handover, and completes
 * the project — which then shows COMPLETED and appears on the CRM lead
 * timeline. GPS is mocked, never a real device.
 *
 * Opt-in. Needs a running web app + API + database and the demo seeds
 * (`seed:supply-demo`, `seed:field-demo`):
 *
 *   RUN_EXECUTION_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_FIELD_AGENT_EMAIL=agent@clans-demo.test E2E_FIELD_AGENT_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 \
 *   pnpm --filter @aivoryx/web test:e2e execution.spec.ts
 */
const ENABLED = process.env.RUN_EXECUTION_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const AGENT_EMAIL = process.env.E2E_FIELD_AGENT_EMAIL ?? '';
const AGENT_PASSWORD = process.env.E2E_FIELD_AGENT_PASSWORD ?? '';

const SITE = { latitude: 12.9757, longitude: 77.6079 };

/** Tick every enabled, currently-unchecked checkbox under `selector`, one at a
 *  time — each click refetches the view, so re-query between clicks. */
async function tickAll(scope: Page, selector: string): Promise<void> {
  const unchecked = () => scope.locator(`${selector}:not(:disabled):not(:checked)`);
  for (let guard = 0; guard < 30; guard++) {
    const before = await unchecked().count();
    if (before === 0) return;
    // controlled checkbox: each toggle refetches the view. Click the first
    // unchecked one, then wait for the unchecked count to actually drop before
    // re-querying — avoids double-toggling during the React re-render.
    await unchecked().first().click();
    await expect.poll(() => unchecked().count(), { timeout: 10_000 }).toBeLessThan(before);
  }
}

test.describe('EPC execution golden path', () => {
  test.skip(
    !ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD || !AGENT_EMAIL || !AGENT_PASSWORD,
    'set RUN_EXECUTION_E2E=1 + E2E_ADMIN_* + E2E_FIELD_AGENT_*',
  );
  test.setTimeout(180_000);

  test('booked project → installation → QC → net metering → handover → COMPLETED', async ({
    page,
    browser,
  }) => {
    // ---- 1. admin: create + approve a project (a booked project's state) --
    await page.goto('/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    const leadName = `Exec E2E ${Date.now()}`;
    await page.goto('/crm/leads');
    await page.getByLabel('Name').first().fill(leadName);
    await page.getByLabel('Phone').first().fill(`9${Date.now()}`.slice(0, 10));
    await page.getByRole('button', { name: 'Add lead' }).click();
    await page.waitForURL(/\/crm\/leads\/[0-9a-f-]+$/);
    const leadId = page.url().split('/').pop()!;

    await page.goto('/projects');
    await page.getByLabel('CRM lead').selectOption({ label: leadName });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    const projectId = page.url().split('/').pop()!;
    await page.getByRole('button', { name: 'Approve project' }).click();
    await expect(page.getByText('approved', { exact: false }).first()).toBeVisible();

    // ---- 2. admin: designate the field agent (idempotent) -------------
    await page.goto('/admin/field-agents');
    await page
      .getByRole('table')
      .or(page.getByText('No field agents designated yet.'))
      .waitFor({ timeout: 10_000 });
    const already = await page
      .getByRole('row')
      .filter({ hasText: AGENT_EMAIL })
      .filter({ hasText: 'active' })
      .count();
    if (!already) {
      const opts = await page.getByRole('combobox').first().locator('option').all();
      for (const o of opts) {
        const val = await o.getAttribute('value');
        const txt = (await o.textContent()) ?? '';
        if (val && (txt.includes(AGENT_EMAIL) || txt.includes(AGENT_EMAIL.split('@')[0]))) {
          await page.getByRole('combobox').first().selectOption(val);
          break;
        }
      }
      await page.getByRole('button', { name: /Designate|Add field agent/ }).click();
      await expect(page.getByRole('row').filter({ hasText: AGENT_EMAIL })).toBeVisible();
    }

    // ---- 3. admin: start execution, assign the installation ----------
    await page.goto(`/projects/${projectId}/execution`);
    await page.getByRole('button', { name: 'Start execution' }).click();
    await expect(page.getByRole('button', { name: 'Materials' })).toBeVisible();

    await page.getByRole('button', { name: 'Materials' }).click();
    await expect(page.getByText('Material readiness')).toBeVisible();

    await page.getByRole('button', { name: 'Installation', exact: true }).click();
    const assignSelect = page.getByLabel('Assign to field agent');
    const agentSlug = AGENT_EMAIL.split('@')[0];
    let picked = false;
    for (const o of await assignSelect.locator('option').all()) {
      const val = await o.getAttribute('value');
      const txt = (await o.textContent()) ?? '';
      if (val && (txt.includes(AGENT_EMAIL) || txt.toLowerCase().includes(agentSlug))) {
        await assignSelect.selectOption(val);
        picked = true;
        break;
      }
    }
    expect(picked, 'field agent option present in assign select').toBe(true);
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(page.getByText('assigned', { exact: false }).first()).toBeVisible();

    // ---- 4. field agent: work it in the PWA ------------------------
    const agentCtx = await browser.newContext({
      geolocation: SITE,
      permissions: ['geolocation'],
    });
    const fp = await agentCtx.newPage();
    await fp.goto('/login');
    await fp.getByLabel('Email').fill(AGENT_EMAIL);
    await fp.getByLabel('Password').fill(AGENT_PASSWORD);
    await fp.getByRole('button', { name: 'Sign in' }).click();
    await fp.waitForURL('**/admin');

    await fp.goto('/field/projects');
    await fp.getByRole('link').filter({ hasText: /PRJ-/ }).first().click();
    await fp.waitForURL(/\/field\/projects\/[0-9a-f-]+$/);

    await fp.getByRole('button', { name: 'Start installation' }).click();
    await expect(fp.getByText('Checklist')).toBeVisible();

    // tick every checklist item
    await tickAll(fp, 'ul.divide-y li input[type="checkbox"]');

    // add a photo
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgDTD2qgAAAAASUVORK5CYII=',
      'base64',
    );
    await fp.setInputFiles('input[type="file"]', {
      name: 'site.png',
      mimeType: 'image/png',
      buffer: png,
    });
    await expect(fp.getByText('site.png')).toBeVisible();

    await fp.getByRole('button', { name: 'Complete installation' }).click();
    await expect(fp.getByText('Installation complete', { exact: false })).toBeVisible();
    await agentCtx.close();

    // ---- 5. admin: QC -----------------------------------------
    await page.goto(`/projects/${projectId}/execution`);
    await page.getByRole('button', { name: 'QC', exact: true }).click();
    await page.getByRole('button', { name: 'Open QC inspection' }).click();
    await expect(page.getByText(/QC checklist/)).toBeVisible();
    await expect(page.locator('input[type="checkbox"]:not(:disabled)').first()).toBeVisible();

    await tickAll(page, 'input[type="checkbox"]');

    await page.getByRole('button', { name: 'Pass QC' }).click();
    await expect(page.getByText('passed', { exact: false }).first()).toBeVisible();

    // ---- 6. admin: net metering + handover ------------------
    await page.getByRole('button', { name: 'Net Metering' }).click();
    await page.getByLabel('Status').selectOption('COMPLETED');
    await expect(page.getByText('completed', { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Handover', exact: true }).click();
    await tickAll(page, 'input[type="checkbox"]');
    await page.getByLabel('Acknowledged by (name)').fill('Site Owner');
    await page.getByRole('button', { name: 'Save acknowledgement' }).click();
    await page.getByRole('button', { name: 'Complete handover' }).click();
    await expect(page.getByText('completed', { exact: false }).first()).toBeVisible();

    // ---- 7. admin: complete the project -------------------
    await page.getByRole('button', { name: 'Overview' }).click();
    await expect(page.getByText('All requirements met', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Complete project' }).click();
    await expect(page.getByText('completed', { exact: false }).first()).toBeVisible();

    await page.goto(`/projects/${projectId}`);
    await expect(page.getByText('completed', { exact: false }).first()).toBeVisible();

    // ---- 8. CRM lead timeline shows project completion ----
    await page.goto(`/crm/leads/${leadId}`);
    await expect(page.getByText(/project completed/i).first()).toBeVisible();
  });
});
