import { expect, test } from '@playwright/test';

test('overview page renders the foundation shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Platform foundation' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'System health' }).first()).toBeVisible();
});

test('health page renders without crashing when the API is unreachable', async ({ page }) => {
  await page.goto('/health');
  await expect(page.getByRole('heading', { name: 'System health' })).toBeVisible();
  // Either the live report or the graceful "API unavailable" state is acceptable
  // for the Phase 1 smoke test — what matters is the page does not error.
  const degraded = page.getByText('API unavailable');
  const operational = page.getByText('Overall');
  await expect(degraded.or(operational).first()).toBeVisible();
});
