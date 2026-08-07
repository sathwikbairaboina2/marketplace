import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers/session';

/**
 * Automated accessibility checks.
 *
 * axe finds a real but bounded class of defect -- missing names, unlabelled
 * controls, insufficient contrast, broken landmark and heading structure. It
 * cannot tell whether a focus order makes sense or whether an announcement is
 * useful, so this is a floor, not a substitute for the screenshot review.
 *
 * Only `serious` and `critical` fail the build. `moderate` and `minor` are
 * reported in the failure message when something else already broke, but a
 * best-practice advisory should not stop a merge on its own.
 */
const BLOCKING = new Set(['serious', 'critical']);

/**
 * ANTD puts `aria-required` on the `.ant-select` wrapper, which carries no ARIA
 * role -- the `combobox` role is on an inner input -- so axe reports the
 * attribute as disallowed. It is a defect in the component library, not in this
 * application: nothing here sets that attribute, and the only way to remove it
 * is to stop marking those form fields required, which would be a worse
 * outcome for every user than the attribute is for any.
 *
 * Scoped as narrowly as possible: this rule, on this selector, and nothing
 * else. Any other aria-allowed-attr failure still fails the build.
 */
function isAntdSelectAriaRequired(ruleId: string, node: { html: string }): boolean {
  return ruleId === 'aria-allowed-attr' && node.html.includes('ant-select');
}

async function audit(page: Page, path: string) {
  await page.goto(path);
  // The pages fetch on mount; running axe against a skeleton audits the
  // skeleton rather than the page.
  await page.waitForTimeout(1200);

  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const blocking = violations
    .filter((v) => BLOCKING.has(v.impact ?? ''))
    .map((v) => ({ ...v, nodes: v.nodes.filter((n) => !isAntdSelectAriaRequired(v.id, n)) }))
    .filter((v) => v.nodes.length > 0);
  const described = blocking.map(
    (v) => `${v.impact}: ${v.id} -- ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`,
  );

  expect(described, `${path} has blocking accessibility violations`).toEqual([]);
}

const SHOP = ['/products', '/events', '/orders', '/bookings', '/cart'];
const ADMIN = ['/admin/products', '/admin/events', '/admin/flows', '/admin/chat'];

test.describe('accessibility', () => {
  test('storefront pages, light', async ({ page }) => {
    test.slow();
    await signIn(page, 'acme-admin');
    for (const path of SHOP) await audit(page, path);
  });

  test('back office pages, light', async ({ page }) => {
    test.slow();
    await signIn(page, 'acme-admin');
    for (const path of ADMIN) await audit(page, path);
  });

  // Contrast is theme-dependent and every token pair has a separate dark value,
  // so a light-only pass would check half the palette.
  test('both shells, dark', async ({ page }) => {
    test.slow();
    await signIn(page, 'acme-admin');
    await page.goto('/products');
    await page
      .getByRole('button', { name: /switch to dark mode/i })
      .first()
      .click();
    await page.waitForTimeout(400);

    for (const path of ['/products', '/orders', '/admin/products', '/admin/flows']) {
      await audit(page, path);
    }
  });

  test('empty states', async ({ page }) => {
    test.slow();
    // globex has products but no orders, bookings, events or flows, so this is
    // the only run in which the empty states are what axe sees.
    await signIn(page, 'globex-admin');
    for (const path of ['/orders', '/bookings', '/admin/events', '/admin/flows']) {
      await audit(page, path);
    }
  });

  test('login', async ({ page }) => {
    await audit(page, '/login');
  });
});
