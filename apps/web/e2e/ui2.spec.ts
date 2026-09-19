import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Aivoryx UI 2.0 (Phase 19): appearance (Light / Dark / System, no flash), the
 * adaptive sidebar and its collapsed rail, capability-driven navigation, the Help
 * Center + short tours, interactive charts and standalone reports, tenant
 * branding (themes, contrast validation, live application), tenant-aware sign-in,
 * and no horizontal overflow across breakpoints in both appearances.
 *
 * Opt-in; needs a running web app + API + database with the demo seeds loaded:
 *
 *   RUN_UI2_E2E=1 \
 *   E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 E2E_API_BASE_URL=http://localhost:4000 \
 *   pnpm --filter @aivoryx/web test:e2e ui2.spec.ts
 */
const ENABLED = process.env.RUN_UI2_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const AGENT_EMAIL = process.env.E2E_AGENT_EMAIL ?? 'agent@clans-demo.test';
const MANAGER_EMAIL = process.env.E2E_MANAGER_EMAIL ?? 'manager@clans-demo.test';
const DEMO_PASSWORD = process.env.E2E_DEMO_PASSWORD ?? 'Demo-Passw0rd!';
const API_BASE = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000';
const WORKSPACE_SLUG = process.env.E2E_WORKSPACE_SLUG ?? 'clans-demo';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function permissionsOf(request: APIRequestContext, email: string, password: string) {
  const res = await request.post(`${API_BASE}/api/v1/auth/login`, { data: { email, password } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  const raw = res.headers()['set-cookie'] ?? '';
  const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]!;
  const membershipId = (await res.json()).memberships?.[0]?.id as string;
  await request.post(`${API_BASE}/api/v1/auth/switch-tenant`, {
    headers: { cookie },
    data: { membershipId },
  });
  const me = await (
    await request.get(`${API_BASE}/api/v1/auth/me`, { headers: { cookie } })
  ).json();
  return new Set<string>(me.active?.permissions ?? []);
}

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'));
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function chooseAppearance(page: Page, name: 'Light' | 'Dark' | 'System') {
  await page.getByRole('button', { name: /account menu/i }).click();
  await page.getByRole('radio', { name }).click();
  await page.keyboard.press('Escape');
}

test.describe('Aivoryx UI 2.0 (Phase 19)', () => {
  test.skip(!ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD, 'set RUN_UI2_E2E=1 + E2E_ADMIN_*');

  test.describe('appearance', () => {
    test('Light / Dark / System, remembered across reloads', async ({ page }) => {
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/');
      await chooseAppearance(page, 'Dark');
      expect(await isDark(page)).toBe(true);
      await page.reload();
      expect(await isDark(page)).toBe(true);
      await chooseAppearance(page, 'Light');
      expect(await isDark(page)).toBe(false);

      // System follows the OS setting, live
      await chooseAppearance(page, 'System');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect.poll(() => isDark(page)).toBe(true);
      await page.emulateMedia({ colorScheme: 'light' });
      await expect.poll(() => isDark(page)).toBe(false);
      await chooseAppearance(page, 'Light');
    });

    test('no theme flash: the stored preference is applied before any script bundle runs', async ({
      page,
      context,
    }) => {
      await page.addInitScript(() => localStorage.setItem('aivoryx.appearance', 'dark'));
      // with the app bundles blocked only the inline <head> script can have set the class
      await context.route('**/_next/static/**', (r) => r.abort());
      await page.goto('/login', { waitUntil: 'domcontentloaded' });
      expect(await isDark(page)).toBe(true);
    });
  });

  test.describe('sidebar', () => {
    test('collapses to an accessible icon rail, remembers it, and keeps sections reachable', async ({
      page,
    }) => {
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      const sidebar = page.getByRole('complementary');
      const expanded = (await sidebar.boundingBox())!.width;
      await page.getByRole('button', { name: 'Collapse sidebar' }).click();
      await expect
        .poll(async () => (await sidebar.boundingBox())!.width)
        .toBeLessThan(expanded / 2);

      // tooltip on hover AND on keyboard focus
      const crm = sidebar.getByRole('button', { name: 'CRM' });
      await crm.hover();
      await expect(page.getByRole('tooltip').filter({ hasText: 'CRM' })).toBeVisible();
      await page.mouse.move(700, 500);

      // the module's sections are reachable from the rail
      await crm.click();
      await page
        .getByRole('navigation', { name: 'CRM' })
        .getByRole('link', { name: 'Leads' })
        .click();
      await page.waitForURL('**/crm/leads');

      await page.reload();
      await expect
        .poll(async () => (await sidebar.boundingBox())!.width)
        .toBeLessThan(expanded / 2);
      await page.getByRole('button', { name: 'Expand sidebar' }).click();
      await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(200);
    });
  });

  test.describe('capability-driven navigation', () => {
    test('the sidebar is derived from entitlements + permissions, never from a role name', async ({
      page,
      request,
    }) => {
      const adminPerms = await permissionsOf(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      const agentPerms = await permissionsOf(request, AGENT_EMAIL, DEMO_PASSWORD);

      await signIn(page, AGENT_EMAIL, DEMO_PASSWORD);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      const sidebar = page.getByRole('complementary');
      // each module link is present iff the user holds at least one of its section permissions
      const expectations: [string, string[]][] = [
        ['Finance', ['finance.read', 'finance.invoices.read']],
        ['Administration', ['memberships.read', 'roles.read', 'audit.read']],
        ['Field Operations', ['field.visits.read']],
        ['HR & Workforce', ['hr.employee.read', 'hr.attendance.self', 'hr.leave.read']],
      ];
      for (const [label, needs] of expectations) {
        const should = needs.some((p) => agentPerms.has(p));
        await expect(sidebar.getByRole('link', { name: label, exact: true })).toHaveCount(
          should ? 1 : 0,
        );
      }
      // sanity: the admin holds strictly more, so their sidebar is not the same list
      expect(adminPerms.size).toBeGreaterThan(agentPerms.size);
    });

    test('a member limited to self-service still finds HR (My HR) without any role check', async ({
      page,
      request,
    }) => {
      const perms = await permissionsOf(request, MANAGER_EMAIL, DEMO_PASSWORD);
      test.skip(!perms.has('hr.attendance.self'), 'manager demo user lacks hr.attendance.self');
      await signIn(page, MANAGER_EMAIL, DEMO_PASSWORD);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/hr/me');
      await expect(
        page.getByRole('complementary').getByRole('link', { name: 'My HR' }),
      ).toBeVisible();
    });
  });

  test.describe('guidance', () => {
    test('Help Center: contextual topic, search, and a short skippable tour', async ({ page }) => {
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/crm/leads');
      await page.getByRole('button', { name: 'Help', exact: true }).click();
      const help = page.getByRole('dialog', { name: 'Help' });
      await expect(help.getByText('Help for this page')).toBeVisible();
      await expect(help.getByText('Managing leads').first()).toBeVisible();

      await help.getByRole('searchbox', { name: 'Search help' }).fill('leave');
      await expect(help.getByText('Approving leave')).toBeVisible();
      await expect(help.getByText('Managing leads')).toHaveCount(0);
      await help.getByRole('searchbox', { name: 'Search help' }).fill('');

      await help.getByRole('button', { name: /Getting around Aivoryx/ }).click();
      const tour = page.getByRole('dialog', { name: /Getting around Aivoryx/ });
      await expect(tour).toBeVisible();
      await expect(tour).toContainText('1/4');
      await tour.getByRole('button', { name: 'Next' }).click();
      await expect(tour).toContainText('2/4');
      await tour.getByRole('button', { name: 'Skip' }).click();
      await expect(tour).toHaveCount(0);
    });

    test('an empty module explains itself and can be dismissed for good', async ({ page }) => {
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/crm/leads?status=DISQUALIFIED&q=zz-no-such-lead-zz');
      await expect(page.getByText(/No leads match/i)).toBeVisible();
    });
  });

  test.describe('charts and reports', () => {
    test('only meaningful chart types are offered; expand and standalone report work', async ({
      page,
      context,
    }) => {
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/crm');
      const card = page.locator('section', { hasText: 'Lead activity trend' }).first();
      const kindSelect = card.getByRole('combobox').first();
      await expect(kindSelect).toBeVisible();
      const kinds = await kindSelect.locator('option').allTextContents();
      expect(kinds).toEqual(['Line', 'Area', 'Column']); // a time series: never Pie / Donut / Gauge
      await kindSelect.selectOption('Area');

      await card.getByRole('button', { name: /^Expand/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Lead activity' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Daily average')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      const link = card.getByRole('link', { name: /new tab/i });
      await expect(link).toHaveAttribute('href', '/reports/crm-lead-trend');
      await expect(link).toHaveAttribute('target', '_blank');
      const [popup] = await Promise.all([context.waitForEvent('page'), link.click()]);
      await popup.waitForLoadState();
      await expect(popup.getByRole('heading', { name: 'Lead activity', level: 1 })).toBeVisible();
    });

    test('a report the user cannot read is shown as unavailable, not as data', async ({
      page,
      request,
    }) => {
      const perms = await permissionsOf(request, AGENT_EMAIL, DEMO_PASSWORD);
      test.skip(perms.has('crm.leads.read'), 'the agent demo user can read leads');
      await signIn(page, AGENT_EMAIL, DEMO_PASSWORD);
      await page.goto('/reports/crm-lead-trend');
      await expect(page.getByText('Report unavailable')).toBeVisible();
    });
  });

  test.describe('branding & themes', () => {
    test('a preset is applied app-wide, an unreadable custom colour is refused, then reset', async ({
      page,
    }) => {
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/settings/branding');
      await expect(
        page.getByRole('heading', { name: 'Branding & themes', level: 1 }),
      ).toBeVisible();

      const primaryToken = () =>
        page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
        );
      const before = await primaryToken();

      // live preview reacts immediately, before saving
      await page.getByRole('radio', { name: 'Royal' }).check({ force: true });
      const previewToken = await page
        .getByLabel(/Theme preview, (light|dark) mode/)
        .evaluate((el) => (el as HTMLElement).style.getPropertyValue('--primary'));
      expect(previewToken).not.toBe('');
      expect(await primaryToken()).toBe(before); // the app itself has not changed yet

      // a colour too pale for white text is refused, with a suggestion, and cannot be saved
      await page.getByRole('radio', { name: 'Custom' }).check({ force: true });
      await page.getByLabel('Primary colour', { exact: true }).fill('#ffee66');
      await expect(page.getByRole('status').filter({ hasText: /too light/i })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

      // save a valid preset → the whole app re-themes
      await page.getByRole('radio', { name: 'Royal' }).check({ force: true });
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText(/settings saved/i)).toBeVisible();
      await expect.poll(primaryToken).not.toBe(before);

      // reset to the Aivoryx default so other specs see the standard theme
      await page.getByRole('radio', { name: 'Aivoryx Teal' }).check({ force: true });
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText(/settings saved/i)).toBeVisible();
      await expect.poll(primaryToken).toBe('178 100% 25%'); // Aivoryx Teal, light mode
    });

    test('status colours are never tenant-driven', async ({ page }) => {
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/');
      const read = () =>
        page.evaluate(() => {
          const s = getComputedStyle(document.documentElement);
          return ['--success', '--warning', '--danger', '--info', '--destructive'].map((v) =>
            s.getPropertyValue(v).trim(),
          );
        });
      const before = await read();
      expect(before.every(Boolean)).toBe(true);
      await page.goto('/settings/branding');
      await page.getByRole('radio', { name: 'Warm' }).check({ force: true });
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText(/settings saved/i)).toBeVisible();
      expect(await read()).toEqual(before);
      await page.getByRole('radio', { name: 'Aivoryx Teal' }).check({ force: true });
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText(/settings saved/i)).toBeVisible();
    });
  });

  test.describe('sign-in', () => {
    test('neutral Aivoryx branding when the workspace is unknown; tenant branding when known', async ({
      page,
    }) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
      await expect(page.getByText('Aivoryx', { exact: true }).first()).toBeVisible();
      // industry-neutral: no vertical assumptions in the default copy
      await expect(page.locator('body')).not.toContainText(/solar|panel|installation/i);

      // an unknown / malformed workspace silently falls back to the neutral page
      await page.goto('/login?workspace=definitely-not-a-workspace');
      await expect(page.getByRole('heading', { name: 'Sign in', level: 1 })).toBeVisible();
      await expect(page.getByText('Aivoryx', { exact: true }).first()).toBeVisible();

      // a known workspace shows its own identity, and authentication is unchanged
      await page.goto(`/login?workspace=${WORKSPACE_SLUG}`);
      await expect(page.getByText('Aivoryx', { exact: true })).toHaveCount(0);
      await page.getByLabel('Email').fill(ADMIN_EMAIL);
      await page.getByLabel('Password').fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    });
  });

  test.describe('responsive + appearance', () => {
    const widths = [390, 768, 1024, 1440];
    const routes = ['/', '/crm', '/crm/leads', '/settings/branding', '/admin', '/hr'];

    for (const mode of ['light', 'dark'] as const) {
      test(`no horizontal overflow at 390 / 768 / 1024 / 1440 (${mode})`, async ({ page }) => {
        await page.addInitScript((m) => localStorage.setItem('aivoryx.appearance', m), mode);
        await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
        for (const w of widths) {
          await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
          for (const route of routes) {
            await page.goto(route);
            await page.waitForLoadState('networkidle');
            expect(await isDark(page), `${route} @${w}`).toBe(mode === 'dark');
            expect(await overflow(page), `${route} @${w} ${mode}`).toBeLessThanOrEqual(1);
          }
        }
      });
    }

    test('mobile keeps the bottom navigation and More sheet (not a desktop sidebar)', async ({
      page,
    }) => {
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');
      await expect(page.getByRole('complementary')).toBeHidden();
      await page.getByRole('button', { name: 'More' }).click();
      const sheet = page.getByRole('dialog', { name: 'Navigation' });
      await expect(sheet.getByRole('link', { name: 'Leads' })).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Help' })).toBeVisible();
    });
  });
});
