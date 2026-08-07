import { expect, test } from '@playwright/test';
import { signIn } from './helpers/session';

test('the admin sidebar collapses to a drawer on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await signIn(page, 'acme-admin');
  await page.goto('/admin/flows');

  // Collapsed: the navigation is not on the page at all until the menu opens.
  await expect(page.getByRole('link', { name: 'Chat' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('link', { name: 'Chat' })).toBeVisible();
});

test('the storefront filter rail moves behind a control on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await signIn(page, 'acme-admin');

  // The generated filters are reachable, just not permanently on screen.
  await expect(page.getByLabel('Min price (minor)')).toHaveCount(0);
  await page.getByRole('button', { name: 'Filters' }).click();
  await expect(page.getByLabel('Min price (minor)')).toBeVisible();
});

test('the admin sidebar is present without a menu button at desktop width', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, 'acme-admin');
  await page.goto('/admin/flows');

  await expect(page.getByRole('link', { name: 'Chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open menu' })).toHaveCount(0);
});
