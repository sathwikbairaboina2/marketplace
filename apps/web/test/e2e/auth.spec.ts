import { expect, test } from '@playwright/test';
import { signIn, signOut } from './helpers/session';

test('signs in and shows the tenant and role from the token', async ({ page }) => {
  await signIn(page, 'acme-admin');
  await expect(page.getByText('acme', { exact: true })).toBeVisible();
  await expect(page.getByText('admin', { exact: true })).toBeVisible();
});

test('a buyer sees the buyer navigation and no admin entries', async ({ page }) => {
  await signIn(page, 'acme-buyer');
  await expect(page.getByRole('link', { name: 'Products' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Flows' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Chat' })).toHaveCount(0);
});

test('an unauthenticated visit is redirected to the login page', async ({ page }) => {
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/login/);
});

test('signing out clears the session', async ({ page }) => {
  await signIn(page, 'acme-admin');
  await signOut(page);
  await page.goto('/products');
  await expect(page).toHaveURL(/\/login/);
});
