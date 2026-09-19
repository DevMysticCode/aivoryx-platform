import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Dashboard 2.0 + platform/tenant branding (Phase 20). Opt-in:
 *
 *   RUN_DASH_E2E=1 E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_PLATFORM_ADMIN_EMAIL=platform-admin@aivoryx.test E2E_PLATFORM_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 E2E_API_BASE_URL=http://localhost:4000 \
 *   pnpm --filter @aivoryx/web test:e2e dashboards-branding.spec.ts
 */
const ENABLED = process.env.RUN_DASH_E2E === '1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';
const PA_EMAIL = process.env.E2E_PLATFORM_ADMIN_EMAIL ?? '';
const PA_PASSWORD = process.env.E2E_PLATFORM_ADMIN_PASSWORD ?? '';
const API = process.env.E2E_API_BASE_URL ?? 'http://localhost:4000';
const SLUG = process.env.E2E_WORKSPACE_SLUG ?? 'clans-demo';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

async function apiCookie(request: APIRequestContext, email: string, password: string) {
  const res = await request.post(`${API}/api/v1/auth/login`, { data: { email, password } });
  expect(res.ok(), `login ${email}`).toBeTruthy();
  const raw = res.headers()['set-cookie'] ?? '';
  const cookie = (Array.isArray(raw) ? raw[0]! : raw).split(';')[0]!;
  const membershipId = (await res.json()).memberships?.[0]?.id as string | undefined;
  if (membershipId) {
    await request.post(`${API}/api/v1/auth/switch-tenant`, {
      headers: { cookie },
      data: { membershipId },
    });
  }
  return cookie;
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('Dashboard 2.0 + branding (Phase 20)', () => {
  test.skip(!ENABLED || !ADMIN_EMAIL || !ADMIN_PASSWORD, 'set RUN_DASH_E2E=1 + E2E_ADMIN_*');

  test.describe('KPI cards and honest data', () => {
    test('CRM: four KPI cards in one row; a comparison shows only when the API provides one', async ({
      page,
      request,
    }) => {
      const cookie = await apiCookie(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      const analytics = await (
        await request.get(`${API}/api/v1/crm/analytics/overview?days=30`, { headers: { cookie } })
      ).json();

      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/crm');
      await expect(page.getByRole('heading', { name: 'CRM overview', level: 1 })).toBeVisible();

      const labels = ['Total leads', 'Open', 'Unassigned', 'New this week'];
      const tops: number[] = [];
      for (const l of labels) {
        const box = await page.getByText(l, { exact: true }).first().boundingBox();
        tops.push(Math.round(box!.y));
      }
      expect(new Set(tops).size).toBe(1); // one row

      // real numbers
      await expect(
        page.getByText(String(analytics.totals.total), { exact: true }).first(),
      ).toBeVisible();

      // the "vs prior week" comparison exists iff the backend returned a percentage
      const hasDelta = analytics.trendDelta && analytics.trendDelta.changePct !== null;
      await expect(page.getByText('vs prior week')).toHaveCount(hasDelta ? 1 : 0);
    });

    test('HR: KPI cards, gauge and department distribution use real numbers', async ({
      page,
      request,
    }) => {
      const cookie = await apiCookie(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      const dash = await (
        await request.get(`${API}/api/v1/hr/dashboard`, { headers: { cookie } })
      ).json();
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/hr');
      await expect(page.getByRole('heading', { name: 'HR & Workforce', level: 1 })).toBeVisible();
      await expect(page.getByText('Present today', { exact: true })).toBeVisible();
      if (dash.activeEmployees > 0) {
        const pct = Math.round((dash.presentToday / dash.activeEmployees) * 100);
        const gauge = page.getByRole('img', { name: /Attendance today/ }).first();
        await expect(gauge).toBeVisible();
        await expect(gauge).toHaveAttribute('aria-label', new RegExp(`Attendance today: ${pct}%`));
        await expect(gauge).toHaveAttribute(
          'aria-label',
          new RegExp(`${dash.presentToday} of ${dash.activeEmployees} active employees`),
        );
      }
      // department bars sum to the active headcount (no invented categories)
      const total = dash.departmentDistribution.reduce(
        (a: number, d: { count: number }) => a + d.count,
        0,
      );
      expect(total).toBe(dash.activeEmployees);
    });
  });

  test.describe('responsive + appearance', () => {
    for (const mode of ['light', 'dark'] as const) {
      test(`dashboards do not overflow at 1440 / 1024 / 768 / 390 (${mode}) and KPI grids collapse`, async ({
        page,
      }) => {
        test.setTimeout(120_000); // 24 full page loads
        await page.addInitScript((m) => localStorage.setItem('aivoryx.appearance', m), mode);
        await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
        for (const w of [1440, 1024, 768, 390]) {
          await page.setViewportSize({ width: w, height: w < 500 ? 844 : 900 });
          for (const route of ['/', '/crm', '/hr']) {
            await page.goto(route);
            // not 'networkidle': Next's router prefetches every visible link, which keeps the network busy
            await page.locator('h1').first().waitFor();
            await page.waitForTimeout(600);
            expect(await overflow(page), `${route} @${w} ${mode}`).toBeLessThanOrEqual(1);
          }
        }
        // 390 = one column, 768 = two
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/crm');
        const a = await page.getByText('Total leads', { exact: true }).first().boundingBox();
        const b = await page.getByText('Open', { exact: true }).first().boundingBox();
        expect(b!.y).toBeGreaterThan(a!.y + 40);
        await page.setViewportSize({ width: 768, height: 900 });
        await page.goto('/crm');
        const c = await page.getByText('Total leads', { exact: true }).first().boundingBox();
        const d = await page.getByText('Open', { exact: true }).first().boundingBox();
        expect(Math.abs(d!.y - c!.y)).toBeLessThan(5);
      });
    }

    test('dark mode: native select options use theme colours, not a white list', async ({
      page,
    }) => {
      await page.addInitScript(() => localStorage.setItem('aivoryx.appearance', 'dark'));
      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/crm/leads');
      const select = page.locator('select').first();
      await expect(select).toBeVisible();
      const styles = await select.evaluate((el) => {
        const cs = getComputedStyle(el);
        const opt = getComputedStyle(el.querySelector('option')!);
        return {
          bg: cs.backgroundColor,
          fg: cs.color,
          optBg: opt.backgroundColor,
          optFg: opt.color,
        };
      });
      const lum = (rgb: string) => {
        const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ['255', '255', '255']).map(Number);
        return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
      };
      expect(lum(styles.bg)).toBeLessThan(0.35);
      expect(lum(styles.optBg)).toBeLessThan(0.35);
      expect(lum(styles.optFg)).toBeGreaterThan(0.6);
    });
  });

  test.describe('platform vs tenant branding', () => {
    test.skip(!PA_EMAIL || !PA_PASSWORD, 'set E2E_PLATFORM_ADMIN_*');

    test('a tenant admin cannot read or change platform branding (API), and is kept out of the page', async ({
      page,
      request,
    }) => {
      const cookie = await apiCookie(request, ADMIN_EMAIL, ADMIN_PASSWORD);
      expect(
        (await request.get(`${API}/api/v1/platform/branding`, { headers: { cookie } })).status(),
      ).toBe(403);
      const put = await request.put(`${API}/api/v1/platform/branding`, {
        headers: { cookie },
        data: { platformName: 'Hijacked' },
      });
      expect(put.status()).toBe(403);
      const pub = await (await request.get(`${API}/api/v1/public/platform/branding`)).json();
      expect(pub.name).not.toBe('Hijacked');

      await signIn(page, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto('/platform/settings/branding');
      await expect(page.getByRole('heading', { name: 'Platform branding' })).toHaveCount(0);
    });

    test('platform admin edits platform branding; it is the default sign-in identity and workspaces still override it', async ({
      page,
      request,
    }) => {
      const pa = await apiCookie(request, PA_EMAIL, PA_PASSWORD);
      const before = await (
        await request.get(`${API}/api/v1/platform/branding`, { headers: { cookie: pa } })
      ).json();
      const stamp = Date.now().toString(36);
      try {
        // UI: platform admin opens the page and saves
        await signIn(page, PA_EMAIL, PA_PASSWORD);
        await page.goto('/platform/settings/branding');
        await expect(
          page.getByRole('heading', { name: 'Platform branding', level: 1 }),
        ).toBeVisible();
        await page.getByLabel('Platform name').fill(`Aivoryx ${stamp}`);
        await page.getByLabel('Sign-in heading').fill(`Welcome ${stamp}`);
        await page.getByRole('button', { name: 'Save changes' }).click();
        await expect(page.getByText(/platform branding saved/i)).toBeVisible();

        // logged out, no workspace: the platform identity
        const anon = await page.context().browser()!.newContext();
        const anonPage = await anon.newPage();
        await anonPage.goto('/login');
        await expect(
          anonPage.getByRole('heading', { name: `Welcome ${stamp}`, level: 1 }),
        ).toBeVisible();
        await expect(anonPage.getByText(`Aivoryx ${stamp}`, { exact: true }).first()).toBeVisible();
        // never a broken image
        const broken = await anonPage.evaluate(
          () =>
            Array.from(document.images).filter((i) => i.complete && i.naturalWidth === 0).length,
        );
        expect(broken).toBe(0);

        // a known workspace overrides the platform name; unset copy falls back to the platform's
        await anonPage.goto(`/login?workspace=${SLUG}`);
        await expect(anonPage.getByText(`Aivoryx ${stamp}`, { exact: true })).toHaveCount(0);
        await anon.close();
      } finally {
        await request.put(`${API}/api/v1/platform/branding`, {
          headers: { cookie: pa },
          data: {
            platformName: before.platformName ?? '',
            loginHeading: before.loginHeading ?? '',
            tagline: before.tagline ?? '',
            loginText: before.loginText ?? '',
          },
        });
      }
    });
  });
});
