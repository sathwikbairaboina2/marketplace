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

const WEB = 'http://localhost:33002';
const ENGINE = 'http://127.0.0.1:33000/api/v1';
const OUT =
  process.env.JOURNEYS_OUT ??
  fileURLToPath(new URL('../../test-results/e2e-journeys', import.meta.url));
const SHOTS = `${OUT}/failures`;
const ENV_FILE = fileURLToPath(new URL('../../../../docker/.env.generated', import.meta.url));
const PASSWORD = 'Passw0rd!';

const RUN = Date.now().toString(36);

/**
 * What `createProduct` prices in, and therefore what an order placed through
 * the API must be denominated in: the engine throws `mixed-currency-order`
 * when they differ, so a hardcoded 'USD' here turns every stock and race
 * assertion into a 422 about currency.
 */
const CURRENCY = 'INR';
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

/**
 * A browser context with room to make its first connection.
 *
 * Measured on this machine: the shop host answers in ~20ms over curl and ~90ms
 * in a warm browser, and yet a *first* navigation to an origin a context has
 * not used before intermittently overran Playwright's 30s default -- landing
 * on a different journey each run (76, 80, 83, 84), always the first time some
 * context met some host. `*.localhost` resolves to ::1 first and Docker
 * Desktop's IPv6 loopback proxy is not always listening for a name it has not
 * been asked for; curl falls back to IPv4 and Chromium does not.
 *
 * Ninety seconds, so that stall is slow rather than a failure. A real
 * regression still fails, because everything inside a journey keeps its own
 * much shorter timeout.
 */
async function freshContext(options = {}) {
  const ctx = await browser.newContext(options);
  ctx.setDefaultNavigationTimeout(90_000);
  return ctx;
}

// ------------------------------------------------------------------ browsers
const tokenAdminA = await mint(A, A_ADMIN, 'admin');
const tokenBuyerA = await mint(A, A_BUYER, 'buyer');
const tokenAdminB = await mint(B, B_ADMIN, 'admin');

// A store that has never published a storefront greets its admin with the
// onboarding wizard. Tenants A and B are here to exercise everything else, so
// they skip it up front exactly the way a real owner can; the wizard has its
// own tenants in the onboarding section near the end.
await api(tokenAdminA, 'PUT', '/storefront/onboarding', { dismissed: true });
await api(tokenAdminB, 'PUT', '/storefront/onboarding', { dismissed: true });

const browser = await chromium.launch();
const sellerCtx = await freshContext({ viewport: { width: 1440, height: 900 } });
const shopperCtx = await freshContext({ viewport: { width: 1440, height: 900 } });
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

/** Fills the payment page a successful checkout lands on. 4242… succeeds. */
async function payOnPayPage(page, number = '4242 4242 4242 4242') {
  // UPI leads on the pay page now; the card form has to be chosen first.
  await page.locator('label.ant-radio-button-wrapper', { hasText: 'Card' }).click();
  await page.getByTestId('card-number').fill(number);
  await page.getByTestId('card-month').fill('12');
  await page.getByTestId('card-year').fill('2030');
  await page.getByTestId('card-cvc').fill('123');
  await page.getByTestId('pay-now').click();
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
  await page.waitForTimeout(600);
  await page.goto(`${WEB}/cart`);
  await page.getByLabel('Full name').fill('Priya Deshpande');
  await page.getByLabel('Phone').fill('+91 98765 43210');
  await page.getByLabel('Address').fill('42 Harbour Road');
  await page.getByLabel('City').fill(city);
  await page.getByLabel('PIN code').fill('411004');
  // Checkout reserves the order into the payment gate, then the fake
  // provider's success card confirms it into stage 1 -- the state every
  // downstream journey expects.
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.waitForURL(/\/orders\/[0-9A-Z]{26}\/pay/, { timeout: 60_000 });
  const orderId = page.url().split('/').slice(-2)[0];
  await payOnPayPage(page);
  await page.waitForURL(new RegExp(`/orders/${orderId}$`), { timeout: 60_000 });
  return orderId;
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
      currency: CURRENCY,
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
  await shopper.getByLabel('Full name').fill('Priya Deshpande');
  await shopper.getByLabel('Phone').fill('+91 98765 43210');
  await shopper.getByLabel('Address').fill('42 Harbour Road');
  await shopper.getByLabel('City').fill('Bristol');
  await shopper.getByLabel('PIN code').fill('411004');
  await shopper.getByRole('button', { name: 'Checkout' }).click();
  await shopper.waitForURL(/\/orders\/[0-9A-Z]{26}\/pay/, { timeout: 60_000 });
  const orderId = shopper.url().split('/').slice(-2)[0];
  await payOnPayPage(shopper);
  await shopper.waitForURL(new RegExp(`/orders/${orderId}$`), { timeout: 60_000 });
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

await journey('the availability the shopper sees matches the stock the engine holds', async () => {
  const got = await api(tokenBuyerA, 'GET', `/products/${orderProduct.id}`);
  await shopper.goto(`${WEB}/products/${orderProduct.id}`);
  await shopper.waitForTimeout(2000);
  const text = await shopper.locator('body').innerText();
  // A shopper is told whether to hurry, not how much the shop holds: the
  // exact count is the seller's business and used to be on every card.
  const stock = got.json.stock;
  const expected = stock === 0 ? 'Sold out' : stock <= 5 ? `Only ${stock} left` : 'In stock';
  must(text.includes(expected), `page does not say "${expected}" for a stock of ${stock}`);
  must(!/\d+ in stock/.test(text), 'the page publishes an exact stock count');
});

await journey('an order with two different products keeps both lines', async () => {
  const second = await createProduct({ price: '5.00', stock: '4' });
  await shopper.goto(`${WEB}/products/${orderProduct.id}`);
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.goto(`${WEB}/products/${second.id}`);
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.goto(`${WEB}/cart`);
  await shopper.getByLabel('Full name').fill('Priya Deshpande');
  await shopper.getByLabel('Phone').fill('+91 98765 43210');
  await shopper.getByLabel('Address').fill('42 Harbour Road');
  await shopper.getByLabel('City').fill('Bristol');
  await shopper.getByLabel('PIN code').fill('411004');
  await shopper.getByRole('button', { name: 'Checkout' }).click();
  await shopper.waitForURL(/\/orders\/[0-9A-Z]{26}\/pay/, { timeout: 60_000 });
  const twoLineOrderId = shopper.url().split('/').slice(-2)[0];
  await payOnPayPage(shopper);
  await shopper.waitForURL(new RegExp(`/orders/${twoLineOrderId}$`), { timeout: 60_000 });
  const got = await api(tokenBuyerA, 'GET', `/orders/${twoLineOrderId}`);
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
    currency: CURRENCY,
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
    currency: CURRENCY,
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
    currency: CURRENCY,
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
    currency: CURRENCY,
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

await journey('the seller sees every booking the shop has taken', async () => {
  const listed = await api(tokenAdminA, 'GET', '/bookings/all?limit=100');
  must(listed.status === 200, `shop-wide list answered ${listed.status}`);
  must(listed.json.items.length > 0, 'the shop has taken bookings above and the list is empty');
  await seller.goto(`${WEB}/admin/bookings`);
  await seller.waitForTimeout(2500);
  const rows = await seller.locator('.ant-table-tbody tr.ant-table-row').count();
  must(rows === listed.json.items.length, `cockpit shows ${rows}, engine holds ${listed.json.items.length}`);
  const refused = await api(tokenBuyerA, 'GET', '/bookings/all');
  must(refused.status === 403, `a buyer got ${refused.status} from the shop-wide list`);
});

// ================================================== 5. announcement journeys
section('The seller speaking to the shop');

const NOTICE = `Journey sale ${RUN}`;
await journey('an announcement saved in the cockpit is stored by the engine', async () => {
  await seller.goto(`${WEB}/admin/settings`);
  await seller.waitForTimeout(2000);
  await seller.getByLabel('Announcement').fill(NOTICE);
  const toggle = seller.getByLabel('Show it');
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await seller.getByRole('button', { name: 'Save announcement' }).click();
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
  await seller.getByLabel('Show it').click();
  await seller.getByRole('button', { name: 'Save announcement' }).click();
  await seller.getByText('Announcement saved').waitFor({ timeout: 20_000 });
  await shopper.goto(`${WEB}/products`);
  await shopper.waitForTimeout(2500);
  must(!(await shopper.locator('body').innerText()).includes(NOTICE), 'the strip lingered');
});

await journey('the announcement text survives being switched off and on again', async () => {
  await seller.goto(`${WEB}/admin/settings`);
  await seller.waitForTimeout(2000);
  must((await seller.getByLabel('Announcement').inputValue()) === NOTICE, 'the text was lost');
  await seller.getByLabel('Show it').click();
  await seller.getByRole('button', { name: 'Save announcement' }).click();
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
      currency: CURRENCY,
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
  const outsider = await freshContext({ viewport: { width: 1200, height: 800 } });
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
    currency: CURRENCY,
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
  const ctx = await freshContext();
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

// ================================================= N. owner-defined stages
section('A shop with stages of its own');

/**
 * Names no part of this system has ever seen. That is the point: if any of it
 * were keyed to "Shipped", or to a fixed number of stages, this section is
 * where it would show.
 */
const STAGE_ONE = `Received in studio ${RUN}`;
const STAGE_TWO = `Mount cut ${RUN}`;
const STAGE_THREE = `Collected ${RUN}`;

let stagedOrder;

await journey('an owner names the stages an order will pass through', async () => {
  await seller.goto(`${WEB}/admin/settings`);
  await seller.getByLabel('Stage 1 name').waitFor({ timeout: 30_000 });

  // A shop that has never configured one starts with a single cancellable
  // stage; this renames it and turns its thread on.
  await seller.getByLabel('Stage 1 name').fill(STAGE_ONE);
  await seller.getByTestId('stage-row-0').getByRole('button', { name: 'Messages' }).click();

  await seller.getByRole('button', { name: 'Add stage' }).click();
  await seller.getByLabel('Stage 2 name').fill(STAGE_TWO);
  await seller.getByTestId('stage-row-1').getByRole('button', { name: 'Messages' }).click();

  await seller.getByRole('button', { name: 'Add stage' }).click();
  await seller.getByLabel('Stage 3 name').fill(STAGE_THREE);

  await seller.getByRole('button', { name: 'Publish stages' }).click();
  await seller.waitForTimeout(1500);

  // Checked where it landed, not merely where it was typed.
  const stored = await api(tokenAdminA, 'GET', '/settings/pipeline');
  must(stored.status === 200, `pipeline read answered ${stored.status}`);
  must(
    stored.json.stages.map((s) => s.name).join(' | ') ===
      [STAGE_ONE, STAGE_TWO, STAGE_THREE].join(' | '),
    `engine holds ${JSON.stringify(stored.json.stages.map((s) => s.name))}`,
  );
  must(stored.json.stages[0].cancellable === true, 'first stage should be cancellable');
  must(stored.json.stages[2].messaging === false, 'third stage should have no thread');
});

await journey('an order placed afterwards starts in the shop own first stage', async () => {
  const product = await createProduct({ stock: '4' });
  stagedOrder = await addToCartAndOrder(shopper, product.id);
  await shopper.waitForTimeout(1000);

  must(
    await shopper.getByText(STAGE_ONE).first().isVisible(),
    'the buyer order page does not show the first stage',
  );

  const fromApi = await api(tokenBuyerA, 'GET', `/orders/${stagedOrder}`);
  must(fromApi.status === 200, `order read answered ${fromApi.status}`);
  must(
    fromApi.json.currentStageId === fromApi.json.stages[0].id,
    'the order did not start in the first stage',
  );
});

await journey('a buyer writes to the shop on a stage that allows it', async () => {
  await shopper.getByPlaceholder('Write a message…').first().fill('Artwork is in the post');
  await shopper.getByRole('button', { name: 'Send' }).first().click();
  await shopper.waitForTimeout(1200);

  const thread = await api(tokenBuyerA, 'GET', `/orders/${stagedOrder}/messages`);
  must(thread.status === 200, `thread read answered ${thread.status}`);
  must(thread.json.items.length === 1, `thread holds ${thread.json.items.length} messages`);
  must(thread.json.items[0].authorRole === 'buyer', 'the buyer was not recorded as the buyer');
});

await journey('a seller advances the order and the buyer sees it move', async () => {
  await seller.goto(`${WEB}/admin/orders/${stagedOrder}`);
  await seller.getByRole('button', { name: `Advance to ${STAGE_TWO}` }).click();
  await seller.waitForTimeout(1500);

  await shopper.reload();
  await shopper.waitForTimeout(1200);
  must(
    await shopper.getByText(STAGE_TWO).first().isVisible(),
    'the buyer page does not show the new stage',
  );

  const fromApi = await api(tokenBuyerA, 'GET', `/orders/${stagedOrder}`);
  must(
    fromApi.json.currentStageId === fromApi.json.stages[1].id,
    'the order did not advance to the second stage',
  );
});

await journey('a message written after the move belongs to the new stage', async () => {
  await shopper.getByPlaceholder('Write a message…').first().fill('Any idea when it is ready?');
  await shopper.getByRole('button', { name: 'Send' }).first().click();
  await shopper.waitForTimeout(1200);

  const thread = await api(tokenBuyerA, 'GET', `/orders/${stagedOrder}/messages`);
  const stages = (await api(tokenBuyerA, 'GET', `/orders/${stagedOrder}`)).json.stages;
  const landed = thread.json.items.map((m) => m.stageId);
  must(landed.includes(stages[0].id), 'the first message left its stage');
  must(landed.includes(stages[1].id), 'the second message did not land in the new stage');
});

await journey('the shop withholds cancellation in a stage that forbids it', async () => {
  // Stage two was left uncancellable, so the control is simply not there.
  must(
    (await shopper.getByRole('button', { name: 'Cancel order' }).count()) === 0,
    'the buyer is still offered a cancellation',
  );

  const refused = await api(tokenBuyerA, 'POST', `/orders/${stagedOrder}/cancel`);
  must(refused.status === 409, `the engine answered ${refused.status} to a forbidden cancel`);
});

await journey('a cancellation in an allowed stage puts the stock back', async () => {
  const product = await createProduct({ stock: '7' });
  const orderId = await addToCartAndOrder(shopper, product.id, { qty: 3 });

  const during = await api(tokenAdminA, 'GET', `/products/${product.id}`);
  must(during.json.stock === 4, `stock during the order was ${during.json.stock}`);

  await shopper.getByRole('button', { name: 'Cancel order' }).click();
  await shopper.getByRole('button', { name: 'Cancel order', exact: true }).last().click();
  await shopper.waitForTimeout(1800);

  const after = await api(tokenAdminA, 'GET', `/products/${product.id}`);
  must(after.json.stock === 7, `stock after the cancellation was ${after.json.stock}`);

  const order = await api(tokenBuyerA, 'GET', `/orders/${orderId}`);
  must(order.json.status === 'cancelled', `the order is ${order.json.status}`);
  // It keeps its stage, so the tracker can say where it stopped.
  must(order.json.currentStageId === order.json.stages[0].id, 'the cancelled order moved');
});

await journey('an order already in flight keeps the stages it was placed under', async () => {
  await seller.goto(`${WEB}/admin/settings`);
  await seller.getByLabel('Stage 1 name').waitFor({ timeout: 30_000 });
  await seller.getByLabel('Stage 1 name').fill(`Renamed entirely ${RUN}`);
  await seller.getByRole('button', { name: 'Publish stages' }).click();
  await seller.waitForTimeout(1500);

  const order = await api(tokenBuyerA, 'GET', `/orders/${stagedOrder}`);
  must(
    order.json.stages[0].name === STAGE_ONE,
    `an in-flight order now reads ${order.json.stages[0].name}`,
  );
});

// ==================================================== 8. owner onboarding
section('Owner onboarding and the generated storefront');

const C = `jt-${RUN}-c`;
const D = `jt-${RUN}-d`;
const tokenAdminC = await mint(C, `${C}-admin`, 'admin');
const tokenBuyerC = await mint(C, `${C}-buyer`, 'buyer');
await mint(D, `${D}-admin`, 'admin');

const ownerCtx = await freshContext({ viewport: { width: 1440, height: 900 } });
const owner = await ownerCtx.newPage();
owner.on('response', (r) => {
  if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
});

await journey('a fresh owner opening the cockpit lands in the wizard', async () => {
  await signIn(owner, `${C}-admin`);
  await owner.goto(`${WEB}/admin/products`);
  await owner.waitForURL(/\/admin\/onboarding/, { timeout: 30_000 });
});

await journey('describing the business produces a previewable draft the engine holds', async () => {
  await owner.getByTestId('composer').waitFor({ timeout: 30_000 });
  await owner.waitForFunction(
    () => !document.querySelector('[data-testid="composer"]')?.disabled,
    null,
    { timeout: 60_000 },
  );
  await owner
    .getByTestId('composer')
    .fill(
      // Answers both halves the interview now asks about: who the business is,
      // and how its shop has to work. A message covering only the first half
      // leaves the model rightly still asking questions.
      'I run a small pottery studio called Kiln & Loom. Warm, personal tone. My customers are gift shoppers who like handmade ceramics. I sell physical goods: mugs, jugs and bowls. I post them out or people collect. Prices are mid-range, 20 to 90 pounds. Every piece is hand-thrown by me.',
    );
  await owner.keyboard.press('Enter');
  try {
    await owner.getByTestId('preview').waitFor({ timeout: 300_000 });
  } catch {
    // The model chose to ask instead of drafting. Answer once, plainly.
    await owner
      .getByTestId('composer')
      .fill(
        'Kind of business: pottery studio. Name: Kiln & Loom. Tone: warm and personal. Audience: gift shoppers. Sells physical goods. Categories: mugs, jugs, bowls. Fulfilment: posted or collected. Price band: 20 to 90 pounds. Different because every piece is hand-thrown by me.',
      );
    await owner.keyboard.press('Enter');
    await owner.getByTestId('preview').waitFor({ timeout: 300_000 });
  }

  // Generation is nondeterministic, so the assertions are structural: the
  // engine holds a draft with a hero banner and a written about page.
  const draft = await api(tokenAdminC, 'GET', '/storefront/draft');
  must(draft.json.draft, 'the engine holds no draft');
  must(
    draft.json.draft.banners.some((b) => b.slot === 'hero'),
    'the draft has no hero banner',
  );
  must(draft.json.draft.about.sections.length >= 1, 'the about page is empty');
});

await journey('publishing puts the generated storefront in front of customers', async () => {
  await owner.getByTestId('publish-store').click();
  await owner.getByRole('button', { name: 'Publish', exact: true }).click();
  await owner.waitForURL(/\/admin\/products/, { timeout: 30_000 });

  const published = (await api(tokenBuyerC, 'GET', '/storefront')).json;
  must(published?.config?.presetId, 'nothing was published');

  const buyerC = await (
    await freshContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  await signIn(buyerC, `${C}-buyer`);
  await buyerC.waitForTimeout(1000);

  const hero = buyerC.locator('.mp-banner[data-slot="hero"] h1').first();
  must(await hero.isVisible(), 'the storefront shows no hero banner');
  must((await hero.innerText()).trim().length > 0, 'the hero banner has no headline');

  // The preset actually painted: the page surface left the default palette.
  const surface = await buyerC.evaluate(() =>
    getComputedStyle(document.querySelector('.mp-shop')).getPropertyValue('--mp-surface').trim(),
  );
  must(surface !== '' && surface !== '#f8fafc', `the surface stayed default (${surface})`);

  await buyerC.goto(`${WEB}/about`);
  await buyerC.waitForTimeout(1200);
  must((await buyerC.locator('.mp-about h1').count()) > 0, 'the about page did not render');
  await buyerC.context().close();
});

await journey('the published storefront is on the shop host for a stranger with no session', async () => {
  const ctx = await freshContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`http://${C}.localhost:33002/products`);
  await page.locator('.mp-banner[data-slot="hero"] h1').first().waitFor({ timeout: 30_000 });
  must(!page.url().includes('/login'), 'a stranger was sent to sign in to see a published shop');
  const surface = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.mp-shop')).getPropertyValue('--mp-surface').trim(),
  );
  must(surface !== '' && surface !== '#f8fafc', `the preset did not paint for a stranger (${surface})`);
  await page.goto(`http://${C}.localhost:33002/about`);
  await page.locator('.mp-about h1').first().waitFor({ timeout: 30_000 });
  await ctx.close();
});

await journey('the wizard is re-enterable from settings with the draft intact', async () => {
  await owner.goto(`${WEB}/admin/settings`);
  await owner.getByRole('button', { name: 'Open store designer' }).click();
  await owner.waitForURL(/\/admin\/onboarding/, { timeout: 30_000 });
  await owner.getByTestId('preview').waitFor({ timeout: 60_000 });
});

await journey('an owner who skips the wizard is not asked again', async () => {
  await signIn(owner, `${D}-admin`);
  await owner.goto(`${WEB}/admin/products`);
  await owner.waitForURL(/\/admin\/onboarding/, { timeout: 30_000 });
  await owner.getByTestId('skip-onboarding').click();
  await owner.waitForURL(/\/admin\/products/, { timeout: 30_000 });
  await owner.reload();
  await owner.waitForTimeout(2500);
  must(
    !owner.url().includes('/admin/onboarding'),
    'a dismissed wizard came back on the next visit',
  );
});

// ================================================ 8b. the public storefront
section('A stranger at the door');

const SHOP_A = `http://${A}.localhost:33002`;
const SHOP_B = `http://${B}.localhost:33002`;
// A context of its own with no session in it: that is the whole point.
const strangerCtx = await freshContext({ viewport: { width: 1440, height: 900 } });
const stranger = await strangerCtx.newPage();
stranger.on('response', (r) => {
  if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
});
let openMug;
let hiddenDraft;

await journey('the shop host shows the active product and not the draft, with no session', async () => {
  openMug = await createProduct({ name: `open-${RUN}`, status: 'active' });
  hiddenDraft = await createProduct({ name: `hidden-${RUN}`, status: 'draft' });
  await stranger.goto(`${SHOP_A}/products`);
  await stranger.getByText(openMug.name).first().waitFor({ timeout: 30_000 });
  const text = await stranger.locator('body').innerText();
  must(!text.includes(hiddenDraft.name), 'a draft is on the public shop');
  must(!stranger.url().includes('/login'), 'a stranger was sent to sign in just to look');
  must(await stranger.getByRole('link', { name: 'Sign in' }).count(), 'no Sign in offered');
  must((await stranger.getByRole('link', { name: /Orders/ }).count()) === 0, 'Orders shown to a stranger');
});

await journey('a stranger opening a product can add it to a cart without signing in', async () => {
  // Guest checkout: the cart is a stranger's now (lib/shop/commerce). What
  // still asks for a session on a shop host is a booking.
  await stranger.goto(`${SHOP_A}/products/${openMug.id}`);
  await stranger.getByRole('heading', { name: openMug.name }).waitFor({ timeout: 30_000 });
  await stranger.getByRole('button', { name: 'Add to cart' }).click();
  await stranger.getByText(/added to cart/i).waitFor({ timeout: 15_000 });
  must(!stranger.url().includes('/login'), 'a stranger was sent to sign in to add to the cart');
  const ticket = await stranger.evaluate((t) => localStorage.getItem(`marketplace.guest.${t}`), A);
  must(typeof ticket === 'string' && ticket.includes('.'), 'no guest ticket was minted');
  // The stranger context is reused by the journeys below; leave its cart empty.
  await stranger.goto(`${SHOP_A}/cart`);
  await stranger.getByRole('button', { name: /remove/i }).first().click();
  await stranger.waitForTimeout(1000);
});

await journey('the events list opens to a stranger', async () => {
  await stranger.goto(`${SHOP_A}/events`);
  await stranger.getByRole('heading', { name: 'Events' }).waitFor({ timeout: 30_000 });
  must(!stranger.url().includes('/login'), 'events sent a stranger to sign in');
});

await journey("the other shop's host shows none of this shop's products", async () => {
  await stranger.goto(`${SHOP_B}/products`);
  await stranger.waitForTimeout(2500);
  const text = await stranger.locator('body').innerText();
  must(!text.includes(openMug.name), "tenant A's product is on tenant B's host");
});

await journey("a buyer from another shop is signed out on this shop's host", async () => {
  const ctx = await freshContext();
  const page = await ctx.newPage();
  await page.goto(`${SHOP_A}/login`);
  await page.getByLabel('Username').fill(B_ADMIN);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/products/, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  must(await page.getByRole('link', { name: 'Sign in' }).count(), 'a foreign session survived on the shop host');
  await ctx.close();
});

await journey("a buyer of this shop keeps their session on its host", async () => {
  const ctx = await freshContext();
  const page = await ctx.newPage();
  await page.goto(`${SHOP_A}/login`);
  await page.getByLabel('Username').fill(A_BUYER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/products/, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  must(await page.getByRole('link', { name: /Orders/ }).count(), 'the buyer lost their session on the shop host');
  await ctx.close();
});

await journey('the support box answers on the shop host, not only on the platform host', async () => {
  // The agents are a second origin-checking service. A shop origin the engine
  // admits but the agents refuse is a storefront where Ask says "Failed to
  // fetch" -- found by watching, never by a journey that asked from localhost.
  const ctx = await freshContext();
  const page = await ctx.newPage();
  await page.goto(`${SHOP_A}/login?next=%2Forders`);
  await page.getByLabel('Username').fill(A_BUYER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/orders/, { timeout: 30_000 });
  await page.getByTestId('support-question').fill('Where is my order?');
  await page.getByTestId('support-ask').click();
  await page.getByTestId('support-answer').waitFor({ timeout: 180_000 });
  const answer = (await page.getByTestId('support-answer').innerText()).trim();
  must(answer.length > 10 && !/failed to fetch/i.test(answer), `no answer on the shop host: ${answer.slice(0, 120)}`);
  await ctx.close();
});

await journey('a crawler on the shop host gets a title, JSON-LD, robots and a sitemap', async () => {
  // A stranger's browser again: nothing here may depend on a session.
  const ctx = await freshContext();
  const page = await ctx.newPage();
  await page.goto(`${SHOP_A}/products/${openMug.id}`);
  await page.waitForTimeout(1500);
  const title = await page.title();
  must(title.includes(openMug.name), `document title is "${title}"`);
  const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
  must(ld && JSON.parse(ld)['@type'] === 'Product' && JSON.parse(ld).name === openMug.name, 'no Product JSON-LD');
  const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
  must(canonical === `${SHOP_A}/products/${openMug.id}`, `canonical is ${canonical}`);

  // Through the browser, not fetch(): Node resolves no `*.localhost` name,
  // Chromium resolves every one of them to loopback. The crawler this
  // journey plays is the browser's kind.
  const robotsRes = await page.goto(`${SHOP_A}/robots.txt`);
  const robotsText = await page.locator('body').innerText();
  must(robotsRes?.status() === 200 && /Allow: \//.test(robotsText) && /Disallow: \/cart/.test(robotsText), `robots: ${robotsText.slice(0, 80)}`);
  must(robotsText.includes(`${SHOP_A}/sitemap.xml`), 'robots does not point at the sitemap');
  const sitemapRes = await page.goto(`${SHOP_A}/sitemap.xml`);
  const xml = await page.content();
  must(sitemapRes?.status() === 200 && xml.includes(`${SHOP_A}/products/${openMug.id}`), 'sitemap lacks the product');
  must(!xml.includes(hiddenDraft.id), 'sitemap leaks the draft');
  await page.goto(`${WEB}/robots.txt`);
  const closed = await page.locator('body').innerText();
  must(/Disallow: \/$/m.test(closed), `platform robots: ${closed.slice(0, 60)}`);
  await ctx.close();
});

let guestOrderId;
const GUEST_EMAIL = `stranger-${RUN}@example.com`;
await journey('a stranger buys a mug on the shop host without ever signing in', async () => {
  const ctx = await freshContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('response', (r) => {
    if (r.status() >= 500) serverErrors.push(`${r.status()} ${r.url()}`);
  });
  await page.goto(`${SHOP_A}/products/${openMug.id}`);
  await page.getByRole('button', { name: /add to cart/i }).click();
  await page.getByText(/added to cart/i).waitFor({ timeout: 15_000 });
  must(!page.url().includes('/login'), 'a stranger was sent to sign in to add to the cart');

  await page.goto(`${SHOP_A}/cart`);
  await page.getByLabel('Email').fill(GUEST_EMAIL);
  await page.getByLabel('Full name').fill('Priya Deshpande');
  await page.getByLabel('Phone').fill('+91 98765 43210');
  await page.getByLabel('Address').fill('42 Harbour Road');
  await page.getByLabel('City').fill('Bristol');
  await page.getByLabel('PIN code').fill('411004');
  await page.getByRole('button', { name: /checkout/i }).click();
  await page.waitForURL(/\/orders\/[0-9A-Z]{26}\/pay/, { timeout: 60_000 });
  guestOrderId = page.url().match(/orders\/([0-9A-Z]{26})/)[1];

  await page.locator('label.ant-radio-button-wrapper', { hasText: 'Card' }).click();
  await page.getByLabel('Card number').fill('4242424242424242');
  await page.getByLabel('Month').fill('12');
  await page.getByLabel('Year').fill('2030');
  await page.getByLabel('CVC').fill('123');
  await page.getByRole('button', { name: /pay/i }).click();
  await page.waitForURL(new RegExp(`/orders/${guestOrderId}$`), { timeout: 60_000 });
  await page.waitForTimeout(1500);
  must(/confirmed/i.test(await page.locator('body').innerText()), 'the guest order is not shown confirmed');
  await ctx.close();

  const order = await api(tokenAdminA, 'GET', `/orders/${guestOrderId}`);
  must(order.status === 200 && order.json.status === 'confirmed', `engine holds status ${order.json.status}`);
  must(order.json.guestEmail === GUEST_EMAIL, `engine holds guest email ${order.json.guestEmail}`);
  must(String(order.json.userId).startsWith('guest:'), `owner is ${order.json.userId}`);
});

await journey('a stranger in a fresh browser finds that order with its number and email', async () => {
  const ctx = await freshContext();
  const page = await ctx.newPage();
  await page.goto(`${SHOP_A}/orders`);
  await page.getByLabel('Order number').fill(guestOrderId);
  await page.getByLabel('Email').fill(GUEST_EMAIL);
  await page.getByRole('button', { name: /find order/i }).click();
  await page.waitForURL(new RegExp(`/orders/${guestOrderId}`), { timeout: 30_000 });
  await page.waitForTimeout(1500);
  must(/confirmed/i.test(await page.locator('body').innerText()), 'the lookup did not show the order');
  await page.goto(`${SHOP_A}/orders/${guestOrderId}?email=${encodeURIComponent('someone-else@example.com')}`);
  await page.waitForTimeout(1500);
  must(!/confirmed/i.test(await page.locator('body').innerText()), 'a wrong email still showed the order');
  await ctx.close();
});

await journey('a stranger who then signs in keeps the cart they built', async () => {
  const ctx = await freshContext();
  const page = await ctx.newPage();
  await page.goto(`${SHOP_A}/products/${openMug.id}`);
  await page.getByRole('button', { name: /add to cart/i }).click();
  await page.getByText(/added to cart/i).waitFor({ timeout: 15_000 });

  await page.goto(`${SHOP_A}/login?next=%2Fcart`);
  await page.getByLabel('Username').fill(A_BUYER);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/cart/, { timeout: 30_000 });
  await page.waitForTimeout(2000);
  must((await page.getByText(openMug.name).count()) > 0, 'the cart emptied on sign-in');
  // The ticket is deliberately KEPT. It used to be spent here, and that was
  // the guest lockout: a guest's principal *is* their ticket, paying requires
  // that principal, and the brightest button above the fold -- present on the
  // pay page -- destroyed it. An unpaid order then had no route that could pay
  // it and no route the shopper could cancel it by, with its stock reserved.
  const ticket = await page.evaluate((t) => localStorage.getItem(`marketplace.guest.${t}`), A);
  must(ticket !== null, 'the guest ticket was spent on sign-in');
  // And keeping it leaks nothing: the merge empties the guest cart on the
  // engine, so the next stranger in this browser inherits an empty one.
  const guestCart = await fetch(`${ENGINE}/shops/${A}/cart`, { headers: { 'x-guest': ticket } });
  const guestBody = await guestCart.json();
  must(guestBody.lines.length === 0, `the guest cart still holds ${guestBody.lines.length} lines`);
  await ctx.close();
  // Leave the buyer's cart as it was for the journeys that follow.
  const own = await api(tokenBuyerA, 'GET', '/cart');
  for (const line of own.json.lines) {
    if (line.productId === openMug.id) await api(tokenBuyerA, 'PUT', `/cart/lines/${openMug.id}`, { qty: 0 });
  }
});

await journey('the public API answers without a token and hides the draft', async () => {
  const list = await fetch(`${ENGINE}/shops/${A}/products?limit=100`);
  must(list.status === 200, `public list answered ${list.status}`);
  const names = (await list.json()).items.map((p) => p.name);
  must(names.includes(openMug.name) && !names.includes(hiddenDraft.name), 'public list is wrong');
  const draft = await fetch(`${ENGINE}/shops/${A}/products/${hiddenDraft.id}`);
  must(draft.status === 404, `public draft read answered ${draft.status}`);
  const nope = await fetch(`${ENGINE}/shops/${A}/storefront/draft`);
  must(nope.status === 404, `storefront draft is public: ${nope.status}`);
});

await strangerCtx.close();

// ==================================================== 9. cart and payment
section('The server-side cart and the payment gate');

let gateProduct;
await journey("a buyer's cart survives a full reload", async () => {
  gateProduct = await createProduct({ price: '6.00', stock: '6' });
  await shopper.goto(`${WEB}/products/${gateProduct.id}`);
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.waitForTimeout(800);
  await shopper.reload();
  await shopper.goto(`${WEB}/cart`);
  await shopper.waitForTimeout(1500);
  must(
    (await shopper.locator('body').innerText()).includes(gateProduct.name),
    'the cart forgot its line on reload',
  );
  const held = await api(tokenBuyerA, 'GET', '/cart');
  must(
    held.json.lines.some((l) => l.productId === gateProduct.id),
    'the engine does not hold the line',
  );
});

let gateOrder;
await journey('a declined card leaves the order awaiting payment, a retry completes it', async () => {
  await shopper.getByLabel('Full name').fill('Priya Deshpande');
  await shopper.getByLabel('Phone').fill('+91 98765 43210');
  await shopper.getByLabel('Address').fill('42 Harbour Road');
  await shopper.getByLabel('City').fill('Bristol');
  await shopper.getByLabel('PIN code').fill('411004');
  await shopper.getByRole('button', { name: 'Checkout' }).click();
  await shopper.waitForURL(/\/orders\/[0-9A-Z]{26}\/pay/, { timeout: 60_000 });
  gateOrder = shopper.url().split('/').slice(-2)[0];

  await payOnPayPage(shopper, '4000 0000 0000 0002');
  await shopper.waitForTimeout(1500);
  must(
    (await shopper.locator('body').innerText()).includes('Card declined'),
    'the decline did not render',
  );
  const unpaid = await api(tokenBuyerA, 'GET', `/orders/${gateOrder}`);
  must(unpaid.json.status === 'awaiting_payment', `order is ${unpaid.json.status}`);

  await payOnPayPage(shopper);
  await shopper.waitForURL(new RegExp(`/orders/${gateOrder}$`), { timeout: 60_000 });
  const paid = await api(tokenBuyerA, 'GET', `/orders/${gateOrder}`);
  must(paid.json.status === 'confirmed', `order is ${paid.json.status}`);
  must(paid.json.payment?.last4 === '4242', 'the payment record is missing');
  must(paid.json.currentStageId === paid.json.stages[0].id, 'the order is not in stage 1');
});

await journey('the seller cannot advance an order stuck in the payment gate', async () => {
  await shopper.goto(`${WEB}/products/${gateProduct.id}`);
  await shopper.getByRole('button', { name: 'Add to cart' }).click();
  await shopper.waitForTimeout(600);
  await shopper.goto(`${WEB}/cart`);
  await shopper.getByLabel('Full name').fill('Priya Deshpande');
  await shopper.getByLabel('Phone').fill('+91 98765 43210');
  await shopper.getByLabel('Address').fill('42 Harbour Road');
  await shopper.getByLabel('City').fill('Bristol');
  await shopper.getByLabel('PIN code').fill('411004');
  await shopper.getByRole('button', { name: 'Checkout' }).click();
  await shopper.waitForURL(/\/orders\/[0-9A-Z]{26}\/pay/, { timeout: 60_000 });
  const unpaidOrder = shopper.url().split('/').slice(-2)[0];

  await seller.goto(`${WEB}/admin/orders/${unpaidOrder}`);
  await seller.waitForTimeout(2000);
  const body = await seller.locator('body').innerText();
  must(/awaiting payment/i.test(body), 'the cockpit does not say awaiting payment');
  must(
    (await seller.getByRole('button', { name: /Advance to/ }).count()) === 0,
    'an advance button rendered for an unpaid order',
  );
  const got = await api(tokenBuyerA, 'GET', `/orders/${unpaidOrder}`);
  const refused = await api(tokenAdminA, 'POST', `/orders/${unpaidOrder}/advance`, {
    currentStageId: got.json.stages[0].id,
  });
  must(refused.status === 409, `advance answered ${refused.status}`);

  // Abandoning it from the buyer's tracker restores the stock it reserved.
  const before = await api(tokenAdminA, 'GET', `/products/${gateProduct.id}`);
  await shopper.goto(`${WEB}/orders/${unpaidOrder}`);
  await shopper.getByRole('button', { name: 'Cancel order' }).click();
  await shopper.getByRole('button', { name: 'Cancel order', exact: true }).last().click();
  await shopper.waitForTimeout(1800);
  const after = await api(tokenAdminA, 'GET', `/products/${gateProduct.id}`);
  must(
    after.json.stock === before.json.stock + 1,
    `stock went ${before.json.stock} -> ${after.json.stock}, expected +1`,
  );
});

// ==================================================== 10. the shop's agents
section('Copywriting and order support');

await journey('the seller drafts a description with the model and edits it like their own', async () => {
  await seller.goto(`${WEB}/admin/products/new`);
  await seller.getByLabel('Name').fill('Juniper Incense Bundle');
  await seller.getByLabel('Category').fill('home fragrance');
  await seller.getByTestId('draft-description').click();
  // A local model writes a few sentences; give it room.
  await seller.waitForFunction(
    () => {
      const el = document.querySelector('#description');
      return ((el && el.value) || '').trim().length > 20;
    },
    null,
    { timeout: 180_000 },
  );
  const drafted = await seller.locator('#description').inputValue();
  must(drafted.length <= 5000, 'the draft exceeded the product contract cap');
});

await journey("the support agent answers from the buyer's own orders", async () => {
  await shopper.goto(`${WEB}/orders`);
  await shopper.getByTestId('support-question').fill('What is the status of my most recent order?');
  await shopper.getByTestId('support-ask').click();
  await shopper.getByTestId('support-answer').waitFor({ timeout: 180_000 });
  const answer = await shopper.getByTestId('support-answer').innerText();
  must(answer.trim().length > 10, 'the answer is empty');

  // Grounding, not hallucination: the buyer really has orders, so the answer
  // must engage with at least one of them by reference or by status word.
  const orders = await api(tokenBuyerA, 'GET', '/orders?limit=25');
  const refs = orders.json.items.map((o) => o.id.slice(-6));
  must(
    refs.some((ref) => answer.includes(ref)) || /paid|packing|stage|awaiting|cancelled/i.test(answer),
    `the answer names no order and no status: ${answer.slice(0, 120)}`,
  );
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
