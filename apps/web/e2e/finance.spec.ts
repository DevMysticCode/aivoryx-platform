import { expect, test } from '@playwright/test';

/**
 * Finance golden path (Phase 9, ADR 0038).
 *
 * Create a customer → draft an invoice with a line → issue it → record a
 * partial payment (PARTIALLY_PAID) → record the remainder (PAID) → verify the
 * customer financial summary → verify the "invoice issued" notification reached
 * the Phase 8 engine (email delivery captured by the fake provider — never a
 * real send).
 *
 * Opt-in. Needs a running web app + API + database + Redis, the demo seeds, and
 * the API started with `EMAIL_PROVIDER=fake`:
 *
 *   RUN_FINANCE_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 \
 *   pnpm --filter @aivoryx/web test:e2e finance.spec.ts
 */
const ENABLED = process.env.RUN_FINANCE_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000';

test.describe('Finance golden path', () => {
  test.skip(!ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD, 'set RUN_FINANCE_E2E=1 + E2E_ADMIN_*');
  test.setTimeout(180_000);

  test('invoice → issue → partial payment → paid → customer summary → notification', async ({
    page,
  }) => {
    const stamp = Date.now();
    await page.goto('/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    // ---- 1. a customer with an email ----------------------------
    await page.goto('/customers');
    await page.getByLabel('Name').fill(`Finance E2E ${stamp}`);
    await page.getByLabel('Email').fill(`fin-${stamp}@example.test`);
    await page.getByRole('button', { name: 'Create customer' }).click();
    await expect(page.getByText(`Finance E2E ${stamp}`).first()).toBeVisible();

    // ---- 2. draft an invoice ---------------------------------
    await page.goto('/finance/invoices');
    await page.getByRole('button', { name: 'New invoice' }).click();
    const custSelect = page.getByLabel('Customer');
    for (const opt of await custSelect.locator('option').all()) {
      const txt = (await opt.textContent()) ?? '';
      const val = await opt.getAttribute('value');
      if (val && txt.includes(`Finance E2E ${stamp}`)) {
        await custSelect.selectOption(val);
        break;
      }
    }
    await expect(custSelect).not.toHaveValue('');
    await page.getByPlaceholder('Description').first().fill('Design & build');
    await page.getByPlaceholder('Qty').first().fill('10');
    await page.getByPlaceholder('Unit price').first().fill('1000');
    await page.getByPlaceholder('Tax rate').first().fill('0');
    await page.getByRole('button', { name: 'Create draft' }).click();
    await page.waitForURL(/\/finance\/invoices\/[0-9a-f-]+$/);
    const invoiceUrl = page.url();

    await expect(page.getByText('DRAFT').first()).toBeVisible();
    // 10 × 1000, no tax
    await expect(page.getByText('10,000.00').first()).toBeVisible();

    // ---- 3. issue -----------------------------------------
    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await expect(page.getByText('ISSUED').first()).toBeVisible();

    // ---- 4. partial payment -> PARTIALLY_PAID ------------
    await page.getByRole('button', { name: 'Record payment' }).click();
    await page.locator('label', { hasText: 'Amount (INR)' }).locator('input').fill('4000');
    await page.getByRole('button', { name: 'Record & allocate' }).click();
    await expect(page.getByText('partially paid').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('6,000.00').first()).toBeVisible();

    // ---- 5. remainder -> PAID ---------------------------
    await page.getByRole('button', { name: 'Record payment' }).click();
    await page.locator('label', { hasText: 'Amount (INR)' }).locator('input').fill('6000');
    await page.getByRole('button', { name: 'Record & allocate' }).click();
    await expect(page.getByText('paid').first()).toBeVisible({ timeout: 10_000 });

    // ---- 6. customer financial summary -----------------
    await page.goto('/customers');
    await page.getByPlaceholder('Name, number, phone or email').fill(`Finance E2E ${stamp}`);
    await page
      .getByRole('link', { name: new RegExp(`Finance E2E ${stamp}`) })
      .first()
      .click();
    await page.waitForURL(/\/customers\/[0-9a-f-]+$/);
    const financeCard = page.locator('section', { hasText: 'Finance' }).first();
    await expect(financeCard).toContainText('Invoiced');
    await expect(financeCard.getByText('10,000.00').first()).toBeVisible();
    // outstanding zero
    await expect(financeCard).toContainText('0.00');

    // ---- 7. the invoice-issued notification reached Phase 8 ----
    await expect
      .poll(
        async () => {
          const res = await page.request.get(
            `${API_BASE}/api/v1/admin/notifications/deliveries?status=sent&pageSize=50`,
          );
          if (!res.ok()) return 0;
          const body = (await res.json()) as { items: { sourceEventType: string }[] };
          return body.items.filter((d) => d.sourceEventType === 'invoice.issued').length;
        },
        { timeout: 60_000, intervals: [2000] },
      )
      .toBeGreaterThan(0);

    // sanity: the invoice detail still loads
    await page.goto(invoiceUrl);
    await expect(page.getByText('PAID').first()).toBeVisible();
  });
});
