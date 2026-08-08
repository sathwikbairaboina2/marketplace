import { expect, test, request as playwrightRequest } from '@playwright/test';
import { ENGINE_URL, PASSWORD, WEB_URL, signIn } from './helpers/session';

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
  const fieldName = `warranty${Date.now()}`;

  const api = await playwrightRequest.newContext();
  const login = await api.post(`${WEB_URL}/api/login`, {
    data: { username: 'acme-admin', password: PASSWORD },
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
  await expect(page.getByLabel(fieldName)).toBeVisible();

  await page.goto('/products');
  await expect(page.getByLabel(fieldName)).toBeVisible();
});
