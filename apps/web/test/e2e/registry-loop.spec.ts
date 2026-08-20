import { expect, test, request as playwrightRequest } from '@playwright/test';
import { ENGINE_URL, PASSWORD, WEB_URL, resolveUser, signIn } from './helpers/session';

/**
 * The assertion that proves the registry-driven field engine, and the one that
 * must never flake.
 *
 * The flow is proposed directly with a known diff rather than through chat: the
 * chat path runs through a local LLM that will not produce the same field name
 * twice, and asserting on a generated name would manufacture flake. The
 * conversational half is covered separately and loosely in chat.spec.ts.
 */
test('executing a flow makes its new field appear in the product form', async ({ page }) => {
  const stamp = Date.now();
  const fieldName = `warranty${stamp}`;
  // Controls are labelled by `toLabel(fieldName)`, not by the raw registry name
  // -- it splits the letter/digit boundary and sentence-cases the result. Spelt
  // out here rather than imported, so a broken `toLabel` fails this test
  // instead of quietly agreeing with it.
  const fieldLabel = `Warranty ${stamp}`;

  const api = await playwrightRequest.newContext();
  const login = await api.post(`${WEB_URL}/api/login`, {
    // The same run-scoped user the browser signs in as below -- a flow
    // proposed in one tenant is invisible from another, by design.
    data: { username: resolveUser('acme-admin'), password: PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = (await login.json()) as { token: string };

  const created = await api.post(`${ENGINE_URL}/flows`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      targetEntity: 'Product',
      actionType: 'ADD_FIELDS',
      blueprintDiff: {
        addedFields: [{ name: fieldName, type: 'number', required: false, default: null }],
      },
    },
  });
  expect(created.ok()).toBeTruthy();
  const flow = (await created.json()) as { id: string };
  await api.dispose();

  await signIn(page, 'acme-admin');
  await page.goto(`/admin/flows/${flow.id}`);
  await expect(page.getByText(fieldName)).toBeVisible();

  await page.getByRole('button', { name: 'Execute' }).click();
  // The toast, specifically. A bare /Applied/ also matches the page's own
  // subtitle once the flow is applied ("Applied <date> — registry version N"),
  // which makes the locator ambiguous rather than wrong.
  await expect(page.getByText(/Applied — registry is now version/)).toBeVisible();

  // No page reload and no UI code naming this field: the create form, and the
  // search filters, are generated from the tenant's registry.
  await page.goto('/admin/products/new');
  await expect(page.getByLabel(fieldLabel)).toBeVisible();

  await page.goto('/products');
  await expect(page.getByLabel(fieldLabel)).toBeVisible();
});
