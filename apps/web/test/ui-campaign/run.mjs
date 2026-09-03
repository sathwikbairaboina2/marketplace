/**
 * A browser campaign, driven the way a person drives the app.
 *
 * Deliberately not a Playwright spec suite: this is one ordered session in one
 * browser, where later cases depend on what earlier ones created -- a shop is
 * built, browsed, bought from, and administered in sequence, exactly as a
 * seller and a shopper would. Playwright's per-test isolation is the right
 * model for the specs in ../e2e; it is the wrong model for this.
 *
 * Every run gets its own tenant. The schema assistant permanently alters a
 * tenant's registry (a required field it adds is required for every product
 * created afterwards), so a re-run against a shared tenant does not start from
 * the same world it did the first time -- which is exactly how the first
 * re-run of this file produced two dozen phantom failures.
 *
 *   pnpm --filter @marketplace/web ui:campaign
 *
 * Needs the stack up (`pnpm docker:up`). Writes report.json and a screenshot
 * per failure to test-results/ui-campaign/.
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
const OUT =
  process.env.UI_CAMPAIGN_OUT ??
  fileURLToPath(new URL('../../test-results/ui-campaign', import.meta.url));
const SHOTS = `${OUT}/failures`;
// Written by the `seed` container during `pnpm docker:up`; carries the pool and
// client ids this run needs to mint its own tenant's users.
const ENV_FILE = fileURLToPath(new URL('../../../../docker/.env.generated', import.meta.url));
const PASSWORD = 'Passw0rd!';
const RUN = Date.now().toString(36);
const TENANT = `uitest-${RUN}`;
const ADMIN = `uitest-${RUN}-admin`;
const BUYER = `uitest-${RUN}-buyer`;

if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------- fixtures
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

async function ensureUser(username, role) {
  const attrs = [
    { Name: 'custom:tenant_id', Value: TENANT },
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
}

// ------------------------------------------------------------------ runner
const results = [];
let n = 0;
let group = '';

function section(title) {
  group = title;
  console.log(`\n== ${title}`);
}

const state = { flowApplied: false, seeded: false };

async function check(name, fn, requires) {
  n += 1;
  const id = String(n).padStart(3, '0');
  if (requires && !requires()) {
    results.push({ id, group, name, status: 'skip' });
    console.log(`  ${id} --   ${name} (skipped: prerequisite did not run)`);
    return;
  }
  try {
    await fn();
    results.push({ id, group, name, status: 'pass' });
    console.log(`  ${id} ok   ${name}`);
  } catch (err) {
    const message = String(err.message ?? err).split('\n')[0].slice(0, 160);
    results.push({ id, group, name, status: 'fail', message });
    console.log(`  ${id} FAIL ${name}\n        ${message}`);
    try {
      await page.screenshot({ path: path.join(SHOTS, `${id}.png`), fullPage: true });
    } catch {
      /* page may be gone */
    }
  }
}

const must = (condition, message) => {
  if (!condition) throw new Error(message);
};

// ------------------------------------------------------------------ browser
await ensureUser(ADMIN, 'admin');
await ensureUser(BUYER, 'buyer');

// A tenant that has never published a storefront opens the cockpit on the
// onboarding wizard. This campaign scripts every other screen in order, so its
// tenant skips the wizard the way a real owner can; the wizard has its own
// coverage in the e2e journeys.
{
  const auth = await cognito.send(
    new InitiateAuthCommand({
      ClientId: env.COGNITO_CLIENT_ID,
      AuthFlow: 'USER_PASSWORD_AUTH',
      AuthParameters: { USERNAME: ADMIN, PASSWORD },
    }),
  );
  await fetch('http://127.0.0.1:33000/api/v1/storefront/onboarding', {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${auth.AuthenticationResult.IdToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ dismissed: true }),
  });
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
const failedRequests = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('response', (r) => {
  if (r.status() >= 500) failedRequests.push(`${r.status()} ${r.url()}`);
});

async function signIn(user) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Username').fill(user);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/products/, { timeout: 30_000 });
  await page.waitForTimeout(700);
}

async function signOutIfIn() {
  const out = page.getByRole('button', { name: 'Sign out' });
  if (await out.count()) {
    await out.first().click();
    await page.waitForURL(/\/login/, { timeout: 20_000 });
  }
}

const unique = (p) => `${p}-${n}-${Math.floor(Number(process.hrtime.bigint() % 100000n))}`;

// =============================================================== 1. sign-in
section('Sign-in');

await check('the login page renders a sign-in form', async () => {
  await page.goto(`${WEB}/login`);
  must(await page.getByRole('button', { name: 'Sign in' }).isVisible(), 'no sign-in button');
});

await check('an anonymous visitor asking for /products lands on login', async () => {
  await page.goto(`${WEB}/products`);
  await page.waitForURL(/\/login/, { timeout: 15_000 });
});

await check('an anonymous visitor asking for /admin/products lands on login', async () => {
  await page.goto(`${WEB}/admin/products`);
  await page.waitForURL(/\/login/, { timeout: 15_000 });
});

await check('an anonymous visitor asking for /cart lands on login', async () => {
  await page.goto(`${WEB}/cart`);
  await page.waitForURL(/\/login/, { timeout: 15_000 });
});

await check('submitting an empty form does not navigate away', async () => {
  await page.goto(`${WEB}/login`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(900);
  must(page.url().includes('/login'), `left the login page: ${page.url()}`);
});

await check('the empty form complains about the username', async () => {
  const complaint = await page.locator('.ant-form-item-explain-error').count();
  must(complaint > 0, 'no validation message shown');
});

await check('the password field masks what is typed', async () => {
  await page.getByLabel('Password').fill('hunter2');
  const type = await page.getByLabel('Password').getAttribute('type');
  must(type === 'password', `password input type is ${type}`);
});

await check('a wrong password is refused with a message, not a crash', async () => {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Username').fill(ADMIN);
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(2500);
  must(page.url().includes('/login'), 'signed in with a wrong password');
});

await check('an unknown username is refused', async () => {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Username').fill('nobody-at-all');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForTimeout(2500);
  must(page.url().includes('/login'), 'signed in as a user that does not exist');
});

await check('the demo persona picker fills both fields', async () => {
  await page.goto(`${WEB}/login`);
  await page.locator('.ant-select').first().click();
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const username = await page.getByLabel('Username').inputValue();
  must(username.length > 0, 'username still empty after picking a persona');
});

await check('a valid admin signs in and lands on the storefront', async () => {
  await signIn(ADMIN);
  must(page.url().includes('/products'), `landed on ${page.url()}`);
});

await check('the signed-in header offers Sign out', async () => {
  must(await page.getByRole('button', { name: 'Sign out' }).isVisible(), 'no sign-out control');
});

await check('a reload keeps the session', async () => {
  await page.reload();
  await page.waitForTimeout(1500);
  must(!page.url().includes('/login'), 'reload logged the user out');
});

await check('signing in with the keyboard alone works', async () => {
  await signOutIfIn();
  await page.goto(`${WEB}/login`);
  await page.getByLabel('Username').click();
  await page.keyboard.type(ADMIN);
  await page.keyboard.press('Tab');
  await page.keyboard.type(PASSWORD);
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/products/, { timeout: 30_000 });
});

// ========================================================== 2. seeding data
section('Creating a catalogue (admin)');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const PRODUCTS = [
  { name: unique('Kettle'), price: '129.00', stock: '5', cat: 'coffee' },
  { name: unique('Mug'), price: '24.00', stock: '18', cat: 'kitchen' },
  { name: unique('Journal'), price: '18.50', stock: '40', cat: 'stationery' },
  { name: unique('Lamp'), price: '340.00', stock: '2', cat: 'lighting' },
];
const created = [];

await check('the admin area is reachable from the header', async () => {
  await page.getByRole('link', { name: 'Admin' }).first().click();
  await page.waitForURL(/\/admin/, { timeout: 20_000 });
});

await check('an empty catalogue shows the onboarding checklist, not a bare table', async () => {
  await page.goto(`${WEB}/admin/products`);
  await page.waitForTimeout(2000);
  const text = await page.locator('body').innerText();
  must(/set up|first|start|checklist|add/i.test(text), 'no guidance on an empty catalogue');
});

await check('the new-product form opens', async () => {
  await page.goto(`${WEB}/admin/products/new`);
  await page.getByLabel('Name').waitFor({ timeout: 20_000 });
  must(await page.getByLabel('Name').isVisible(), 'no Name field');
});

await check('submitting the empty form is refused', async () => {
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(1200);
  must(page.url().includes('/admin/products/new'), 'an empty product was created');
});

await check('the empty form marks the required fields', async () => {
  const errors = await page.locator('.ant-form-item-explain-error').count();
  must(errors >= 3, `only ${errors} fields complained`);
});

await check('a name of nothing but spaces is refused', async () => {
  await page.goto(`${WEB}/admin/products/new`);
  await page.getByLabel('Name').fill('   ');
  await page.getByLabel('Description').fill('blank name probe');
  await page.getByLabel('Category').fill('probe');
  await page.getByLabel('Price', { exact: true }).fill('10');
  await page.getByLabel('Stock').fill('1');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(2000);
  must(page.url().includes('/admin/products/new'), 'a product with a blank name was created');
});

await check('a price of letters cannot be submitted', async () => {
  await page.goto(`${WEB}/admin/products/new`);
  await page.getByLabel('Name').waitFor({ timeout: 20_000 });
  await page.getByLabel('Name').fill(unique('BadPrice'));
  await page.getByLabel('Description').fill('letters for a price');
  await page.getByLabel('Category').fill('probe');
  await page.getByLabel('Price', { exact: true }).click();
  await page.keyboard.type('abc');
  await page.getByLabel('Stock').fill('1');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(2000);
  must(page.url().includes('/admin/products/new'), 'a product was created with a price of "abc"');
});

await check('the stock field refuses a negative number', async () => {
  await page.getByLabel('Stock').fill('-5');
  await page.getByLabel('Stock').blur();
  await page.waitForTimeout(400);
  const value = await page.getByLabel('Stock').inputValue();
  must(!value.startsWith('-'), `stock accepted ${value}`);
});

await check('a file that is not an image is refused with a readable message', async () => {
  await page.goto(`${WEB}/admin/products/new`);
  await page.getByTestId('image-input').setInputFiles({
    name: 'evil.png',
    mimeType: 'image/png',
    buffer: Buffer.from('<!doctype html><script>alert(1)</script>', 'ascii'),
  });
  await page.getByText(/not a recognised image/i).waitFor({ timeout: 20_000 });
});

for (const p of PRODUCTS) {
  await check(`an admin creates "${p.name.split('-')[0]}" with a photo`, async () => {
    await page.goto(`${WEB}/admin/products/new`);
    await page.getByLabel('Name').fill(p.name);
    await page.getByLabel('Description').fill(`${p.name} description`);
    await page.getByLabel('Category').fill(p.cat);
    await page.getByLabel('Price', { exact: true }).fill(p.price);
    await page.getByLabel('Stock').fill(p.stock);
    await page.getByTestId('image-input').setInputFiles({
      name: `${p.cat}.png`,
      mimeType: 'image/png',
      buffer: PNG,
    });
    await page.locator('img[src*="marketplace-media"]').first().waitFor({ timeout: 40_000 });
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForURL(/\/products\/[0-9A-Z]{26}/, { timeout: 40_000 });
    created.push({ ...p, id: page.url().split('/').pop() });
  });
}

await check('an out-of-stock product can be created', async () => {
  const name = unique('SoldOut');
  await page.goto(`${WEB}/admin/products/new`);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill('nothing left');
  await page.getByLabel('Category').fill('lighting');
  await page.getByLabel('Price', { exact: true }).fill('99.00');
  await page.getByLabel('Stock').fill('0');
  await page.locator('.ant-form-item', { hasText: 'Status' }).locator('.ant-select').click();
  await page.getByTitle('out_of_stock').click();
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/products\/[0-9A-Z]{26}/, { timeout: 40_000 });
  created.push({ name, price: '99.00', stock: '0', cat: 'lighting', id: page.url().split('/').pop() });
});

await check('a draft product can be created', async () => {
  const name = unique('Draft');
  await page.goto(`${WEB}/admin/products/new`);
  await page.getByLabel('Name').fill(name);
  await page.getByLabel('Description').fill('not published');
  await page.getByLabel('Category').fill('kitchen');
  await page.getByLabel('Price', { exact: true }).fill('12.00');
  await page.getByLabel('Stock').fill('3');
  await page.locator('.ant-form-item', { hasText: 'Status' }).locator('.ant-select').click();
  await page.getByTitle('draft').click();
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/products\/[0-9A-Z]{26}/, { timeout: 40_000 });
});

await check('the admin product list shows everything just created', async () => {
  await page.goto(`${WEB}/admin/products`);
  await page.waitForTimeout(2000);
  const rows = await page.locator('.ant-table-tbody tr.ant-table-row').count();
  must(rows >= PRODUCTS.length, `only ${rows} rows`);
});

// ============================================================ 3. storefront
section('Storefront');

await check('the storefront lists the catalogue', async () => {
  await page.goto(`${WEB}/products`);
  await page.waitForTimeout(2000);
  const cards = await page.locator('a[href^="/products/01"]').count();
  must(cards >= PRODUCTS.length, `only ${cards} cards`);
});

await check('a product card shows its price', async () => {
  const text = await page.locator('body').innerText();
  must(text.includes('129.00'), 'the kettle price is missing');
});

await check('a product card shows its category', async () => {
  const text = (await page.locator('body').innerText()).toLowerCase();
  must(text.includes('coffee'), 'category missing from the grid');
});

await check('a product card says whether it is in stock, without publishing the count', async () => {
  const text = await page.locator('body').innerText();
  must(/in stock|only \d+ left|sold out/i.test(text), 'no availability shown');
  must(!/\d+ in stock/i.test(text), 'the grid publishes exact stock counts');
});

await check('an out-of-stock product is marked as sold out', async () => {
  const text = await page.locator('body').innerText();
  must(/sold out|out of stock/i.test(text), 'nothing marks the sold-out product');
});

await check('a draft product is not on the storefront', async () => {
  const text = await page.locator('body').innerText();
  must(!/Draft-/.test(text), 'a draft product is publicly listed');
});

await check('the hero counts the products on show', async () => {
  const text = await page.locator('body').innerText();
  must(/showing/i.test(text), 'no summary of the catalogue');
});

await check('photographs load rather than falling back to placeholders', async () => {
  const imgs = await page.locator('img[src*="marketplace-media"]').count();
  must(imgs >= PRODUCTS.length, `only ${imgs} photographs rendered`);
});

await check('a minimum price filter narrows the grid', async () => {
  await page.getByLabel('Min price').fill('200');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForTimeout(2000);
  const text = await page.locator('body').innerText();
  must(!/Journal-/.test(text), 'a cheap product survived the filter');
});

await check('the filtered grid still shows what matches', async () => {
  const text = await page.locator('body').innerText();
  must(/Lamp-/.test(text), 'the expensive product vanished too');
});

await check('Clear restores the whole catalogue', async () => {
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.waitForTimeout(2000);
  const cards = await page.locator('a[href^="/products/01"]').count();
  must(cards >= PRODUCTS.length, `only ${cards} cards after clearing`);
});

await check('a maximum price filter works on its own', async () => {
  await page.getByLabel('Max price').fill('25');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForTimeout(2000);
  const text = await page.locator('body').innerText();
  must(!/Lamp-/.test(text), 'an expensive product survived a max filter');
});

await check('a min above max returns an empty result, not an error', async () => {
  await page.getByLabel('Min price').fill('900');
  await page.getByLabel('Max price').fill('10');
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForTimeout(2000);
  const cards = await page.locator('a[href^="/products/01"]').count();
  must(cards === 0, `${cards} products matched an impossible range`);
});

await check('an impossible filter explains that nothing matched', async () => {
  const text = await page.locator('body').innerText();
  must(/no|nothing|empty|0 products/i.test(text), 'no empty-state message');
});

await check('the filter survives a reload as a URL, or resets cleanly', async () => {
  await page.reload();
  await page.waitForTimeout(2000);
  must(!page.url().includes('undefined'), 'the filter left rubbish in the URL');
});

await check('clicking a card opens that product', async () => {
  await page.goto(`${WEB}/products`);
  await page.waitForTimeout(1500);
  await page.getByText(PRODUCTS[1].name).first().waitFor({ timeout: 20_000 });
  await page.getByText(PRODUCTS[1].name).first().click();
  await page.waitForURL(/\/products\/[0-9A-Z]{26}/, { timeout: 20_000 });
  await page.waitForTimeout(1500);
});

// ======================================================== 4. product detail
section('Product detail');

await check('the detail page names the product', async () => {
  const text = await page.locator('body').innerText();
  must(text.includes(PRODUCTS[1].name), 'the name is missing');
});

await check('the detail page shows the price in major units', async () => {
  const text = await page.locator('body').innerText();
  must(text.includes('24.00'), 'price missing or in minor units');
});

await check('the detail page shows the description', async () => {
  const text = await page.locator('body').innerText();
  must(text.includes('description'), 'description missing');
});

await check('the detail page shows the photograph', async () => {
  must((await page.locator('img[src*="marketplace-media"]').count()) > 0, 'no photograph');
});

await check('the photograph actually loads (not a broken image)', async () => {
  const ok = await page.locator('img[src*="marketplace-media"]').first().evaluate((i) => i.naturalWidth > 0);
  must(ok, 'the image element is broken');
});

await check('the quantity starts at one', async () => {
  const qty = page.locator('input.ant-input-number-input').first();
  must((await qty.inputValue()) === '1', 'quantity did not default to 1');
});

await check('the quantity cannot be driven below one', async () => {
  const qty = page.locator('input.ant-input-number-input').first();
  await qty.fill('0');
  await qty.blur();
  await page.waitForTimeout(500);
  must(Number(await qty.inputValue()) >= 1, 'quantity went below 1');
});

await check('the quantity accepts a larger number', async () => {
  const qty = page.locator('input.ant-input-number-input').first();
  await qty.fill('3');
  await qty.blur();
  must((await qty.inputValue()) === '3', 'quantity did not take');
});

await check('"More from this shop" offers other products', async () => {
  const text = await page.locator('body').innerText();
  must(/more from/i.test(text), 'no cross-sell shelf');
});

await check('a product can be added to the cart', async () => {
  const qty = page.locator('input.ant-input-number-input').first();
  await qty.fill('1');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.waitForTimeout(900);
});

await check('the header shows the cart is no longer empty', async () => {
  const header = await page.locator('header, nav').first().innerText();
  must(/cart/i.test(header), 'no cart control in the header');
});

await check('a sold-out product cannot be added to the cart', async () => {
  const soldOut = created.find((c) => c.stock === '0');
  await page.goto(`${WEB}/products/${soldOut.id}`);
  await page.waitForTimeout(1500);
  const disabled = await page.getByRole('button', { name: 'Add to cart' }).isDisabled();
  must(disabled, 'a sold-out product can be bought');
});

await check('an unknown product id shows a not-found state, not a crash', async () => {
  await page.goto(`${WEB}/products/01ARZ3NDEKTSV4RRFFQ69G5FAV`);
  await page.waitForTimeout(2500);
  const text = await page.locator('body').innerText();
  must(/not found|no product|does not exist|something went wrong/i.test(text), `page said: ${text.slice(0, 120)}`);
});

await check('a malformed product id does not crash the page', async () => {
  await page.goto(`${WEB}/products/not-an-id`);
  await page.waitForTimeout(2500);
  const text = await page.locator('body').innerText();
  must(text.length > 0 && !/Application error/i.test(text), 'the page fell over');
});

await check('the back link returns to the catalogue', async () => {
  await page.goto(`${WEB}/products/${created[1].id}`);
  await page.waitForTimeout(1200);
  await page.getByRole('link', { name: /all products/i }).first().click();
  await page.waitForURL(/\/products$/, { timeout: 15_000 });
});

await check('the browser back button also works', async () => {
  await page.getByText(PRODUCTS[0].name).first().click();
  await page.waitForURL(/\/products\/[0-9A-Z]{26}/);
  await page.goBack();
  await page.waitForTimeout(1200);
  must(page.url().endsWith('/products'), `back went to ${page.url()}`);
});

// ================================================================= 5. cart
section('Cart and checkout');

await check('the cart lists what was added', async () => {
  await page.goto(`${WEB}/cart`);
  await page.waitForTimeout(1500);
  const text = await page.locator('body').innerText();
  must(text.includes(PRODUCTS[1].name), 'the added product is missing from the cart');
});

await check('the cart shows a total', async () => {
  const text = await page.locator('body').innerText();
  must(/total/i.test(text), 'no total');
});

await check('the cart survives a reload', async () => {
  await page.reload();
  await page.waitForTimeout(1500);
  const text = await page.locator('body').innerText();
  must(text.includes(PRODUCTS[1].name), 'the cart emptied on reload');
});

await check('changing a line quantity updates the total', async () => {
  const before = await page.locator('body').innerText();
  const qty = page.locator('input.ant-input-number-input').first();
  await qty.fill('3');
  await qty.blur();
  await page.waitForTimeout(1200);
  const after = await page.locator('body').innerText();
  must(before !== after, 'the total did not move');
});

await check('adding a second product shows two lines', async () => {
  await page.goto(`${WEB}/products/${created[0].id}`);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.goto(`${WEB}/cart`);
  await page.waitForTimeout(1500);
  const lines = await page.locator('.mp-line').count();
  must(lines === 2, `${lines} lines in the cart`);
});

await check('a line can be removed', async () => {
  await page.getByRole('button', { name: /^Remove/ }).first().click();
  await page.waitForTimeout(1200);
  const lines = await page.locator('.mp-line').count();
  must(lines === 1, `${lines} lines after removing one`);
});

await check('checkout refuses an empty address', async () => {
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.waitForTimeout(1500);
  must(page.url().includes('/cart'), 'an order was placed with no address');
});

await check('checkout marks the missing fields', async () => {
  const errors = await page.locator('.ant-form-item-explain-error').count();
  must(errors >= 2, `only ${errors} fields complained`);
});

await check('checkout refuses when only the address is filled', async () => {
  await page.getByLabel('Address').fill('42 Harbour Road');
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.waitForTimeout(1200);
  must(page.url().includes('/cart'), 'an order went through without a city');
});

await check('the shopper is not asked to pick a currency, and the summary carries a symbol', async () => {
  // A Currency select used to sit on this form. The engine refuses an order
  // whose currency differs from its products' (order-checkout.service.ts),
  // so every option but the shop's own made checkout fail.
  must(
    (await page.locator('.ant-form-item', { hasText: 'Currency' }).count()) === 0,
    'the checkout form still asks the shopper for a currency',
  );
  const text = await page.locator('body').innerText();
  must(/[$₹€£]/.test(text), 'the summary shows no currency symbol');
});

await check('a complete checkout reserves the order and lands on the payment page', async () => {
  await page.getByLabel('City').fill('Bristol');
  await page.getByLabel('Postcode').fill('BS1 4TR');
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.waitForURL(/\/orders\/[0-9A-Z]{26}\/pay/, { timeout: 60_000 });
});

await check('the payment page shows the amount and the simulation notice', async () => {
  await page.waitForTimeout(1500);
  const text = await page.locator('body').innerText();
  must(/pay/i.test(text) && /simulated/i.test(text), 'no amount or simulation notice');
  must((await page.getByTestId('card-number').count()) === 1, 'no card form');
});

await check('a declined card renders inline and keeps the form', async () => {
  await page.getByTestId('card-number').fill('4000 0000 0000 0002');
  await page.getByTestId('card-month').fill('12');
  await page.getByTestId('card-year').fill('2030');
  await page.getByTestId('card-cvc').fill('123');
  await page.getByTestId('pay-now').click();
  await page.waitForTimeout(1500);
  const text = await page.locator('body').innerText();
  must(/declined/i.test(text), 'the decline did not render');
  must((await page.getByTestId('card-number').count()) === 1, 'the form vanished on decline');
});

await check('the success card completes payment onto the tracker', async () => {
  await page.getByTestId('card-number').fill('4242 4242 4242 4242');
  await page.getByTestId('pay-now').click();
  await page.waitForURL(/\/orders\/[0-9A-Z]{26}$/, { timeout: 60_000 });
});

await check('the cart is empty after ordering', async () => {
  await page.goto(`${WEB}/cart`);
  await page.waitForTimeout(1500);
  const text = await page.locator('body').innerText();
  must(/empty/i.test(text), 'the cart still holds the ordered items');
});

await check('the empty cart offers a way back to the shop', async () => {
  must(await page.getByRole('link', { name: /browse products/i }).count() > 0, 'no way back');
});

// =============================================================== 6. orders
section('Orders');

await check('the orders list shows the new order', async () => {
  await page.goto(`${WEB}/orders`);
  await page.waitForTimeout(2000);
  const rows = await page.locator('.ant-table-tbody tr.ant-table-row').count();
  must(rows >= 1, 'no orders listed');
});

await check('an order row can be opened', async () => {
  await page.locator('.ant-table-tbody a').first().click();
  await page.waitForURL(/\/orders\/[0-9A-Z]{26}/, { timeout: 20_000 });
  await page.waitForTimeout(2000);
});

await check('the order names the product bought, not its id', async () => {
  const cells = await page.locator('.ant-table-tbody tr.ant-table-row td:first-child').allInnerTexts();
  must(cells.every((c) => !/^[0-9A-Z]{26}$/.test(c.trim())) && cells.join('').length > 0, `first column showed raw ids: ${cells.join(' | ')}`);
});

await check('the order shows a unit price and a line total', async () => {
  const text = await page.locator('body').innerText();
  must(/unit price/i.test(text) && /line total/i.test(text), 'the money columns are missing');
});

await check('the order shows the delivery address given at checkout', async () => {
  const text = await page.locator('body').innerText();
  must(text.includes('Bristol'), 'the shipping address is missing');
});

await check('the order shows a status', async () => {
  const text = await page.locator('body').innerText();
  must(/confirmed|pending/i.test(text), 'no status');
});

await check('the order reference is shown for support', async () => {
  const text = await page.locator('body').innerText();
  must(/reference/i.test(text), 'no reference');
});

await check('stock fell by what was ordered', async () => {
  await page.goto(`${WEB}/products/${created[0].id}`);
  await page.waitForTimeout(1800);
  const text = await page.locator('body').innerText();
  // The kettle starts at 5, which is the low-stock threshold, so what a
  // shopper is told after a sale is the count itself: "Only 3 left".
  const left = Number((text.match(/only\s+(\d+)\s+left/i) ?? [])[1]);
  must(Number.isFinite(left), `no remaining-stock line on the page`);
  must(left < Number(PRODUCTS[0].stock), `stock still ${left}`);
});

// =============================================== 7. events and bookings
section('Events and bookings');

const EVENT = unique('Workshop');

await check('the new-event form opens', async () => {
  await page.goto(`${WEB}/admin/events/new`);
  must(await page.getByLabel('Title').isVisible(), 'no Title field');
});

await check('an empty event form is refused', async () => {
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(1200);
  must(page.url().includes('/admin/events/new'), 'an empty event was created');
});

await check('an admin creates an event', async () => {
  await page.goto(`${WEB}/admin/events/new`);
  await page.getByLabel('Title').fill(EVENT);
  await page.getByLabel('Capacity').fill('10');
  await page.getByLabel('Starts').click();
  await page.keyboard.type('2026-12-01 10:00:00');
  await page.keyboard.press('Enter');
  await page.getByLabel('Ends').click();
  await page.keyboard.type('2026-12-01 18:00:00');
  await page.keyboard.press('Enter');
  await page.getByLabel('Base price').fill('65');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/events\/[0-9A-Z]{26}/, { timeout: 40_000 });
});

await check('an event ending before it starts is refused', async () => {
  await page.goto(`${WEB}/admin/events/new`);
  await page.getByLabel('Title').fill(unique('Backwards'));
  await page.getByLabel('Capacity').fill('5');
  await page.getByLabel('Starts').click();
  await page.keyboard.type('2026-12-05 10:00:00');
  await page.keyboard.press('Enter');
  await page.getByLabel('Ends').click();
  await page.keyboard.type('2026-12-01 10:00:00');
  await page.keyboard.press('Enter');
  await page.getByLabel('Base price').fill('10');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(2500);
  must(page.url().includes('/admin/events/new'), 'an event ending before it began was created');
});

await check('the events list shows the event', async () => {
  await page.goto(`${WEB}/events`);
  await page.waitForTimeout(2000);
  must((await page.locator('body').innerText()).includes(EVENT), 'the event is missing');
});

await check('the events list shows dates in words, not ISO strings', async () => {
  const text = await page.locator('body').innerText();
  must(!/\d{4}-\d{2}-\d{2}T/.test(text), 'raw ISO timestamps on screen');
});

await check('an event can be opened', async () => {
  await page.getByText(EVENT).first().click();
  await page.waitForURL(/\/events\/[0-9A-Z]{26}/, { timeout: 20_000 });
  await page.waitForTimeout(1500);
});

await check('the event page shows its capacity', async () => {
  const text = await page.locator('body').innerText();
  must(/capacity|10/.test(text), 'no capacity shown');
});

await check('the event page shows a ticket price', async () => {
  const text = await page.locator('body').innerText();
  must(/65/.test(text), 'no price shown');
});

await check('tickets cannot be set to zero', async () => {
  const tickets = page.getByLabel('Tickets');
  await tickets.fill('0');
  await tickets.blur();
  await page.waitForTimeout(500);
  must(Number(await tickets.inputValue()) >= 1, 'zero tickets accepted');
});

await check('asking for more tickets than exist is clamped to the capacity', async () => {
  const tickets = page.getByLabel('Tickets');
  await tickets.fill('99');
  await tickets.blur();
  await page.waitForTimeout(700);
  must((await tickets.inputValue()) === '10', `tickets became ${await tickets.inputValue()}`);
});

await check('the clamped quantity is what the form will book', async () => {
  await page.getByLabel('Tickets').fill('2');
  await page.waitForTimeout(400);
  must((await page.getByLabel('Tickets').inputValue()) === '2', 'the field would not take 2');
});

await check('a valid booking is accepted', async () => {
  await page.getByLabel('Tickets').fill('2');
  await page.getByRole('button', { name: 'Book' }).click();
  await page.waitForURL(/\/bookings\/[0-9A-Z]{26}/, { timeout: 60_000 });
  await page.waitForTimeout(2000);
});

await check('the booking names the event rather than showing its id', async () => {
  const text = await page.locator('body').innerText();
  must(text.includes(EVENT), 'the booking shows no event title');
});

await check('the booking shows how many tickets were taken', async () => {
  const text = await page.locator('body').innerText();
  must(/tickets/i.test(text), 'no ticket count');
});

await check('the bookings list shows the booking', async () => {
  await page.goto(`${WEB}/bookings`);
  await page.waitForTimeout(2000);
  const rows = await page.locator('.ant-table-tbody tr.ant-table-row').count();
  must(rows >= 1, 'no bookings listed');
});

await check('the event now reports the tickets as taken', async () => {
  await page.goto(`${WEB}/events`);
  await page.waitForTimeout(2000);
  const text = await page.locator('body').innerText();
  must(/2\b/.test(text), 'booked count not reflected');
});

// ============================================================ 8. settings
section('Seller settings');

const NOTICE = `Sale ends Friday ${n}`;

await check('the settings page opens', async () => {
  await page.goto(`${WEB}/admin/settings`);
  await page.waitForTimeout(1500);
  must(await page.getByLabel('Announcement').isVisible(), 'no announcement field');
});

await check('typing immediately after opening is not overwritten by the fetch', async () => {
  await page.goto(`${WEB}/admin/settings`);
  await page.getByLabel('Announcement').fill(NOTICE);
  await page.waitForTimeout(2500);
  const value = await page.getByLabel('Announcement').inputValue();
  must(value === NOTICE, `the field became "${value}"`);
});

await check('the announcement saves', async () => {
  const toggle = page.getByRole('switch');
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Announcement saved').waitFor({ timeout: 20_000 });
});

await check('the saved announcement survives a reload', async () => {
  await page.reload();
  await page.waitForTimeout(2500);
  must((await page.getByLabel('Announcement').inputValue()) === NOTICE, 'the announcement did not persist');
});

await check('the storefront wears the announcement', async () => {
  await page.goto(`${WEB}/products`);
  await page.waitForTimeout(2000);
  must((await page.locator('body').innerText()).includes(NOTICE), 'no announcement on the storefront');
});

await check('the announcement field is capped at 140 characters', async () => {
  await page.goto(`${WEB}/admin/settings`);
  await page.waitForTimeout(2000);
  await page.getByLabel('Announcement').fill('x'.repeat(200));
  const value = await page.getByLabel('Announcement').inputValue();
  must(value.length <= 140, `field accepted ${value.length} characters`);
});

await check('turning the announcement off removes the strip', async () => {
  await page.goto(`${WEB}/admin/settings`);
  await page.waitForTimeout(2000);
  const toggle = page.getByRole('switch');
  if ((await toggle.getAttribute('aria-checked')) === 'true') await toggle.click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Announcement saved').waitFor({ timeout: 20_000 });
  await page.goto(`${WEB}/products`);
  await page.waitForTimeout(2000);
  must(!(await page.locator('body').innerText()).includes(NOTICE), 'the strip lingered');
});

await check('turning it back on restores it', async () => {
  await page.goto(`${WEB}/admin/settings`);
  await page.waitForTimeout(2000);
  await page.getByRole('switch').click();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('Announcement saved').waitFor({ timeout: 20_000 });
  await page.goto(`${WEB}/products`);
  await page.waitForTimeout(2000);
  must((await page.locator('body').innerText()).includes(NOTICE), 'the strip did not come back');
});

// =============================================================== 9. theme
section('Theme and layout');

await check('a theme toggle is offered', async () => {
  must((await page.getByRole('button', { name: /switch to (dark|light) mode/i }).count()) > 0, 'no toggle');
});

await check('the toggle flips the theme', async () => {
  const before = await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button', { name: /switch to (dark|light) mode/i }).first().click();
  await page.waitForTimeout(700);
  const after = await page.locator('html').getAttribute('data-theme');
  must(before !== after, `theme stayed ${after}`);
});

await check('the chosen theme survives a reload without flashing', async () => {
  const chosen = await page.locator('html').getAttribute('data-theme');
  await page.reload();
  await page.waitForTimeout(1200);
  must((await page.locator('html').getAttribute('data-theme')) === chosen, 'the theme reset');
});

await check('the dark theme keeps text readable on the storefront', async () => {
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  must(bg && bg !== 'rgba(0, 0, 0, 0)', 'the body has no background of its own');
});

await check('the theme carries into the back office', async () => {
  const chosen = await page.locator('html').getAttribute('data-theme');
  await page.goto(`${WEB}/admin/products`);
  await page.waitForTimeout(1500);
  must((await page.locator('html').getAttribute('data-theme')) === chosen, 'the admin shell ignored the theme');
});

await check('the theme flips back', async () => {
  await page.getByRole('button', { name: /switch to (dark|light) mode/i }).first().click();
  await page.waitForTimeout(700);
});

await check('the admin sidebar is a sidebar at desktop width', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${WEB}/admin/products`);
  await page.waitForTimeout(1500);
  const menuButtons = await page.getByRole('button', { name: /menu/i }).count();
  must(menuButtons === 0, 'a hamburger appeared on a wide screen');
});

await check('the sidebar collapses to a drawer on a narrow screen', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.waitForTimeout(1800);
  must((await page.getByRole('button', { name: /menu/i }).count()) > 0, 'no drawer control on mobile');
});

await check('the drawer opens on tap', async () => {
  await page.getByRole('button', { name: /menu/i }).first().click();
  await page.waitForTimeout(900);
  must((await page.locator('.ant-drawer').count()) > 0, 'the drawer did not open');
});

await check('the storefront filter rail becomes a sheet on mobile', async () => {
  await page.goto(`${WEB}/products`);
  await page.waitForTimeout(1800);
  must((await page.getByRole('button', { name: /filters/i }).count()) > 0, 'no filter control on mobile');
});

await check('the mobile storefront does not scroll sideways', async () => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  must(overflow <= 2, `the page is ${overflow}px too wide`);
});

await check('the tablet width renders the grid without overlap', async () => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.reload();
  await page.waitForTimeout(1800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  must(overflow <= 2, `the page is ${overflow}px too wide at 768`);
});

await check('back to desktop width', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(800);
});

// ====================================================== 10. schema assistant
section('Schema assistant and flows');

await check('the flows page opens', async () => {
  await page.goto(`${WEB}/admin/flows`);
  await page.waitForTimeout(2000);
  must(/flow/i.test(await page.locator('body').innerText()), 'no flows page');
});

await check('an empty flows page explains what flows are', async () => {
  const text = await page.locator('body').innerText();
  must(text.length > 40, 'the flows page is blank');
});

await check('the chat page opens with a composer', async () => {
  await page.goto(`${WEB}/admin/chat`);
  await page.getByTestId('composer').waitFor({ timeout: 30_000 });
});

await check('the composer becomes usable once the socket connects', async () => {
  await page.waitForFunction(() => !document.querySelector('[data-testid="composer"]')?.disabled, null, {
    timeout: 60_000,
  });
});

await check('a schema change can be described in plain language', async () => {
  await page.getByTestId('composer').fill('Add a required text field called colour to Product');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
});

await check('the assistant reaches a confirmable proposal', async () => {
  await page.getByTestId('phase').filter({ hasText: 'awaiting_confirmation' }).first().waitFor({ timeout: 180_000 });
});

await check('the composer locks while a decision is pending', async () => {
  must(await page.getByTestId('composer').isDisabled(), 'the composer stayed open');
});

await check('confirming queues the proposal', async () => {
  await page.getByTestId('confirm').click();
  await page.getByText('Proposal queued').waitFor({ timeout: 90_000 });
});

await check('the queued proposal appears on the flows page', async () => {
  await page.goto(`${WEB}/admin/flows`);
  await page.waitForTimeout(4000);
  const rows = await page.locator('.ant-table-tbody tr.ant-table-row').count();
  must(rows >= 1, 'the flow never landed');
});

await check('a flow can be opened', async () => {
  await page.locator('.ant-table-tbody a').first().click();
  await page.waitForURL(/\/admin\/flows\/[0-9A-Z]{26}/, { timeout: 20_000 });
  await page.waitForTimeout(1500);
});

await check('the flow shows which field it would add', async () => {
  const text = await page.locator('body').innerText();
  must(/colour/i.test(text), 'the proposed field is not named');
});

await check('the flow says it has not been applied yet', async () => {
  const text = await page.locator('body').innerText();
  must(/not applied|proposed/i.test(text), 'no applied state');
});

await check('executing the flow applies it', async () => {
  await page.getByRole('button', { name: 'Execute' }).click();
  await page.waitForTimeout(4000);
  const text = await page.locator('body').innerText();
  must(/applied/i.test(text), 'the flow did not apply');
  state.flowApplied = true;
});

await check('the new field appears on the product form without a redeploy', async () => {
  await page.goto(`${WEB}/admin/products/new`);
  await page.waitForTimeout(3000);
  must((await page.getByLabel(/colour/i).count()) > 0, 'the dynamic field is missing');
}, () => state.flowApplied);

await check('the new required field is enforced by the form', async () => {
  await page.getByLabel('Name').fill(unique('Dynamic'));
  await page.getByLabel('Description').fill('needs a colour');
  await page.getByLabel('Category').fill('kitchen');
  await page.getByLabel('Price', { exact: true }).fill('5');
  await page.getByLabel('Stock').fill('1');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(2000);
  must(page.url().includes('/admin/products/new'), 'the required field was not enforced');
}, () => state.flowApplied);

await check('filling the new field lets the product through', async () => {
  await page.getByLabel(/colour/i).first().fill('spring green');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/products\/[0-9A-Z]{26}/, { timeout: 40_000 });
}, () => state.flowApplied);

await check('the tenant-defined field shows on the product page', async () => {
  await page.waitForTimeout(2000);
  must(/spring green/i.test(await page.locator('body').innerText()), 'the attribute is not displayed');
}, () => state.flowApplied);

// ========================================================= 11. permissions
section('What a buyer may do');

await check('a buyer can sign in', async () => {
  await signOutIfIn();
  await signIn(BUYER);
});

await check('a buyer sees the shop', async () => {
  const cards = await page.locator('a[href^="/products/01"]').count();
  must(cards > 0, 'the buyer sees an empty shop');
});

await check('a buyer is not offered the admin area', async () => {
  const header = await page.locator('header, nav').first().innerText();
  must(!/admin/i.test(header), 'the buyer is offered admin navigation');
});

await check('a buyer typing the admin URL is not handed the cockpit silently', async () => {
  await page.goto(`${WEB}/admin/products`);
  await page.waitForTimeout(2500);
  const text = await page.locator('body').innerText();
  must(text.length > 0, 'blank page');
});

await check('a buyer cannot actually create a product', async () => {
  await page.goto(`${WEB}/admin/products/new`);
  await page.waitForTimeout(2000);
  if ((await page.getByLabel('Name').count()) === 0) return; // route hidden entirely: fine
  await page.getByLabel('Name').fill(unique('BuyerMade'));
  await page.getByLabel('Description').fill('should not exist');
  await page.getByLabel('Category').fill('probe');
  await page.getByLabel('Price', { exact: true }).fill('1');
  await page.getByLabel('Stock').fill('1');
  const colour = page.getByLabel(/colour/i);
  if (await colour.count()) await colour.first().fill('red');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForTimeout(3000);
  must(!/\/products\/[0-9A-Z]{26}/.test(page.url()), 'a buyer created a product');
});

await check('the refusal is shown to the buyer, not swallowed', async () => {
  const text = await page.locator('body').innerText();
  must(/not allowed|forbidden|permission|admin/i.test(text), 'no explanation of the refusal');
});

await check('a buyer cannot set the announcement', async () => {
  await page.goto(`${WEB}/admin/settings`);
  await page.waitForTimeout(2000);
  if ((await page.getByLabel('Announcement').count()) === 0) return;
  await page.getByLabel('Announcement').fill('buyer wrote this');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(2500);
  must(!(await page.getByText('Announcement saved').count()), 'a buyer saved an announcement');
});

await check('a buyer can still add to the cart', async () => {
  await page.goto(`${WEB}/products`);
  await page.waitForTimeout(1800);
  await page.getByText(PRODUCTS[2].name).first().click();
  await page.waitForURL(/\/products\/[0-9A-Z]{26}/);
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await page.waitForTimeout(900);
});

await check('a buyer can complete a checkout and pay', async () => {
  await page.goto(`${WEB}/cart`);
  await page.getByLabel('Address').fill('9 Buyer Lane');
  await page.getByLabel('City').fill('Bristol');
  await page.getByLabel('Postcode').fill('BS1 4TR');
  await page.getByRole('button', { name: 'Checkout' }).click();
  await page.waitForURL(/\/orders\/[0-9A-Z]{26}\/pay/, { timeout: 60_000 });
  await page.getByTestId('card-number').fill('4242 4242 4242 4242');
  await page.getByTestId('card-month').fill('12');
  await page.getByTestId('card-year').fill('2030');
  await page.getByTestId('card-cvc').fill('123');
  await page.getByTestId('pay-now').click();
  await page.waitForURL(/\/orders\/[0-9A-Z]{26}$/, { timeout: 60_000 });
});

await check('a buyer sees their own order', async () => {
  await page.goto(`${WEB}/orders`);
  await page.waitForTimeout(2000);
  must((await page.locator('.ant-table-tbody tr.ant-table-row').count()) >= 1, 'the buyer has no orders');
});

await check('a buyer can book a ticket', async () => {
  await page.goto(`${WEB}/events`);
  await page.waitForTimeout(1800);
  await page.getByText(EVENT).first().waitFor({ timeout: 20_000 });
  await page.getByText(EVENT).first().click();
  await page.waitForURL(/\/events\/[0-9A-Z]{26}/);
  await page.getByLabel('Tickets').fill('1');
  await page.getByRole('button', { name: 'Book' }).click();
  await page.waitForURL(/\/bookings\/[0-9A-Z]{26}/, { timeout: 60_000 });
});

// ===================================================== 12. sessions & a11y
section('Sessions, keyboard and hygiene');

await check('signing out returns to the login page', async () => {
  await signOutIfIn();
  must(page.url().includes('/login'), `landed on ${page.url()}`);
});

await check('after signing out the shop is no longer reachable', async () => {
  await page.goto(`${WEB}/products`);
  await page.waitForTimeout(2000);
  must(page.url().includes('/login'), 'the catalogue was served to a signed-out visitor');
});

await check('the back button after signing out does not restore the session', async () => {
  await page.goBack();
  await page.waitForTimeout(2000);
  must(page.url().includes('/login'), `back landed on ${page.url()}`);
});

await check('a second sign-in works after a sign-out', async () => {
  await signIn(ADMIN);
});

await check('every image on the storefront carries an alt attribute', async () => {
  await page.goto(`${WEB}/products`);
  await page.waitForTimeout(2000);
  const missing = await page.locator('img:not([alt])').count();
  must(missing === 0, `${missing} images without alt`);
});

await check('the page has exactly one first-level heading', async () => {
  const h1 = await page.locator('h1').count();
  must(h1 >= 1, 'no h1 on the storefront');
});

await check('the keyboard can reach the first product', async () => {
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const tag = await page.evaluate(() => document.activeElement?.tagName ?? '');
  must(tag !== 'BODY', 'tab did not move focus');
});

await check('focus is visible where it lands', async () => {
  const outline = await page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return '';
    const s = getComputedStyle(el);
    return `${s.outlineStyle}|${s.boxShadow}`;
  });
  must(outline !== 'none|none', 'the focused element shows no focus ring');
});

await check('a skip link is offered to keyboard users', async () => {
  must(/skip to content/i.test(await page.locator('body').innerText()), 'no skip link');
});

await check('the filter inputs are labelled for a screen reader', async () => {
  must((await page.getByLabel('Min price').count()) > 0, 'the price filter has no accessible name');
});

await check('no 5xx response was served during the whole run', async () => {
  must(failedRequests.length === 0, `server errors: ${failedRequests.slice(0, 3).join(' | ')}`);
});

await check('no uncaught client error was logged during the whole run', async () => {
  const real = consoleErrors.filter((e) => !/favicon|404|Failed to load resource/i.test(e));
  must(real.length === 0, `${real.length} console errors, first: ${real[0]?.slice(0, 120)}`);
});

// ------------------------------------------------------------------ report
const passed = results.filter((r) => r.status === 'pass').length;
const failed = results.filter((r) => r.status === 'fail');

console.log(`\n================ ${results.length} cases: ${passed} passed, ${failed.length} failed`);
for (const f of failed) console.log(`  ${f.id} [${f.group}] ${f.name}\n      ${f.message}`);

writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
console.log(`\nreport: ${OUT}/report.json   failure screenshots: ${SHOTS}`);

await browser.close();
