import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers/session';

/**
 * Open the settings page and wait for the stored announcement to arrive.
 *
 * The page fills each field only where the seller has not touched it, but a
 * value typed *before* React has attached its handlers was never "touched" --
 * so a fill that beats the fetch is silently replaced by the stored text, and
 * the save then writes that back. The page now carries three forms and three
 * fetches, which turned that race from rare into usual.
 */
/** The announcement's own switch, driven to a known state and checked. */
async function setSwitch(page: Page, on: boolean): Promise<void> {
  // Unambiguous again now that each form on the page namespaces its field ids.
  const toggle = page.getByLabel('Show it');
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(on));
}

async function settled(page: Page): Promise<void> {
  const loaded = page.waitForResponse(
    (r) => r.url().includes('/settings/announcement') && r.request().method() === 'GET',
  );
  await page.goto('/admin/settings');
  await loaded;
  // The response has arrived; the form's own `.then` has not necessarily run
  // yet, and it is that callback which writes the stored value into the field.
  await page.waitForTimeout(500);
}

test('the seller sets an announcement and the storefront wears it', async ({ page }) => {
  await signIn(page, 'acme-admin');

  await settled(page);
  await page.getByLabel('Announcement').fill('Launch week — 10% off');
  // Pinned before saving: if the stored value ever lands on top of what was
  // typed, this fails here rather than quietly saving the old text and leaving
  // a confusing assertion three lines further down.
  await expect(page.getByLabel('Announcement')).toHaveValue('Launch week — 10% off');
  // The settings page carries more than one switch now, so this one is
  // addressed by its field id, and the state is asserted rather than assumed:
  // a click that silently fails to register used to be saved as `enabled:
  // false` and only reported three lines later as "the strip is missing".
  await setSwitch(page, true);
  await page.getByRole('button', { name: 'Save announcement' }).click();
  await expect(page.getByText('Announcement saved')).toBeVisible();

  await page.goto('/products');
  await expect(page.getByText('Launch week — 10% off')).toBeVisible();

  // And off again — the strip must vanish, not linger.
  await settled(page);
  await setSwitch(page, false);
  await page.getByRole('button', { name: 'Save announcement' }).click();
  await expect(page.getByText('Announcement saved')).toBeVisible();
  await page.goto('/products');
  await expect(page.getByText('Launch week — 10% off')).not.toBeVisible();
});
