import { expect, test } from '@playwright/test';
import { createProduct, signIn, unique } from './helpers/session';

test('a double-submitted checkout creates exactly one order', async ({ page }) => {
  const name = unique('idem-widget');

  await signIn(page, 'acme-admin');
  await createProduct(page, name, 2500, 10);
  await page.getByRole('button', { name: 'Add to cart' }).click();

  // `.ant-table-row` rather than `tbody tr`: ANTD renders a hidden measure row
  // that would inflate every count here. Waiting for the fetch to settle first
  // matters too -- counting an empty table and calling it the baseline makes
  // this pass for the wrong reason.
  await page.goto('/orders');
  await page.waitForLoadState('networkidle');
  const rows = page.locator('.ant-table-row');
  const before = await rows.count();

  await page.goto('/cart');
  await page.getByLabel('Address').fill('1 Test Street');
  await page.getByLabel('City').fill('Testville');
  await page.getByLabel('Postcode').fill('TE5 7XX');

  // Two clicks in the same tick. The button disables on submit, but the
  // correctness here comes from the idempotency key being minted when the
  // intent formed, not from the disable winning the race.
  const button = page.getByRole('button', { name: 'Place order' });
  await Promise.all([button.click(), button.click().catch(() => undefined)]);

  await expect(page).toHaveURL(/\/orders\/[0-9A-Z]{26}/);
  const orderId = page.url().split('/').pop()!;

  await page.goto('/orders');
  await page.waitForLoadState('networkidle');

  // Exactly one row overall, and exactly one row for the order that was
  // actually created -- two clicks, one order.
  await expect(rows).toHaveCount(before + 1);
  // The row no longer leads with the ULID -- it leads with when the order was
  // placed, and the id is a trailing `Ref` showing its last six characters with
  // the whole value in `title`. That title is what still pins the assertion to
  // this specific order.
  await expect(page.getByTitle(orderId)).toHaveCount(1);
});
