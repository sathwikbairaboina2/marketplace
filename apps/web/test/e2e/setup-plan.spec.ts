import { expect, test, request as playwrightRequest } from '@playwright/test';
import { ENGINE_URL, PASSWORD, WEB_URL, resolveUser, signIn } from './helpers/session';

const AGENTS_URL = 'http://127.0.0.1:33001/api/v1';

/**
 * The whole-system assertion for applying a setup plan: one call, two halves,
 * two different destinations.
 *
 * The plan is applied directly with a known payload rather than interviewed out
 * of the wizard, for registry-loop.spec.ts's reason -- the conversational path
 * runs through a local LLM that will not propose the same field name twice, and
 * asserting on a generated name would manufacture flake. What is proved here is
 * the part that must never break: the storefront half lands on the draft, the
 * field half becomes a proposed flow, and neither is silently dropped.
 */
test('applying a setup plan writes the storefront and proposes the fields', async ({ page }) => {
  const stamp = Date.now();
  const fieldName = `material${stamp}`;
  const category = `mugs-${stamp}`;

  const api = await playwrightRequest.newContext();
  const login = await api.post(`${WEB_URL}/api/login`, {
    data: { username: resolveUser('acme-admin'), password: PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = (await login.json()) as { token: string };
  const auth = { Authorization: `Bearer ${token}` };

  // A setup plan is merged into a draft; this run needs one to exist rather
  // than inheriting whatever a previous run left.
  const seeded = await api.put(`${ENGINE_URL}/storefront/draft`, {
    headers: auth,
    data: {
      presetId: 'artisan',
      overrides: {},
      about: {
        title: 'About the studio',
        sections: [{ heading: 'Who we are', body: 'Small-batch ceramics.' }],
      },
      banners: [],
      businessProfile: {
        kind: 'ceramics studio',
        name: 'Kiln & Loom',
        tone: 'warm',
        audience: 'gift buyers',
      },
    },
  });
  expect(seeded.ok()).toBeTruthy();

  const applied = await api.post(`${AGENTS_URL}/setup-plan/apply`, {
    headers: auth,
    data: {
      sellsWhat: 'goods',
      categories: [category],
      fields: [
        { entity: 'Product', field: { name: fieldName, type: 'string', required: false, default: null } },
      ],
    },
  });
  expect(applied.ok()).toBeTruthy();

  const result = (await applied.json()) as {
    applied: { sellsWhat: string; categories: string[] };
    queued: Array<{ entity: string; fieldName: string }>;
    failed: Array<{ fieldName: string; reason: string }>;
  };
  expect(result.applied).toEqual({ sellsWhat: 'goods', categories: [category] });
  expect(result.queued).toEqual([{ entity: 'Product', fieldName, messageId: expect.any(String) }]);
  expect(result.failed).toEqual([]);

  // The storefront half: applied immediately, on the draft, not published.
  const draft = await api.get(`${ENGINE_URL}/storefront/draft`, { headers: auth });
  const { draft: config } = (await draft.json()) as {
    draft: { sellsWhat?: string; categories?: string[] };
  };
  expect(config.sellsWhat).toBe('goods');
  expect(config.categories).toEqual([category]);
  await api.dispose();

  // The field half: a proposal an administrator still has to execute, which is
  // why nothing about Product has changed yet.
  await signIn(page, 'acme-admin');
  await page.goto('/admin/flows');
  await expect(page.getByText(fieldName)).toBeVisible({ timeout: 15_000 });
});

/**
 * The wizard renders no Setup tab until the agent has proposed something --
 * an interview that never completed its requirements produces no plan, and an
 * empty tab would read as a broken feature rather than an absent one.
 */
test('the onboarding wizard shows no Setup tab before a plan exists', async ({ page }) => {
  await signIn(page, 'acme-admin');
  await page.goto('/admin/onboarding');
  await expect(page.getByTestId('composer')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Setup' })).toHaveCount(0);
});
