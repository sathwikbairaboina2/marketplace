import { expect, test } from '@playwright/test';
import { signIn, unique } from './helpers/session';

// A one-pixel PNG, inline so this needs no fixture file on disk.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('an admin uploads an image and it renders on the product', async ({ page }) => {
  const name = unique('photographed-widget');

  await signIn(page, 'acme-admin');
  await page.goto('/admin/products/new');

  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill('has a photograph');
  await page.getByLabel('Category').fill('tools');
  await page.getByLabel('Price', { exact: true }).fill('15');
  await page.getByLabel('Stock').fill('3');

  await page.getByTestId('image-input').setInputFiles({
    name: 'probe.png',
    mimeType: 'image/png',
    buffer: PNG,
  });

  // The thumbnail only appears once the engine has accepted the file and
  // written it, so its presence is the upload having actually succeeded.
  const thumb = page.locator('img[src*="marketplace-media"]').first();
  await expect(thumb).toBeVisible();

  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/products\/[0-9A-Z]{26}/);

  const detailImage = page.locator('img[src*="marketplace-media"]').first();
  await expect(detailImage).toBeVisible();

  // An <img> that 403s still "renders" in the DOM, so the URL is fetched
  // directly. This is the bucket policy being verified, not the markup.
  const src = await detailImage.getAttribute('src');
  const res = await page.request.get(src!);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');

  // And it shows in the list, which is a different render path.
  await page.goto('/products');
  await expect(page.locator(`img[src="${src}"]`).first()).toBeVisible();
});

test('a file that is not really an image is refused', async ({ page }) => {
  await signIn(page, 'acme-admin');
  await page.goto('/admin/products/new');

  // Declared image/png, actually a script-bearing HTML document. LocalStack
  // would happily have stored this under a presigned policy; the engine reads
  // the magic number and will not.
  await page.getByTestId('image-input').setInputFiles({
    name: 'evil.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<!doctype html><script>alert(1)</script>', 'ascii'),
  });

  await expect(page.getByText(/not a recognised image/i)).toBeVisible();
  await expect(page.locator('img[src*="marketplace-media"]')).toHaveCount(0);
});
