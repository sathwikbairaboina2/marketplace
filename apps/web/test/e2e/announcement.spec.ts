import { expect, test } from '@playwright/test';
import { signIn } from './helpers/session';

test('the seller sets an announcement and the storefront wears it', async ({ page }) => {
  await signIn(page, 'acme-admin');

  await page.goto('/admin/settings');
  await page.getByLabel('Announcement').fill('Launch week — 10% off');
  const toggle = page.getByLabel('Show it');
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await page.getByRole('button', { name: 'Save announcement' }).click();
  await expect(page.getByText('Announcement saved')).toBeVisible();

  await page.goto('/products');
  await expect(page.getByText('Launch week — 10% off')).toBeVisible();

  // And off again — the strip must vanish, not linger.
  await page.goto('/admin/settings');
  await page.getByLabel('Show it').click();
  await page.getByRole('button', { name: 'Save announcement' }).click();
  await expect(page.getByText('Announcement saved')).toBeVisible();
  await page.goto('/products');
  await expect(page.getByText('Launch week — 10% off')).not.toBeVisible();
});
