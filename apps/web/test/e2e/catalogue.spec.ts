import { expect, test } from '@playwright/test';
import { clearServerCart, createProduct, payWithCard, signIn, unique } from './helpers/session';

test('an order can be placed for two products found through the catalogue', async ({ page }) => {
  const cheap = unique('cheap-widget');
  const dear = unique('dear-widget');

  await signIn(page, 'acme-admin');
  await clearServerCart(page);

  await createProduct(page, cheap, 500);
  await page.getByRole('button', { name: 'Add to cart' }).click();

  // 95_000 minor units = 950.00. The filter below is in *major* units and
  // converts on submit, so the two are one hundred apart by design -- keep them
  // in step, an off-by-ten here reads as "search is broken".
  await createProduct(page, dear, 95_000);
  await page.getByRole('button', { name: 'Add to cart' }).click();

  // The price filter narrows to the dear one, which proves POST
  // /products/search is wired up rather than the unfiltered list.
  await page.goto('/products');
  await page.getByLabel('Min price').fill('900');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText(dear)).toBeVisible();
  await expect(page.getByText(cheap)).toHaveCount(0);

  await page.goto('/cart');
  await page.getByLabel('Address').fill('1 Test Street');
  await page.getByLabel('City').fill('Testville');
  await page.getByLabel('Postcode').fill('TE5 7XX');
  // Checkout reserves the order and lands on the payment page; the fake
  // provider's success card completes it onto the tracker.
  await page.getByRole('button', { name: 'Checkout' }).click();
  await payWithCard(page);

  await expect(page).toHaveURL(/\/orders\/[0-9A-Z]{26}$/);
  // Two line items, each carrying the unit price the engine locked at order
  // time rather than whatever the cart happened to be showing. Scoped to the
  // items table: the page also renders a Descriptions block, whose rows would
  // otherwise be counted here too.
  await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(2);
});

test('a booking can be made against a new event', async ({ page }) => {
  const title = unique('e2e-launch');

  await signIn(page, 'acme-admin');
  await page.goto('/admin/events/new');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Capacity').fill('50');

  await page.getByLabel('Starts').click();
  await page.keyboard.type('2026-12-01 10:00:00');
  await page.keyboard.press('Enter');
  await page.getByLabel('Ends').click();
  await page.keyboard.type('2026-12-01 18:00:00');
  await page.keyboard.press('Enter');

  await page.getByLabel('Base price').fill('25');
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page).toHaveURL(/\/events\/[0-9A-Z]{26}/);
  await page.getByLabel('Tickets').fill('2');
  await page.getByRole('button', { name: 'Book' }).click();

  await expect(page).toHaveURL(/\/bookings\/[0-9A-Z]{26}/);
  // Scoped to the Tickets row: a bare getByText('2') also matches the id and
  // the timestamp.
  await expect(
    page.locator('.ant-descriptions-item', { hasText: 'Tickets' }).getByText('2', { exact: true }),
  ).toBeVisible();
});
