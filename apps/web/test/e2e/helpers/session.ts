import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Passw0rd!';
export const ENGINE_URL = 'http://127.0.0.1:3000/api/v1';
export const WEB_URL = 'http://localhost:3002';

export async function signIn(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/products/);
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Unique per run, so repeated runs against a warm stack never collide. */
export const unique = (prefix: string) => `${prefix}-${process.pid}-${Date.now()}`;

/**
 * The cart lives on the engine now and survives across test runs for a shared
 * user like acme-admin. A spec that counts order lines must start from an
 * empty cart rather than inherit whatever the previous session abandoned.
 */
export async function clearServerCart(page: Page): Promise<void> {
  await page.evaluate(async (engine) => {
    const token = sessionStorage.getItem('marketplace.token');
    if (token) {
      await fetch(`${engine}/cart`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
    }
  }, ENGINE_URL);
}

/**
 * Completes the payment page a successful checkout lands on. `4242…` is the
 * fake provider's success number; the page redirects to the order tracker.
 */
export async function payWithCard(page: Page, number = '4242 4242 4242 4242'): Promise<void> {
  await expect(page).toHaveURL(/\/orders\/[0-9A-Z]{26}\/pay/);
  await page.getByTestId('card-number').fill(number);
  await page.getByTestId('card-month').fill('12');
  await page.getByTestId('card-year').fill('2030');
  await page.getByTestId('card-cvc').fill('123');
  await page.getByTestId('pay-now').click();
}

/**
 * Fills and submits the admin create-product form, returning the new id.
 * The caller still speaks minor units -- every existing assertion is written
 * against them -- and this converts to the major units the form now asks for.
 */
export async function createProduct(
  page: Page,
  name: string,
  priceMinor: number,
  stock = 20,
): Promise<string> {
  await page.goto('/admin/products/new');
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill('e2e fixture');
  await page.getByLabel('Category').fill('tools');
  await page.getByLabel('Price', { exact: true }).fill(String(priceMinor / 100));
  await page.getByLabel('Stock').fill(String(stock));
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9A-Z]{26}/);
  return page.url().split('/').pop()!;
}
