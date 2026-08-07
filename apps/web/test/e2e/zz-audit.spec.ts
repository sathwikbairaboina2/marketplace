import { test, type Page } from '@playwright/test';
import { signIn, signOut } from './helpers/session';

const OUT = process.env.SHOT_DIR ?? 'test-results/audit';
const DESKTOP = { width: 1440, height: 950 };
const TABLET = { width: 834, height: 1100 };
const MOBILE = { width: 390, height: 844 };

// The engine is a separate origin, so these match the browser's own requests to
// it rather than anything Next.js serves.
const PRODUCTS = '**/api/v1/products**';

async function shot(page: Page, name: string) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
}

async function setTheme(page: Page, want: 'light' | 'dark') {
  const current = await page.locator('html').getAttribute('data-theme');
  if (current !== want) {
    await page
      .getByRole('button', { name: /switch to (dark|light) mode/i })
      .first()
      .click();
    await page.waitForTimeout(400);
  }
}

/** Follows the first link in a table body, if there is one. */
async function openFirstRow(page: Page, listUrl: string, name: string) {
  await page.goto(listUrl);
  await page.waitForTimeout(700);
  const href = await page
    .locator('tbody a')
    .first()
    .getAttribute('href')
    .catch(() => null);
  if (!href) return false;
  await page.goto(href);
  await shot(page, name);
  return true;
}

async function adminTour(page: Page, p: string) {
  await page.goto('/products');
  await shot(page, `${p}-01-storefront`);

  const card = await page.locator('.mp-card-name').first().getAttribute('href');
  await page.goto(card!);
  await shot(page, `${p}-02-product-detail`);

  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto('/cart');
  await shot(page, `${p}-03-cart`);

  await page.goto('/events');
  await shot(page, `${p}-04-events`);
  await openFirstRow(page, '/events', `${p}-05-event-detail`);

  await page.goto('/admin/products');
  await shot(page, `${p}-10-admin-products`);
  await page.goto('/admin/events');
  await shot(page, `${p}-11-admin-events`);
  await page.goto('/admin/products/new');
  await shot(page, `${p}-12-new-product`);
  await page.goto('/admin/events/new');
  await shot(page, `${p}-13-new-event`);
  await page.goto('/admin/flows');
  await shot(page, `${p}-14-flows`);
  await openFirstRow(page, '/admin/flows', `${p}-15-flow-detail`);
  await page.goto('/admin/chat');
  await shot(page, `${p}-16-chat`);
}

async function buyerTour(page: Page, p: string) {
  await page.goto('/orders');
  await shot(page, `${p}-06-orders`);
  await openFirstRow(page, '/orders', `${p}-07-order-detail`);

  await page.goto('/bookings');
  await shot(page, `${p}-08-bookings`);
  await openFirstRow(page, '/bookings', `${p}-09-booking-detail`);
}

test('desktop light', async ({ page }) => {
  test.slow();
  await page.setViewportSize(DESKTOP);
  await signIn(page, 'acme-admin');
  await setTheme(page, 'light');
  await adminTour(page, 'L');

  await page.goto('/products');
  await signOut(page);
  await signIn(page, 'acme-buyer');
  await buyerTour(page, 'L');
});

test('desktop dark', async ({ page }) => {
  test.slow();
  await page.setViewportSize(DESKTOP);
  await signIn(page, 'acme-admin');
  await setTheme(page, 'dark');
  await adminTour(page, 'D');

  await page.goto('/products');
  await signOut(page);
  await signIn(page, 'acme-buyer');
  await buyerTour(page, 'D');
});

test('mobile', async ({ page }) => {
  test.slow();
  await page.setViewportSize(MOBILE);
  await signIn(page, 'acme-admin');

  await page.goto('/products');
  await shot(page, 'M-01-storefront');

  const card = await page.locator('.mp-card-name').first().getAttribute('href');
  await page.goto(card!);
  await shot(page, 'M-02-product-detail');

  await page.goto('/admin/products');
  await shot(page, 'M-03-admin-products');
  await page.goto('/admin/flows');
  await shot(page, 'M-04-flows');
});

test('tablet', async ({ page }) => {
  test.slow();
  await page.setViewportSize(TABLET);
  await signIn(page, 'acme-admin');

  await page.goto('/products');
  await shot(page, 'T-01-storefront');

  const card = await page.locator('.mp-card-name').first().getAttribute('href');
  await page.goto(card!);
  await shot(page, 'T-02-product-detail');

  await page.goto('/admin/products');
  await shot(page, 'T-03-admin-products');
  await page.goto('/admin/chat');
  await shot(page, 'T-04-chat');
});

/**
 * The states nothing has ever rendered.
 *
 * A failed fetch and a slow one are the two commonest things a real user sees
 * and the two the behavioural suite cannot photograph, because it waits for
 * them to finish. Both are forced here by intercepting the engine's own
 * responses.
 */
test('failure and loading states', async ({ page }) => {
  test.slow();
  await page.setViewportSize(DESKTOP);
  await signIn(page, 'acme-admin');

  await page.route(PRODUCTS, (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://marketplace.local/problems/upstream-unavailable',
        title: 'Catalogue is unavailable',
        status: 503,
        detail: 'The engine could not reach DynamoDB. Nothing was lost; try again.',
        traceId: '9f2c41ae-7b03-4a55-9d61-0c5f2a18e3bb',
      }),
    }),
  );

  await page.goto('/products');
  await shot(page, 'E-01-storefront-error');

  await page.goto('/orders');
  await shot(page, 'E-02-orders-error');
  await page.unroute(PRODUCTS);

  // Held open long enough to photograph the skeleton rather than the result.
  await page.route(PRODUCTS, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 6000));
    await route.continue();
  });

  await page.goto('/products', { waitUntil: 'commit' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/E-03-storefront-loading.png`, fullPage: true });
  await page.unroute(PRODUCTS);
});

test('login and empty states', async ({ page }) => {
  test.slow();
  await page.setViewportSize(DESKTOP);
  await page.goto('/login');
  await shot(page, 'X-01-login');

  // globex has products but no orders, bookings, events or flows.
  await signIn(page, 'globex-admin');
  await page.goto('/orders');
  await shot(page, 'X-02-orders-empty');
  await page.goto('/admin/events');
  await shot(page, 'X-03-admin-events-empty');
  await page.goto('/products');
  await shot(page, 'X-04-globex-storefront');
  await page.goto('/bookings');
  await shot(page, 'X-05-bookings-empty');
  await page.goto('/admin/flows');
  await shot(page, 'X-06-flows-empty');
  await page.goto('/admin/chat');
  await shot(page, 'X-07-chat-empty');

  // The skip link is invisible until focused, so it is only photographable
  // mid-tab. One press from a fresh load lands on it.
  await page.goto('/products');
  await page.waitForTimeout(900);
  await page.keyboard.press('Tab');
  // Viewport, not fullPage: capturing the full page drops the focus this shot
  // exists to show, and the link is pinned to the top of the viewport anyway.
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/X-08-skip-link-focused.png` });
});
