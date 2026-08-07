import { expect, test } from '@playwright/test';
import { signIn } from './helpers/session';

test('a chosen theme survives a reload', async ({ page }) => {
  await signIn(page, 'acme-admin');

  const initial = await page.locator('html').getAttribute('data-theme');
  expect(initial).toMatch(/^(light|dark)$/);

  await page.getByRole('button', { name: /switch to (dark|light) mode/i }).click();
  const flipped = await page.locator('html').getAttribute('data-theme');
  expect(flipped).not.toBe(initial);

  await page.reload();

  // The inline bootstrap script has to restore this before first paint. If it
  // only applied on hydration, the attribute would briefly hold the wrong value
  // and the page would visibly flash the other theme.
  await expect(page.locator('html')).toHaveAttribute('data-theme', flipped!);
});

test('the theme applies to the storefront and the back office alike', async ({ page }) => {
  await signIn(page, 'acme-admin');

  const current = await page.locator('html').getAttribute('data-theme');
  await page.goto('/admin/flows');
  await expect(page.locator('html')).toHaveAttribute('data-theme', current!);
});
