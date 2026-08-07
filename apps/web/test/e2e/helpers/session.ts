import { expect, type Page } from '@playwright/test';

export const PASSWORD = 'Passw0rd!';
export const ENGINE_URL = 'http://localhost:3000/api/v1';
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

/** Fills and submits the admin create-product form, returning the new id. */
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
  await page.getByLabel('Price (minor units)').fill(String(priceMinor));
  await page.getByLabel('Stock').fill(String(stock));
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9A-Z]{26}/);
  return page.url().split('/').pop()!;
}
