import { expect, test } from '@playwright/test';

test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
  await page.goto('/');
  await page.waitForURL('**/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
});

test('health page renders without crashing when the API is unreachable', async ({ page }) => {
  await page.goto('/health');
  await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible();
  // Either the live report or the graceful "API unavailable" state is acceptable
  // for the smoke test — what matters is the page does not error.
  const degraded = page.getByText('API unavailable');
  const operational = page.getByText('Overall');
  await expect(degraded.or(operational).first()).toBeVisible();
});
