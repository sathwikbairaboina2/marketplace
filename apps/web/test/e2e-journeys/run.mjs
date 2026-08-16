/**
 * End-to-end journeys.
 *
 * Each case here is a path through the whole system, not an assertion about
 * one screen: something is done in the browser, and the result is then checked
 * where it actually landed -- the engine's REST API, the media bucket, the
 * registry, another tenant's session. A defect that only shows up as a
 * disagreement between two layers (the grid says one thing, the API another)
 * is invisible to a UI-only suite and to a service-only suite, and those are
 * the ones this file exists to catch.
 *
 *   pnpm --filter @marketplace/web e2e:journeys
 *
 * Needs the stack up (`pnpm docker:up`). Every run mints its own two tenants,
 * so nothing here touches the demo shop and re-runs cannot inherit a registry
 * a previous run changed.
 */
import { chromium } from '@playwright/test';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = 'http://localhost:3002';
const ENGINE = 'http://127.0.0.1:3000/api/v1';
const OUT =
  process.env.JOURNEYS_OUT ??
  fileURLToPath(new URL('../../test-results/e2e-journeys', import.meta.url));
const SHOTS = `${OUT}/failures`;
const ENV_FILE = fileURLToPath(new URL('../../../../docker/.env.generated', import.meta.url));
const PASSWORD = 'Passw0rd!';

const RUN = Date.now().toString(36);
const A = `jt-${RUN}-a`;
const B = `jt-${RUN}-b`;
const A_ADMIN = `${A}-admin`;
const A_BUYER = `${A}-buyer`;
const B_ADMIN = `${B}-admin`;

if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const env = Object.fromEntries(
  readFileSync(ENV_FILE, 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);

const cognito = new CognitoIdentityProviderClient({
  region: 'us-east-1',
  // `localhost` resolves to ::1 first on some hosts, and Docker Desktop's
  // IPv6 loopback proxy is not always listening; the IPv4 literal always is.
  endpoint: (env.COGNITO_ENDPOINT_HOST ?? '').replace('localhost', '127.0.0.1'),
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

async function mint(tenantId, username, role) {
  const attrs = [
    { Name: 'custom:tenant_id', Value: tenantId },
    { Name: 'custom:role', Value: role },
  ];
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: env.COGNITO_USER_POOL_ID,
        Username: username,
        MessageAction: 'SUPPRESS',
        UserAttributes: attrs,
      }),
    );
  } catch (err) {
    if (err.name !== 'UsernameExistsException') throw err;
    await cognito.send(
      new AdminUpdateUserAttributesCommand({
        UserPoolId: env.COGNITO_USER_POOL_ID,
        Username: username,
        UserAttributes: attrs,
      }),
    );
  }
  await cognito.send(
    new AdminSetUserPasswordCommand({
      UserPoolId: env.COGNITO_USER_POOL_ID,
      Username: username,
      Password: PASSWORD,
      Permanent: true,
    }),
  );
  const res = await cognito.send(
    new InitiateAuthCommand({
      ClientId: env.COGNITO_CLIENT_ID,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: username, PASSWORD },
    }),
  );
  return res.AuthenticationResult.IdToken;
}

/** The engine, spoken to directly -- this is the "other side" of each journey. */
async function api(token, method, p, body, extraHeaders = {}) {
  const res = await fetch(`${ENGINE}${p}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...extraHeaders,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: res.status, json, text };
}

// ------------------------------------------------------------------- runner
const results = [];
let n = 0;
let group = '';
const state = { flowApplied: false };

function section(title) {
  group = title;
  console.log(`\n== ${title}`);
}

async function journey(name, fn, requires) {
  n += 1;
  const id = String(n).padStart(2, '0');
  if (requires && !requires()) {
    results.push({ id, group, name, status: 'skip' });
    console.log(`  ${id} --   ${name} (skipped: prerequisite did not run)`);
    return;
  }
  const started = Date.now();
  try {
    await fn();
    results.push({ id, group, name, status: 'pass', ms: Date.now() - started });
    console.log(`  ${id} ok   ${name}`);
  } catch (err) {
    const message = String(err.message ?? err).split('\n')[0].slice(0, 200);
    results.push({ id, group, name, status: 'fail', message, ms: Date.now() - started });
    console.log(`  ${id} FAIL ${name}\n        ${message}`);
    try {
      await shopper.screenshot({ path: path.join(SHOTS, `${id}.png`), fullPage: true });
    } catch {
      /* page may be gone */
    }
  }
}

const must = (condition, message) => {
  if (!condition) throw new Error(message);
};

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

// ------------------------------------------------------------------ browsers
const tokenAdminA = await mint(A, A_ADMIN, 'admin');
const tokenBuyerA = await mint(A, A_BUYER, 'buyer');
const tokenAdminB = await mint(B, B_ADMIN, 'admin');

const browser = await chromium.launch();
const sellerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const shopperCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const seller = await sellerCtx.newPage();
const shopper = await shopperCtx.newPage();

const serverErrors = [];
for (const p of [seller, shopper]) {
  p.on('response', (r) => {
    if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
  });
}

async function productCardCount(page) {
  // Each card renders two anchors -- the photograph and the name -- so counting
  // links counts every product twice.
  const hrefs = await page.locator('a[href^="/products/01"]').evaluateAll((as) =>
    as.map((a) => a.getAttribute('href')),
  );
  return new Set(hrefs).size;
}

async function signIn(page, user) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/products/, { timeout: 30_000 });
  await page.waitForTimeout(600);
}

/** Creates a product through the seller's browser and returns its id. */
async function createProduct(over = {}) {
  const p = {
    name: `p-${n}-${Math.floor(Math.random() * 1e6)}`,
    description: 'journey fixture',
    category: 'journeys',
    price: '10.00',
    stock: '5',
    status: 'active',
    image: false,
    ...over,
  };
  await seller.goto(`${WEB}/admin/products/new`);
  await seller.getByLabel('Name').waitFor({ timeout: 20_000 });
  await seller.getByLabel('Name').fill(p.name);
  await seller.getByLabel('Description').fill(p.description);
  await seller.getByLabel('Category').fill(p.category);
  await seller.getByLabel('Price', { exact: true }).fill(p.price);
  await seller.getByLabel('Stock').fill(p.stock);
  if (p.status !== 'active') {
    await seller.locator('.ant-form-item', { hasText: 'Status' }).locator('.ant-select').click();
    await seller.getByTitle(p.status).click();
  }
  if (p.image) {
    await seller.getByTestId('image-input').setInputFiles({
      name: 'probe.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await seller.locator('img[src*="marketplace-media"]').first().waitFor({ timeout: 40_000 });
  }
  const colour = seller.getByLabel(/colour/i);
  if (await colour.count()) await colour.first().fill(p.colour ?? 'green');
  await seller.getByRole('button', { name: 'Create' }).click();
  await seller.waitForURL(/\/products\/[0-9A-Z]{26}/, { timeout: 40_000 });
  return { ...p, id: seller.url().split('/').pop() };
}

async function addToCartAndOrder(page, productId, { qty = 1, city = 'Bristol' } = {}) {
  await page.goto(`${WEB}/products/${productId}`);
  await page.waitForTimeout(800);
  if (qty !== 1) {
    const q = page.locator('input.ant-input-number-input').first();
    await q.fill(String(qty));
    await q.blur();
  }
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto(`${WEB}/cart`);
  await page.getByLabel('Address').fill('42 Harbour Road');
  await page.getByLabel('City').fill(city);
  await page.getByLabel('Postcode').fill('BS1 4TR');
  await page.getByRole('button', { name: 'Place order' }).click();
  await page.waitForURL(/\/orders\/[0-9A-Z]{26}/, { timeout: 60_000 });
  return page.url().split('/').pop();
}

await signIn(seller, A_ADMIN);
await signIn(shopper, A_BUYER);

// ======================================================= 1. seller journeys
section('A seller listing goods');

await journey('a new shop starts empty in the browser and in the engine alike', async () => {
  const listed = await api(tokenAdminA, 'GET', '/products?limit=100');
  must(listed.json.items.length === 0, `engine already had ${listed.json.items.length} products`);
  await shopper.goto(`${WEB}/products`);
  await shopper.waitForTimeout(2000);
  must(/just getting started/i.test(await shopper.locator('body').innerText()), 'no empty state');
});

let first;
await journey('a product created in the browser arrives in the engine field for field', async () => {
  first = await createProduct({ price: '24.50', stock: '7', category: 'kitchen' });
  const got = await api(tokenAdminA, 'GET', `/products/${first.id}`);
  must(got.status === 200, `engine answered ${got.status}`);
  must(got.json.name === first.name, `name is ${got.json.name}`);
  must(got.json.priceMinor === 2450, `priceMinor is ${got.json.priceMinor}, want 2450`);
  must(got.json.stock === 7, `stock is ${got.json.stock}`);
  must(got.json.category === 'kitchen', `category is ${got.json.category}`);
});

await journey('what the seller typed reaches the shopper without a reload of the app', async () => {
  await shopper.goto(`${WEB}/products`);
  await shopper.waitForTimeout(2000);
  must((await shopper.locator('body').innerText()).includes(first.name), 'the shopper cannot see it');
});

await journey('a photograph uploaded in the browser is publicly readable afterwards', async () => {
  const withPhoto = await createProduct({ image: true });
  const got = await api(tokenAdminA, 'GET', `/products/${withPhoto.id}`);
  must(got.json.images.length === 1, `${got.json.images.length} images recorded`);
  const res = await fetch(got.json.images[0]);
  must(res.status === 200, `the stored object answered ${res.status}`);
  must((res.headers.get('content-type') ?? '').startsWith('image/'), 'served with a non-image type');
});

await journey('a draft is stored by the engine and withheld from the shop window', async () => {
  const draft = await createProduct({ status: 'draft' });
  const got = await api(tokenAdminA, 'GET', `/products/${draft.id}`);
  must(got.json.status === 'draft', 'the engine did not store it as a draft');
  await shopper.goto(`${WEB}/products`);
  await shopper.waitForTimeout(2000);
  must(!(await shopper.locator('body').innerText()).includes(draft.name), 'a draft reached the shop');
});

await journey('an out-of-stock listing is visible but cannot be bought', async () => {
  const sold = await createProduct({ status: 'out_of_stock', stock: '0' });
  await shopper.goto(`${WEB}/products/${sold.id}`);
  await shopper.waitForTimeout(1500);
  must(await shopper.getByRole('button', { name: 'Add to cart' }).isDisabled(), 'it can be bought');
});

await journey('two products may share a name and stay distinct records', async () => {
  const name = `twin-${RUN}`;
  const one = await createProduct({ name });
  const two = await createProduct({ name });
  must(one.id !== two.id, 'the second create returned the first id');
  const a = await api(tokenAdminA, 'GET', `/products/${one.id}`);
  const b = await api(tokenAdminA, 'GET', `/products/${two.id}`);
  must(a.status === 200 && b.status === 200, 'one of the twins is unreachable');
});

await journey('the seller cockpit lists everything, including what shoppers cannot see', async () => {
  const listed = await api(tokenAdminA, 'GET', '/products?limit=100');
  const statuses = new Set(listed.json.items.map((i) => i.status));
  must(statuses.has('draft'), 'the cockpit list has no draft in it');
  await seller.goto(`${WEB}/admin/products`);
  await seller.waitForTimeout(2000);
  const rows = await seller.locator('.ant-table-tbody tr.ant-table-row').count();
  must(rows === listed.json.items.length, `cockpit shows ${rows}, engine holds ${listed.json.items.length}`);
});

// ==================================================== 2. discovery journeys
section('A shopper finding things');

await journey('a minimum-price filter agrees with what the engine returns for it', async () => {
  await createProduct({ price: '500.00', name: `dear-${RUN}` });
  await createProduct({ price: '1.00', name: `cheap-${RUN}` });

  const fromApi = await api(tokenBuyerA, 'POST', '/products/search', {
    priceMinorMin: 20000,
    attributes: {},
    limit: 100,
    cursor: null,
  });
  const apiNames = fromApi.json.items.map((i) => i.name).sort();

  await shopper.goto(`${WEB}/products`);
  await shopper.getByLabel('Min price').fill('200');
  await shopper.getByRole('button', { name: 'Search' }).click();
  await shopper.waitForTimeout(2500);
  const shown = (await shopper.locator('a[href^="/products/01"]').allInnerTexts())
    .map((t) => t.split('\n').map((s) => s.trim()).filter(Boolean))
    .flat();

  for (const name of apiNames) {
    if (name.startsWith('cheap-')) continue;
    must(shown.some((s) => s.includes(name)), `the engine matched ${name}; the grid did not show it`);
  }
  must(!shown.some((s) => s.includes(`cheap-${RUN}`)), 'a cheap product survived the filter');
});

await journey('a maximum-price filter excludes what is above it', async () => {
  await shopper.goto(`${WEB}/products`);
  await shopper.getByLabel('Max price').fill('5');
  await shopper.getByRole('button', { name: 'Search' }).click();
  await shopper.waitForTimeout(2500);
  const text = await shopper.locator('body').innerText();
  must(!text.includes(`dear-${RUN}`), 'an expensive product survived a max filter');
});

await journey('a price range narrows from both ends at once', async () => {
  await shopper.goto(`${WEB}/products`);
  await shopper.getByLabel('Min price').fill('20');
  await shopper.getByLabel('Max price').fill('30');
  await shopper.getByRole('button', { name: 'Search' }).click();
  await shopper.waitForTimeout(2500);
  const text = await shopper.locator('body').innerText();
  must(text.includes(first.name), 'the 24.50 product fell out of a 20-30 range');
  must(!text.includes(`dear-${RUN}`), 'a 500.00 product survived a 20-30 range');
});

await journey('clearing the filter restores everything a shopper may see', async () => {
  await shopper.getByRole('button', { name: 'Clear' }).click();
  await shopper.waitForTimeout(2500);
  const shown = await productCardCount(shopper);
  const listed = await api(tokenBuyerA, 'GET', '/products?limit=100');
  const visible = listed.json.items.filter((i) => i.status === 'active' || i.status === 'out_of_stock');
  must(shown === visible.length, `grid shows ${shown}, engine holds ${visible.length} sellable`);
});

await journey('an impossible range answers with an empty shop, not an error', async () => {
  await shopper.goto(`${WEB}/products`);
  await shopper.getByLabel('Min price').fill('900');
  await shopper.getByLabel('Max price').fill('10');
  await shopper.getByRole('button', { name: 'Search' }).click();
  await shopper.waitForTimeout(2500);
  must((await productCardCount(shopper)) === 0, 'something matched');
  must(/no products match|nothing/i.test(await shopper.locator('body').innerText()), 'no empty state');
});

await journey('paging through a large catalogue returns every product exactly once', async () => {
  // Enough to force several pages at the API's 25-per-page default.
  const bulk = [];
  for (let i = 0; i < 30; i += 1) {
    const res = await api(tokenAdminA, 'POST', '/products', {
      name: `bulk-${RUN}-${String(i).padStart(2, '0')}`,
      description: 'paging fixture',
      priceMinor: 100 + i,
      currency: 'USD',
      category: 'bulk',
      stock: 3,
      images: [],
      status: 'active',
      attributes: {},
    });
    must(res.status === 201, `bulk create ${i} answered ${res.status}`);
    bulk.push(res.json.id);
  }

  const seen = new Set();
  let cursor = null;
  let pages = 0;
  do {
    const page = await api(
      tokenAdminA,
      'GET',
      `/products?limit=10${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    must(page.status === 200, `page ${pages} answered ${page.status}`);
    for (const item of page.json.items) {
      must(!seen.has(item.id), `${item.id} came back on two pages`);
      seen.add(item.id);
    }
    cursor = page.json.nextCursor;
    pages += 1;
    must(pages < 30, 'pagination did not terminate');
  } while (cursor);

  for (const id of bulk) must(seen.has(id), `${id} was never returned by any page`);
});

await journey('a filter finds matches that sit beyond the first page of the catalogue', async () => {
  // The catalogue now holds 30+ bulk products priced around 1.00. This looks
  // for the one product priced far above them, which sits past whatever the
  // first page happens to read.
  const res = await api(tokenBuyerA, 'POST', '/products/search', {
    priceMinorMin: 40000,
    attributes: {},
    limit: 25,
    cursor: null,
  });
  const names = res.json.items.map((i) => i.name);
  must(
    names.some((nm) => nm.startsWith('dear-')),
    `search for >=400.00 returned ${res.json.items.length} items (${names.slice(0, 3).join(', ') || 'none'}) and missed the 500.00 product`,
  );
});

await journey('the storefront and the engine agree on how many products are for sale', async () => {
  await shopper.goto(`${WEB}/products`);
  await shopper.waitForTimeout(3000);
  const shown = await productCardCount(shopper);
  const listed = await api(tokenBuyerA, 'GET', '/products?limit=100');
  const sellable = listed.json.items.filter((i) => i.status === 'active' || i.status === 'out_of_stock');
  // The grid pages at 25; it must show a prefix of what the engine holds, never more.
  must(shown <= sellable.length, `grid shows ${shown}, engine holds ${sellable.length} sellable`);
  must(shown > 0, 'the grid is empty while the engine holds products');
});

// ======================================================== 3. buying journeys
section('A shopper buying');

let orderProduct;
await journey('a cart line carries the price the product was listed at', async () => {
  orderProduct = await createProduct({ price: '12.34', stock: '9' });
  await shopper.goto(`${WEB}/products/${orderProduct.id}`);
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.goto(`${WEB}/cart`);
  await shopper.waitForTimeout(1500);
  must((await shopper.locator('body').innerText()).includes('12.34'), 'the cart shows another price');
});

await journey('checkout writes an order the engine reports with the same lines', async () => {
  await shopper.getByLabel('Address').fill('42 Harbour Road');
  await shopper.getByLabel('City').fill('Bristol');
  await shopper.getByLabel('Postcode').fill('BS1 4TR');
  await shopper.getByRole('button', { name: 'Place order' }).click();
  await shopper.waitForURL(/\/orders\/[0-9A-Z]{26}/, { timeout: 60_000 });
  const orderId = shopper.url().split('/').pop();
  const got = await api(tokenBuyerA, 'GET', `/orders/${orderId}`);
  must(got.status === 200, `engine answered ${got.status}`);
  must(got.json.items.length === 1, `${got.json.items.length} lines`);
  must(got.json.items[0].productId === orderProduct.id, 'a different product was ordered');
  must(got.json.items[0].unitPriceMinor === 1234, `unit price ${got.json.items[0].unitPriceMinor}`);
});

await journey('ordering moves stock by exactly the quantity bought', async () => {
  const before = await api(tokenAdminA, 'GET', `/products/${orderProduct.id}`);
  await addToCartAndOrder(shopper, orderProduct.id, { qty: 3 });
  const after = await api(tokenAdminA, 'GET', `/products/${orderProduct.id}`);
  must(
    after.json.stock === before.json.stock - 3,
    `stock went ${before.json.stock} -> ${after.json.stock}, expected -3`,
  );
});

await journey('the stock the shopper sees matches the stock the engine holds', async () => {
  const got = await api(tokenBuyerA, 'GET', `/products/${orderProduct.id}`);
  await shopper.goto(`${WEB}/products/${orderProduct.id}`);
  await shopper.waitForTimeout(2000);
  const text = await shopper.locator('body').innerText();
  must(text.includes(`${got.json.stock} in stock`), `page does not say "${got.json.stock} in stock"`);
});

await journey('an order with two different products keeps both lines', async () => {
  const second = await createProduct({ price: '5.00', stock: '4' });
  await shopper.goto(`${WEB}/products/${orderProduct.id}`);
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.goto(`${WEB}/products/${second.id}`);
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.goto(`${WEB}/cart`);
  await shopper.getByLabel('Address').fill('42 Harbour Road');
  await shopper.getByLabel('City').fill('Bristol');
  await shopper.getByLabel('Postcode').fill('BS1 4TR');
  await shopper.getByRole('button', { name: 'Place order' }).click();
  await shopper.waitForURL(/\/orders\/[0-9A-Z]{26}/, { timeout: 60_000 });
  const got = await api(tokenBuyerA, 'GET', `/orders/${shopper.url().split('/').pop()}`);
  must(got.json.items.length === 2, `${got.json.items.length} lines, expected 2`);
});

await journey('the order total equals the sum of its lines, computed by the engine', async () => {
  const list = await api(tokenBuyerA, 'GET', '/orders?limit=1');
  const order = list.json.items[0];
  const sum = order.items.reduce((t, i) => t + i.unitPriceMinor * i.quantity, 0);
  must(order.totalAmountMinor === sum, `total ${order.totalAmountMinor} vs lines ${sum}`);
});

await journey('the order page shows the total the engine calculated', async () => {
  const list = await api(tokenBuyerA, 'GET', '/orders?limit=1');
  const order = list.json.items[0];
  await shopper.goto(`${WEB}/orders/${order.id}`);
  await shopper.waitForTimeout(2500);
  const shown = (await shopper.locator('body').innerText()).replace(/,/g, '');
  const expected = (order.totalAmountMinor / 100).toFixed(2);
  must(shown.includes(expected), `page does not show ${expected}`);
});

await journey('a shopper cannot buy more than the shop has left', async () => {
  const scarce = await createProduct({ stock: '2', price: '1.00' });
  const res = await api(tokenBuyerA, 'POST', '/orders', {
    items: [{ productId: scarce.id, quantity: 5 }],
    currency: 'USD',
    shippingAddress: { line1: '1', city: 'T', postcode: 'T1' },
    attributes: {},
  });
  must(res.status === 409, `engine answered ${res.status}`);
  const after = await api(tokenAdminA, 'GET', `/products/${scarce.id}`);
  must(after.json.stock === 2, `stock moved to ${after.json.stock} on a refused order`);
});

await journey('buying the last unit turns the listing sold out for the next shopper', async () => {
  const last = await createProduct({ stock: '1', price: '3.00' });
  await addToCartAndOrder(shopper, last.id);
  const after = await api(tokenAdminA, 'GET', `/products/${last.id}`);
  must(after.json.stock === 0, `stock is ${after.json.stock}`);
  await shopper.goto(`${WEB}/products/${last.id}`);
  await shopper.waitForTimeout(2000);
  must(await shopper.getByRole('button', { name: 'Add to cart' }).isDisabled(), 'still buyable at zero stock');
});

await journey('two shoppers racing for one unit produce one sale, not two', async () => {
  const contested = await createProduct({ stock: '1', price: '2.00' });
  const body = {
    items: [{ productId: contested.id, quantity: 1 }],
    currency: 'USD',
    shippingAddress: { line1: '1', city: 'T', postcode: 'T1' },
    attributes: {},
  };
  const [one, two] = await Promise.all([
    api(tokenBuyerA, 'POST', '/orders', body, { 'idempotency-key': `race-${RUN}-1` }),
    api(tokenAdminA, 'POST', '/orders', body, { 'idempotency-key': `race-${RUN}-2` }),
  ]);
  const won = [one, two].filter((r) => r.status === 201).length;
  const after = await api(tokenAdminA, 'GET', `/products/${contested.id}`);
  must(won === 1, `${won} of 2 racing orders succeeded`);
  must(after.json.stock === 0, `stock left at ${after.json.stock}`);
});

await journey('a resubmitted checkout does not charge the shopper twice', async () => {
  const p = await createProduct({ stock: '8', price: '4.00' });
  const body = {
    items: [{ productId: p.id, quantity: 2 }],
    currency: 'USD',
    shippingAddress: { line1: '1', city: 'T', postcode: 'T1' },
    attributes: {},
  };
  const key = `resubmit-${RUN}`;
  const one = await api(tokenBuyerA, 'POST', '/orders', body, { 'idempotency-key': key });
  const two = await api(tokenBuyerA, 'POST', '/orders', body, { 'idempotency-key': key });
  const after = await api(tokenAdminA, 'GET', `/products/${p.id}`);
  must(one.json.id === two.json?.id, `two different orders: ${one.json.id} and ${two.json?.id}`);
  must(after.json.stock === 6, `stock is ${after.json.stock}, expected 6`);
});

await journey('the orders list shows every order the shopper has placed', async () => {
  const listed = await api(tokenBuyerA, 'GET', '/orders?limit=100');
  await shopper.goto(`${WEB}/orders`);
  await shopper.waitForTimeout(2500);
  const rows = await shopper.locator('.ant-table-tbody tr.ant-table-row').count();
  must(rows === listed.json.items.length, `page shows ${rows}, engine holds ${listed.json.items.length}`);
});

await journey('an order names its products rather than printing their identifiers', async () => {
  const listed = await api(tokenBuyerA, 'GET', '/orders?limit=1');
  await shopper.goto(`${WEB}/orders/${listed.json.items[0].id}`);
  await shopper.waitForTimeout(2500);
  const cells = await shopper.locator('.ant-table-tbody tr.ant-table-row td:first-child').allInnerTexts();
  must(cells.length > 0, 'no line items rendered');
  for (const cell of cells) must(!/^[0-9A-Z]{26}$/.test(cell.trim()), `a raw id is shown: ${cell}`);
});

// ==================================================== 4. event journeys
section('Events and tickets');

let eventId;
await journey('an event created in the cockpit is readable through the API', async () => {
  await seller.goto(`${WEB}/admin/events/new`);
  const title = `journey-event-${RUN}`;
  await seller.getByLabel('Title').fill(title);
  await seller.getByLabel('Capacity').fill('4');
  await seller.getByLabel('Starts').click();
  await seller.keyboard.type('2026-12-01 10:00:00');
  await seller.keyboard.press('Enter');
  await seller.getByLabel('Ends').click();
  await seller.keyboard.type('2026-12-01 18:00:00');
  await seller.keyboard.press('Enter');
  await seller.getByLabel('Base price').fill('20');
  await seller.getByRole('button', { name: 'Create' }).click();
  await seller.waitForURL(/\/events\/[0-9A-Z]{26}/, { timeout: 40_000 });
  eventId = seller.url().split('/').pop();
  const got = await api(tokenAdminA, 'GET', `/events/${eventId}`);
  must(got.json.title === title, `engine has ${got.json.title}`);
  must(got.json.capacity === 4, `capacity ${got.json.capacity}`);
  must(got.json.bookedCount === 0, `bookedCount starts at ${got.json.bookedCount}`);
});

await journey('booking in the browser raises the booked count in the engine', async () => {
  await shopper.goto(`${WEB}/events/${eventId}`);
  await shopper.getByLabel('Tickets').fill('2');
  await shopper.getByRole('button', { name: 'Book' }).click();
  await shopper.waitForURL(/\/bookings\/[0-9A-Z]{26}/, { timeout: 60_000 });
  const got = await api(tokenAdminA, 'GET', `/events/${eventId}`);
  must(got.json.bookedCount === 2, `bookedCount is ${got.json.bookedCount}`);
});

await journey('the booking record names the event it belongs to', async () => {
  await shopper.waitForTimeout(2000);
  must((await shopper.locator('body').innerText()).includes(`journey-event-${RUN}`), 'no event title');
});

await journey('tickets beyond the remaining capacity are refused by the engine', async () => {
  const res = await api(tokenBuyerA, 'POST', '/bookings', {
    eventId,
    ticketQuantity: 3,
    attributes: {},
  });
  must(res.status === 409, `engine answered ${res.status} for 3 tickets against 2 remaining`);
});

await journey('booking the remainder fills the event exactly', async () => {
  const res = await api(tokenBuyerA, 'POST', '/bookings', {
    eventId,
    ticketQuantity: 2,
    attributes: {},
  });
  must(res.status === 201, `engine answered ${res.status}`);
  const got = await api(tokenAdminA, 'GET', `/events/${eventId}`);
  must(got.json.bookedCount === 4, `bookedCount is ${got.json.bookedCount}, capacity 4`);
});

await journey('a full event refuses even a single further ticket', async () => {
  const res = await api(tokenBuyerA, 'POST', '/bookings', {
    eventId,
    ticketQuantity: 1,
    attributes: {},
  });
  must(res.status === 409, `engine answered ${res.status} on a full event`);
});

await journey('concurrent bookings never oversell an event', async () => {
  const created = await api(tokenAdminA, 'POST', '/events', {
    title: `race-event-${RUN}`,
    capacity: 5,
    startDate: '2026-12-02T10:00:00.000Z',
    endDate: '2026-12-02T18:00:00.000Z',
    basePriceMinor: 500,
    currency: 'USD',
    attributes: {},
  });
  const id = created.json.id;
  const attempts = await Promise.all(
    Array.from({ length: 12 }, () =>
      api(tokenBuyerA, 'POST', '/bookings', { eventId: id, ticketQuantity: 1, attributes: {} }),
    ),
  );
  const booked = attempts.filter((r) => r.status === 201).length;
  const got = await api(tokenAdminA, 'GET', `/events/${id}`);
  must(booked === 5, `${booked} of 12 bookings succeeded, capacity was 5`);
  must(got.json.bookedCount === 5, `bookedCount is ${got.json.bookedCount}`);
});

await journey('the bookings page lists what the engine holds for this shopper', async () => {
  const listed = await api(tokenBuyerA, 'GET', '/bookings?limit=100');
  await shopper.goto(`${WEB}/bookings`);
  await shopper.waitForTimeout(2500);
  const rows = await shopper.locator('.ant-table-tbody tr.ant-table-row').count();
  must(rows === listed.json.items.length, `page shows ${rows}, engine holds ${listed.json.items.length}`);
});

// ================================================== 5. announcement journeys
section('The seller speaking to the shop');

const NOTICE = `Journey sale ${RUN}`;
await journey('an announcement saved in the cockpit is stored by the engine', async () => {
  await seller.goto(`${WEB}/admin/settings`);
  await seller.waitForTimeout(2000);
  await seller.getByLabel('Announcement').fill(NOTICE);
  const toggle = seller.getByRole('switch');
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await seller.getByRole('button', { name: 'Save' }).click();
  await seller.getByText('Announcement saved').waitFor({ timeout: 20_000 });
  const got = await api(tokenAdminA, 'GET', '/settings/announcement');
  must(got.json.text === NOTICE, `engine holds "${got.json.text}"`);
  must(got.json.enabled === true, 'engine has it disabled');
});

await journey("the announcement reaches a shopper's storefront", async () => {
  await shopper.goto(`${WEB}/products`);
  await shopper.waitForTimeout(2500);
  must((await shopper.locator('body').innerText()).includes(NOTICE), 'the shopper never sees it');
});

await journey('turning the announcement off removes it from the shop', async () => {
  await seller.goto(`${WEB}/admin/settings`);
  await seller.waitForTimeout(2000);
  await seller.getByRole('switch').click();
  await seller.getByRole('button', { name: 'Save' }).click();
  await seller.getByText('Announcement saved').waitFor({ timeout: 20_000 });
  await shopper.goto(`${WEB}/products`);
  await shopper.waitForTimeout(2500);
  must(!(await shopper.locator('body').innerText()).includes(NOTICE), 'the strip lingered');
});

await journey('the announcement text survives being switched off and on again', async () => {
  await seller.goto(`${WEB}/admin/settings`);
  await seller.waitForTimeout(2000);
  must((await seller.getByLabel('Announcement').inputValue()) === NOTICE, 'the text was lost');
  await seller.getByRole('switch').click();
  await seller.getByRole('button', { name: 'Save' }).click();
  await seller.getByText('Announcement saved').waitFor({ timeout: 20_000 });
  await shopper.goto(`${WEB}/products`);
  await shopper.waitForTimeout(2500);
  must((await shopper.locator('body').innerText()).includes(NOTICE), 'it did not come back');
});

// ======================================================= 6. schema journeys
section('Changing the data model by conversation');

await journey('a described change becomes a queued proposal and then a recorded flow', async () => {
  await seller.goto(`${WEB}/admin/chat`);
  await seller.getByTestId('composer').waitFor({ timeout: 30_000 });
  await seller.waitForFunction(
    () => !document.querySelector('[data-testid="composer"]')?.disabled,
    null,
    { timeout: 60_000 },
  );
  await seller.getByTestId('composer').fill('Add a required text field called colour to Product');
  await seller.keyboard.press('Enter');
  await seller
    .getByTestId('phase')
    .filter({ hasText: 'awaiting_confirmation' })
    .first()
    .waitFor({ timeout: 240_000 });
  await seller.getByTestId('confirm').click();
  await seller.getByText('Proposal queued').waitFor({ timeout: 90_000 });

  // The queue, the consumer and the engine's writer all sit between the click
  // and the record; poll rather than assume.
  let flows = { json: { items: [] } };
  for (let i = 0; i < 30 && flows.json.items.length === 0; i += 1) {
    flows = await api(tokenAdminA, 'GET', '/flows?limit=10');
    if (flows.json.items.length === 0) await new Promise((r) => setTimeout(r, 1000));
  }
  must(flows.json.items.length === 1, `${flows.json.items.length} flows recorded`);
  must(flows.json.items[0].status === 'proposed', `status is ${flows.json.items[0].status}`);
});

await journey('an unexecuted flow leaves the registry untouched', async () => {
  const schema = await api(tokenAdminA, 'GET', '/schemas/Product');
  must(schema.json.fields?.colour === undefined, 'the field was applied before anyone executed it');
});

await journey('executing the flow raises the registry version', async () => {
  const before = await api(tokenAdminA, 'GET', '/schemas/Product');
  const flows = await api(tokenAdminA, 'GET', '/flows?limit=10');
  await seller.goto(`${WEB}/admin/flows/${flows.json.items[0].id}`);
  await seller.getByRole('button', { name: 'Execute' }).click();
  await seller.waitForTimeout(4000);
  const after = await api(tokenAdminA, 'GET', '/schemas/Product');
  must(after.json.version > before.json.version, `version ${before.json.version} -> ${after.json.version}`);
  must(after.json.fields.colour !== undefined, 'the field is not in the registry');
  state.flowApplied = true;
});

await journey(
  'the new field appears on the seller form without anyone redeploying anything',
  async () => {
    await seller.goto(`${WEB}/admin/products/new`);
    await seller.waitForTimeout(3000);
    must((await seller.getByLabel(/colour/i).count()) > 0, 'the form never grew the field');
  },
  () => state.flowApplied,
);

await journey(
  'the engine refuses a product that omits the newly required field',
  async () => {
    const res = await api(tokenAdminA, 'POST', '/products', {
      name: `no-colour-${RUN}`,
      description: 'missing the required attribute',
      priceMinor: 100,
      currency: 'USD',
      category: 'journeys',
      stock: 1,
      images: [],
      status: 'active',
      attributes: {},
    });
    must(res.status === 400 || res.status === 422, `engine answered ${res.status}`);
  },
  () => state.flowApplied,
);

await journey(
  'a product created with the new field carries it all the way to the shopper',
  async () => {
    const created = await createProduct({ colour: 'ultramarine' });
    const got = await api(tokenAdminA, 'GET', `/products/${created.id}`);
    must(got.json.attributes.colour === 'ultramarine', `stored ${JSON.stringify(got.json.attributes)}`);
    await shopper.goto(`${WEB}/products/${created.id}`);
    await shopper.waitForTimeout(2500);
    must(/ultramarine/i.test(await shopper.locator('body').innerText()), 'the shopper cannot see it');
  },
  () => state.flowApplied,
);

await journey(
  'the shopper can filter on a field that did not exist an hour ago',
  async () => {
    await shopper.goto(`${WEB}/products`);
    await shopper.waitForTimeout(2500);
    const filterable = await shopper.getByLabel(/colour/i).count();
    must(filterable > 0, 'the filter rail never grew the field');
  },
  () => state.flowApplied,
);

// =================================================== 7. tenant and role journeys
section('Two shops that must not meet');

await journey("another tenant's product is unreachable even by pasting its URL", async () => {
  const outsider = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const page = await outsider.newPage();
  await signIn(page, B_ADMIN);
  await page.goto(`${WEB}/products/${first.id}`);
  await page.waitForTimeout(2500);
  const text = await page.locator('body').innerText();
  must(!text.includes(first.name), "another tenant's product name was rendered");
  await outsider.close();
});

await journey("another tenant's catalogue is empty, not merely filtered", async () => {
  const listed = await api(tokenAdminB, 'GET', '/products?limit=100');
  must(listed.json.items.length === 0, `tenant B can see ${listed.json.items.length} products`);
});

await journey('an announcement belongs to the shop that set it', async () => {
  const mine = await api(tokenAdminA, 'GET', '/settings/announcement');
  const theirs = await api(tokenAdminB, 'GET', '/settings/announcement');
  must(mine.json.text === NOTICE, 'tenant A lost its announcement');
  must(theirs.json.text === '', `tenant B sees "${theirs.json.text}"`);
});

await journey("one shop's orders are invisible to the other", async () => {
  const mine = await api(tokenBuyerA, 'GET', '/orders?limit=100');
  const theirs = await api(tokenAdminB, 'GET', '/orders?limit=100');
  must(mine.json.items.length > 0, 'tenant A has no orders to compare');
  must(theirs.json.items.length === 0, `tenant B sees ${theirs.json.items.length} orders`);
});

await journey('a schema change in one shop does not reach the other', async () => {
  const theirs = await api(tokenAdminB, 'GET', '/schemas/Product');
  must(theirs.json.fields?.colour === undefined, "tenant B inherited tenant A's field");
});

await journey('a shopper cannot list goods, in the browser or against the API', async () => {
  const res = await api(tokenBuyerA, 'POST', '/products', {
    name: `buyer-made-${RUN}`,
    description: 'should not exist',
    priceMinor: 100,
    currency: 'USD',
    category: 'journeys',
    stock: 1,
    images: [],
    status: 'active',
    attributes: { colour: 'red' },
  });
  must(res.status === 403, `engine answered ${res.status}`);
});

await journey('a shopper cannot upload a photograph', async () => {
  const form = new FormData();
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'probe.png');
  const res = await fetch(`${ENGINE}/uploads/product-image`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokenBuyerA}` },
    body: form,
  });
  must(res.status === 403, `engine answered ${res.status}`);
});

await journey('a shopper cannot speak for the shop', async () => {
  const res = await api(tokenBuyerA, 'PUT', '/settings/announcement', {
    text: 'a shopper wrote this',
    enabled: true,
  });
  must(res.status === 403, `engine answered ${res.status}`);
  const still = await api(tokenAdminA, 'GET', '/settings/announcement');
  must(still.json.text === NOTICE, 'the announcement was changed anyway');
});

await journey('a shopper cannot alter the data model', async () => {
  const propose = await api(tokenBuyerA, 'POST', '/flows', {
    entityType: 'Product',
    addFields: { sneaky: { type: 'string', required: false } },
  });
  must(propose.status === 403, `propose answered ${propose.status}`);
  const flows = await api(tokenAdminA, 'GET', '/flows?limit=10');
  const execute = await api(tokenBuyerA, 'POST', `/flows/${flows.json.items[0].id}/execute`);
  must(execute.status === 403, `execute answered ${execute.status}`);
});

await journey('a shopper may still shop', async () => {
  const p = await createProduct({ stock: '3', price: '6.00' });
  const orderId = await addToCartAndOrder(shopper, p.id);
  const got = await api(tokenBuyerA, 'GET', `/orders/${orderId}`);
  must(got.status === 200, `the shopper cannot read their own order: ${got.status}`);
});

// ==================================================== 8. resilience journeys
section('When things go wrong or sideways');

await journey('signing out ends the session for the protected pages', async () => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, A_BUYER);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login/, { timeout: 20_000 });
  await page.goto(`${WEB}/orders`);
  await page.waitForTimeout(2000);
  must(page.url().includes('/login'), `orders was served at ${page.url()}`);
  await ctx.close();
});

await journey('a cart survives a reload of the page', async () => {
  const p = await createProduct({ stock: '5' });
  await shopper.goto(`${WEB}/products/${p.id}`);
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.goto(`${WEB}/cart`);
  await shopper.reload();
  await shopper.waitForTimeout(2000);
  must((await shopper.locator('body').innerText()).includes(p.name), 'the cart emptied on reload');
});

await journey('an order that does not exist is reported, not crashed on', async () => {
  await shopper.goto(`${WEB}/orders/01ARZ3NDEKTSV4RRFFQ69G5FAV`);
  await shopper.waitForTimeout(2500);
  const text = await shopper.locator('body').innerText();
  must(/not found|no order|something went wrong|does not exist/i.test(text), `page said: ${text.slice(0, 120)}`);
});

await journey('a nonsense identifier in the URL does not take the page down', async () => {
  await shopper.goto(`${WEB}/products/../../etc/passwd`);
  await shopper.waitForTimeout(2000);
  must(!/application error/i.test(await shopper.locator('body').innerText()), 'the app fell over');
});

await journey('a tampered pagination cursor is refused with a 400, not a 500', async () => {
  const junk = Buffer.from('{"PK":"TENANT#someone-else"}').toString('base64url');
  const res = await api(tokenBuyerA, 'GET', `/products?limit=5&cursor=${encodeURIComponent(junk)}`);
  must(res.status === 400, `engine answered ${res.status}`);
});

await journey('an expired-looking or forged token is refused everywhere', async () => {
  const forged = `${Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')}.${Buffer.from(
    JSON.stringify({ sub: 'x', 'custom:tenant_id': A, 'custom:role': 'admin' }),
  ).toString('base64url')}.`;
  for (const p of ['/products', '/orders', '/settings/announcement']) {
    const res = await api(forged, 'GET', p);
    must(res.status === 401, `${p} answered ${res.status} to a forged token`);
  }
});

await journey('the whole run produced no server error on any page the browser touched', async () => {
  must(serverErrors.length === 0, `server errors: ${serverErrors.slice(0, 3).join(' | ')}`);
});

// -------------------------------------------------------------------- report
const passed = results.filter((r) => r.status === 'pass').length;
const skipped = results.filter((r) => r.status === 'skip').length;
const failed = results.filter((r) => r.status === 'fail');

console.log(
  `\n================ ${results.length} journeys: ${passed} passed, ${failed.length} failed, ${skipped} skipped`,
);
for (const f of failed) console.log(`  ${f.id} [${f.group}] ${f.name}\n      ${f.message}`);

writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
console.log(`\nreport: ${OUT}/report.json   failure screenshots: ${SHOTS}`);

await browser.close();
