import { expect, test, type Page } from '@playwright/test';

/**
 * Login / session regression (client-UAT blocker). Opt-in:
 *
 *   RUN_LOGIN_E2E=1 E2E_ADMIN_EMAIL=admin@clans-demo.test E2E_ADMIN_PASSWORD='Demo-Passw0rd!' \
 *   E2E_BASE_URL=http://localhost:3100 pnpm --filter @aivoryx/web test:e2e login-session.spec.ts
 */
const ENABLED = process.env.RUN_LOGIN_E2E === '1';
const EMAIL = process.env.E2E_ADMIN_EMAIL ?? '';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? '';

async function fill(page: Page, password = PASSWORD, email = EMAIL) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
}

test.describe('login + session', () => {
  test.skip(!ENABLED || !EMAIL || !PASSWORD, 'set RUN_LOGIN_E2E=1 + E2E_ADMIN_*');

  test('valid login lands on a protected page and STAYS there after reload', async ({ page }) => {
    await fill(page);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/login'));
    await page.reload();
    await page.locator('h1').first().waitFor();
    expect(new URL(page.url()).pathname).not.toBe('/login');
  });

  test('wrong password stays on /login with a clear message and keeps the form values', async ({
    page,
  }) => {
    await fill(page, 'definitely-wrong-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('[data-error-kind]')).toContainText(
      'Email or password is incorrect.',
    );
    expect(new URL(page.url()).pathname).toBe('/login');
    await expect(page.getByLabel('Email')).toHaveValue(EMAIL);
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue(
      'definitely-wrong-password',
    );
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  test('THE LOOP: a browser that drops the session cookie sees an explanation, not a bounce', async ({
    page,
  }) => {
    // Simulates third-party-cookie blocking: the API accepts the login (200) but the browser never
    // stores the Set-Cookie, so the follow-up /auth/me has no session.
    await page.route('**/api/v1/auth/login', async (route) => {
      const res = await route.fetch();
      const headers = { ...res.headers() };
      delete headers['set-cookie'];
      // route.fetch() shares the browser's cookie jar, so also discard what it stored
      await page.context().clearCookies();
      await route.fulfill({ response: res, headers });
    });
    await fill(page);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('[data-error-kind]')).toContainText('establish your session');
    expect(new URL(page.url()).pathname).toBe('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  test('API unreachable shows a network message', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) => route.abort('failed'));
    await fill(page);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('[data-error-kind]')).toContainText('reach Aivoryx');
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('server 500 shows a safe message plus the reference id, never the raw error', async ({
    page,
  }) => {
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'boom', correlationId: 'AIV-TESTREF' },
        }),
      }),
    );
    await fill(page);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const alert = page.locator('[data-error-kind]');
    await expect(alert).toContainText('Something went wrong while signing you in.');
    await expect(alert).toContainText('AIV-TESTREF');
    await expect(alert).not.toContainText('boom');
  });

  test('a malformed 200 body is reported, not swallowed', async ({ page }) => {
    await page.route('**/api/v1/auth/login', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '<html>oops' }),
    );
    await fill(page);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('[data-error-kind]')).toContainText('Something went wrong');
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('submit is disabled while in flight (no duplicate submissions)', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/v1/auth/login', async (route) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 800));
      await route.abort('failed');
    });
    await fill(page);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: /Signing in/ })).toBeDisabled();
    await page.getByLabel('Password', { exact: true }).press('Enter');
    await expect(page.locator('[data-error-kind]')).toBeVisible();
    expect(calls).toBe(1);
  });

  test('password visibility toggle: hidden by default, show/hide, keyboard, never submits', async ({
    page,
  }) => {
    let submitted = false;
    await page.route('**/api/v1/auth/login', (route) => {
      submitted = true;
      return route.abort('failed');
    });
    await fill(page, 'Sup3rSecret!');
    const input = page.getByLabel('Password', { exact: true });
    await expect(input).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(input).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(input).toHaveAttribute('type', 'password');
    await input.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Show password' })).toBeFocused();
    await page.keyboard.press('Space');
    await expect(input).toHaveAttribute('type', 'text');
    expect(submitted).toBe(false);
  });

  for (const mode of ['light', 'dark'] as const) {
    for (const width of [390, 768, 1024, 1440]) {
      test(`login page fits at ${width}px (${mode}) with a usable password toggle`, async ({
        page,
      }) => {
        await page.addInitScript((m) => localStorage.setItem('aivoryx.appearance', m), mode);
        await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
        await fill(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(1);
        const box = await page.getByRole('button', { name: 'Show password' }).boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(36);
        const inputBox = await page.getByLabel('Password', { exact: true }).boundingBox();
        expect(box!.x + box!.width).toBeLessThanOrEqual(inputBox!.x + inputBox!.width + 1);
      });
    }
  }
});
