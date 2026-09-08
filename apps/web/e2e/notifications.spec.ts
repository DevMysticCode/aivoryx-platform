import { expect, test } from '@playwright/test';

/**
 * Notifications & Communications Engine golden path (Phase 8, ADR 0037).
 *
 * A real business action (assign a lead to yourself, quote it, send the quote)
 * fires an outbox event; the background worker turns it into an in-app
 * notification that shows in the bell and deep-links to the quotation. Also
 * checks the delivery-history screen, the admin rules screen, and the user
 * preference screen. Email uses the FAKE provider — no real send.
 *
 * Opt-in. Needs a running web app + API + database + Redis, the demo seeds, and
 * the API started with `EMAIL_PROVIDER=fake`:
 *
 *   RUN_NOTIFICATIONS_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 \
 *   pnpm --filter @aivoryx/web test:e2e notifications.spec.ts
 */
const ENABLED = process.env.RUN_NOTIFICATIONS_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000';

test.describe('Notifications engine golden path', () => {
  test.skip(
    !ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD,
    'set RUN_NOTIFICATIONS_E2E=1 + E2E_ADMIN_*',
  );
  test.setTimeout(180_000);

  test('business event → in-app bell + delivery history + config screens', async ({ page }) => {
    // ---- 1. sign in -----------------------------------------------
    await page.goto('/login');
    await page.getByLabel('Email').fill(ADMIN_EMAIL);
    await page.getByLabel('Password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/admin');

    // ---- 2. lead → assign to me → quotation → send -------------
    const leadName = `Notify E2E ${Date.now()}`;
    await page.goto('/crm/leads');
    await page.getByRole('button', { name: 'New lead' }).click();
    await page.getByLabel('Name').first().fill(leadName);
    await page.getByLabel('Phone').first().fill(`9${Date.now()}`.slice(0, 10));
    await page.getByRole('button', { name: 'Create lead' }).click();
    await page.waitForURL(/\/crm\/leads\/[0-9a-f-]+$/);

    // resolve the admin's own membership id and assign the lead to it, so the
    // "lead owner" recipient for quotation.sent is this signed-in admin
    const membersRes = await page.request.get(`${API_BASE}/api/v1/admin/members`);
    const members = (await membersRes.json()) as { membershipId: string; email: string }[];
    const adminMembershipId = members.find(
      (m) => m.email.toLowerCase() === ADMIN_EMAIL.toLowerCase(),
    )!.membershipId;
    const assign = page.locator('select', {
      has: page.locator('option', { hasText: 'Assign to' }),
    });
    await assign.selectOption(adminMembershipId);
    await expect(assign).toHaveValue(adminMembershipId);

    await page.goto('/quotations');
    await page.getByLabel('CRM lead').selectOption({ label: leadName });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await page.waitForURL(/\/quotations\/[0-9a-f-]+$/);
    const quotationId = page.url().split('/').pop()!;

    await page.getByRole('button', { name: 'Edit lines' }).click();
    await page.getByPlaceholder('Description').first().fill('Rooftop solar package');
    await page.getByPlaceholder('Qty').first().fill('1');
    await page.getByPlaceholder('Unit price').first().fill('250000');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Edit lines' })).toBeVisible();
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.getByText('sent', { exact: false }).first()).toBeVisible();

    // ---- 3. the worker turns the event into a notification -----
    // poll the API (worker drains every ~1.5s) so the UI check is a single pass
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`${API_BASE}/api/v1/notifications?unreadOnly=true`);
          if (!res.ok()) return 0;
          const body = (await res.json()) as { items: { title: string }[] };
          return body.items.filter((n) => /Quotation .* sent/i.test(n.title)).length;
        },
        { timeout: 60_000, intervals: [1500] },
      )
      .toBeGreaterThan(0);

    // and it shows in the bell + deep-links to the quotation
    await page.goto('/admin');
    await page.getByRole('button', { name: /Notifications/ }).click();
    await page
      .getByRole('button')
      .filter({ hasText: /Quotation .* sent/i })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/quotations/${quotationId}`));

    // ---- 4. delivery history shows the sent in-app delivery ---
    await page.goto('/admin/notifications/deliveries');
    await expect(page.getByRole('row').filter({ hasText: 'in-app' }).first()).toContainText(
      /sent/,
      { timeout: 15_000 },
    );

    // ---- 5. admin rules: toggle + persist across reload -------
    await page.goto('/admin/notifications');
    const card = page.locator('div.rounded-lg.border', {
      hasText: 'workspace admins in-app when a new lead is captured',
    });
    const toggle = card.getByRole('checkbox').first();
    const was = await toggle.isChecked();
    await toggle.click();
    await page.waitForTimeout(600);
    await page.reload();
    await expect(
      page
        .locator('div.rounded-lg.border', {
          hasText: 'workspace admins in-app when a new lead is captured',
        })
        .getByRole('checkbox')
        .first(),
    ).toBeChecked({ checked: !was });

    // ---- 6. user preferences: toggle email, persist ----------
    await page.goto('/settings/notifications');
    const email = page.getByRole('checkbox').nth(1);
    const emailWas = await email.isChecked();
    await email.click();
    await page.waitForTimeout(600);
    await page.reload();
    await expect(page.getByRole('checkbox').nth(1)).toBeChecked({ checked: !emailWas });
    await page.getByRole('checkbox').nth(1).click(); // restore
  });
});
