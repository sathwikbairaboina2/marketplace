import { expect, test } from '@playwright/test';
import { createProduct, signIn, signOut, unique } from './helpers/session';

test("one tenant cannot see another tenant's product", async ({ page }) => {
  const name = unique('isolation-widget');

  await signIn(page, 'acme-admin');
  const id = await createProduct(page, name, 1000, 5);
  await expect(page.getByText(name).first()).toBeVisible();

  await signOut(page);
  await signIn(page, 'globex-admin');

  await page.goto('/products');
  await expect(page.getByText(name)).toHaveCount(0);

  // Typing the id by hand must not work either: isolation is enforced by the
  // engine on every route, not by omitting the link.
  await page.goto(`/products/${id}`);
  await expect(page.getByText(name)).toHaveCount(0);
});
