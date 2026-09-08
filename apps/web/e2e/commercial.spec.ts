import { expect, test } from '@playwright/test';

/**
 * Commercial golden path (Phase 6, ADR 0035).
 *
 * A user takes a real CRM lead through the commercial workflow in the browser:
 * create a quotation, add a product line and a service line, see the total
 * compute, send it, record acceptance, and book it — which promotes the
 * customer and activates an operational project. Then the CRM lead shows the
 * linked quotation and project, and the project opens.
 *
 * Opt-in. Needs a running web app + API + database and the commercial demo
 * seed (`pnpm --filter @aivoryx/api seed:commercial-demo`, which also needs
 * the supply demo seed for products):
 *
 *   RUN_COMMERCIAL_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 \
 *   pnpm --filter @aivoryx/web test:e2e commercial.spec.ts
 */
const ENABLED = process.env.RUN_COMMERCIAL_E2E === '1';
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

test.describe('Commercial golden path', () => {
  test.skip(!ENABLED || !EMAIL || !PASSWORD, 'set RUN_COMMERCIAL_E2E=1 + E2E_ADMIN_* to run');
  test.setTimeout(180_000);

  test('lead → quotation → lines → send → accept → book → project + CRM linkage', async ({
    page,
  }) => {
    // ---- 1. log in --------------------------------------------------
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    // ---- 2. create a CRM lead -----------------------------------
    const leadName = `Commercial E2E ${Date.now()}`;
    await page.goto('/crm/leads');
    await page.getByRole('button', { name: 'New lead' }).click();
    await page.getByLabel('Name').first().fill(leadName);
    await page.getByLabel('Phone').first().fill(`9${Date.now()}`.slice(0, 10));
    await page.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/crm\/leads\/[0-9a-f-]+$/);
    const leadId = page.url().split('/').pop()!;

    // ---- 3. create a quotation for the lead --------------------
    await page.goto('/quotations');
    await page.getByLabel('CRM lead').selectOption({ label: leadName });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/quotations\/[0-9a-f-]+$/);
    const quotationId = page.url().split('/').pop()!;
    const quotationNumber = (await page.getByRole('heading', { level: 1 }).textContent())!.trim();

    // ---- 4. add a product line + a service line, save ----------
    await page.getByRole('button', { name: 'Edit lines' }).click();
    // line 1 — pick the first real product from the catalogue
    await page.locator('form select, .space-y-3 select').first().selectOption({ index: 1 });
    const row1 = page
      .locator('div.grid')
      .filter({ has: page.getByPlaceholder('Unit price') })
      .first();
    await row1.getByPlaceholder('Qty').fill('10');
    await row1.getByPlaceholder('Unit price').fill('9500');
    await row1.getByPlaceholder('Tax rate').fill('0.18');
    // line 2 — a custom/service line
    await page.getByRole('button', { name: '+ Add line' }).click();
    const row2 = page
      .locator('div.grid')
      .filter({ has: page.getByPlaceholder('Unit price') })
      .nth(1);
    await row2.locator('input[placeholder="Description"]').fill('Installation & commissioning');
    await row2.getByPlaceholder('Qty').fill('1');
    await row2.getByPlaceholder('Unit price').fill('35000');
    await row2.getByPlaceholder('Tax rate').fill('0.18');

    await expect(page.getByText(/Preview .* total/)).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    // saved totals: (10*9500)*1.18 + 35000*1.18 = 112100 + 41300 = 153400
    await expect(page.getByText('Total: 153,400.00')).toBeVisible();

    // ---- 5. send -> accept -> book ---------------------------
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('sent', { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Record acceptance' }).click();
    await expect(page.getByText('accepted', { exact: false }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Book', exact: true }).click();
    await expect(page.getByText('booked', { exact: false }).first()).toBeVisible();

    // the quotation now links a project
    const projectLink = page.getByRole('link', { name: /^PRJ-/ });
    await expect(projectLink).toBeVisible();
    const projectNumber = (await projectLink.textContent())!.trim();

    // ---- 6. CRM lead shows the quotation + the project -------
    await page.goto(`/crm/leads/${leadId}`);
    await page.getByRole('button', { name: 'Related' }).click();
    await expect(page.getByRole('heading', { name: 'Quotations' })).toBeVisible();
    await expect(page.getByRole('link', { name: quotationNumber })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Project / operations' })).toBeVisible();
    await expect(page.getByRole('link', { name: projectNumber })).toBeVisible();

    // ---- 7. the project opens and is operationally APPROVED --
    await page.goto(`/quotations/${quotationId}`);
    await page.getByRole('link', { name: projectNumber }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    await expect(page.getByText('approved', { exact: false }).first()).toBeVisible();
  });
});
