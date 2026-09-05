import { expect, test } from '@playwright/test';

/**
 * Procurement → inventory → logistics golden path (Phase 5, ADR 0034).
 *
 * A tenant admin drives the whole operational slice through the browser: create
 * a CRM lead, open a project against it, add a material requirement, raise and
 * approve a purchase order, receive the goods (stock goes up), allocate the
 * received stock to the project, dispatch it, confirm delivery with a photo,
 * and finally see the project's material readiness reflected back on the CRM
 * lead. Nothing is inserted directly — every step is a real UI action.
 *
 * Opt-in. Needs a running web app + API + database and the supply demo seed
 * (`pnpm --filter @aivoryx/api seed:supply-demo`), which creates the
 * TENANT_ADMIN plus products, suppliers and warehouses:
 *
 *   RUN_SUPPLY_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 \
 *   pnpm --filter @aivoryx/web test:e2e supply.spec.ts
 */
const ENABLED = process.env.RUN_SUPPLY_E2E === '1';
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

const QTY = '10';

test.describe('Supply chain golden path', () => {
  test.skip(!ENABLED || !EMAIL || !PASSWORD, 'set RUN_SUPPLY_E2E=1 + E2E_ADMIN_* to run');
  test.setTimeout(180_000);

  test('lead → project → PO → receive → allocate → dispatch → deliver → CRM readiness', async ({
    page,
  }) => {
    // ---- 1. log in --------------------------------------------------
    await page.goto('/login');
    await page.getByLabel('Email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    // ---- 2. create a CRM lead ------------------------------------
    const leadName = `Supply E2E ${Date.now()}`;
    await page.goto('/crm/leads');
    await page.getByLabel('Name').first().fill(leadName);
    await page.getByLabel('Phone').first().fill(`9${Date.now()}`.slice(0, 10));
    await page.getByRole('button', { name: 'Add lead' }).click();
    await page.waitForURL(/\/crm\/leads\/[0-9a-f-]+$/);
    const leadId = page.url().split('/').pop()!;

    // ---- 3. open a project against the lead ---------------------
    await page.goto('/projects');
    await page.getByLabel('CRM lead').selectOption({ label: leadName });
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]+$/);
    const projectId = page.url().split('/').pop()!;
    const projectNumber = (await page.getByRole('heading', { level: 1 }).textContent())!.trim();

    // ---- 4. approve the project --------------------------------
    await page.getByRole('button', { name: 'Approve project' }).click();
    await expect(page.getByText('approved', { exact: false }).first()).toBeVisible();

    // ---- 5. add a material requirement -------------------------
    const productSelect = page.getByLabel('Add product');
    await productSelect.selectOption({ index: 1 });
    const productLabel = (await productSelect.locator('option:checked').textContent())!.trim();
    await page.getByLabel('Required qty').fill(QTY);
    await page.getByRole('button', { name: 'Add material' }).click();
    await expect(
      page.getByRole('cell', { name: productLabel.split(' — ')[0], exact: false }),
    ).toBeVisible();

    // ---- 6. raise a purchase order ----------------------------
    await page.goto('/procurement/purchase-orders');
    await page.getByLabel('Supplier').selectOption({ index: 1 });
    await page.getByLabel('Project (optional)').selectOption({ label: projectNumber });
    // single line: product + qty
    await page.locator('form select').last().selectOption({ label: productLabel });
    await page.getByPlaceholder('Qty').fill(QTY);
    await page.getByPlaceholder('Unit price').fill('100');
    await page.getByRole('button', { name: 'Create purchase order' }).click();
    await page.waitForURL(/\/procurement\/purchase-orders\/[0-9a-f-]+$/);

    // ---- 7. submit + approve the PO --------------------------
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('approved', { exact: false }).first()).toBeVisible();

    // ---- 8. receive the goods into a warehouse --------------
    await expect(page.getByRole('heading', { name: 'Receive goods' })).toBeVisible();
    await page.getByLabel('Warehouse').selectOption({ index: 1 });
    await page.locator('input[inputmode="decimal"]').first().fill(QTY);
    await page.getByRole('button', { name: 'Confirm receipt' }).click();
    await expect(page.getByText(/GRN-/).first()).toBeVisible();

    // ---- 9. allocate the received stock to the project -----
    await page.goto(`/projects/${projectId}`);
    await page.getByRole('button', { name: 'Allocate' }).first().click();
    await page.getByLabel('Warehouse').selectOption({ index: 1 });
    await page.getByLabel('Quantity').fill(QTY);
    await page.getByRole('button', { name: 'Allocate', exact: true }).last().click();
    // allocated column should now read 10
    await expect(page.getByRole('cell', { name: QTY, exact: true }).first()).toBeVisible();

    // ---- 10. create a dispatch --------------------------------
    await page.goto('/logistics/dispatches');
    await page.getByLabel('Project').selectOption({ label: projectNumber });
    await page.getByLabel('Source warehouse').selectOption({ index: 1 });
    await page.locator('form input[inputmode="decimal"]').first().fill(QTY);
    await page.getByRole('button', { name: 'Create dispatch' }).click();
    await page.waitForURL(/\/logistics\/dispatches\/[0-9a-f-]+$/);

    // ---- 11. mark dispatched + confirm delivery with a photo -
    await page.getByRole('button', { name: 'Mark dispatched' }).click();
    await expect(page.getByRole('button', { name: 'Confirm delivery' })).toBeVisible();

    await page.setInputFiles('input[type="file"]', {
      name: 'proof-of-delivery.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgDTD2qgAAAAASUVORK5CYII=',
        'base64',
      ),
    });
    await expect(page.getByText('proof-of-delivery.png')).toBeVisible();

    await page.getByRole('button', { name: 'Confirm delivery' }).click();
    await expect(page.getByText('delivered', { exact: false }).first()).toBeVisible();

    // ---- 12. CRM lead shows the linked project + readiness --
    await page.goto(`/crm/leads/${leadId}`);
    await expect(page.getByRole('heading', { name: 'Project / operations' })).toBeVisible();
    await expect(page.getByRole('link', { name: projectNumber })).toBeVisible();
    await expect(page.getByText('Material readiness: 100%')).toBeVisible();
  });
});
