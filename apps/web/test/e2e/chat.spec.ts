import { expect, test } from '@playwright/test';
import { signIn } from './helpers/session';

/**
 * Asserts the socket, the graph and the phase machine -- and deliberately
 * nothing about the model's word choices. qwen3.8:27b runs locally and
 * is slow; the deterministic half of this loop lives in registry-loop.spec.ts.
 */
test('a conversation reaches awaiting_confirmation with a draft', async ({ page }) => {
  test.slow();

  await signIn(page, 'acme-admin');
  await page.goto('/admin/chat');

  await expect(page.getByTestId('composer')).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId('composer').fill('Add a required text field called colour to Product');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('phase')).toHaveText('awaiting_confirmation', {
    timeout: 90_000,
  });
  await expect(page.getByTestId('confirm')).toBeEnabled();
  // The phase drives the controls: at awaiting_confirmation the composer locks.
  await expect(page.getByTestId('composer')).toBeDisabled();

  await page.getByTestId('confirm').click();

  // Confirming only queues a PROPOSE_FLOW message -- the engine's consumer
  // creates the Flow whenever it gets to it, which is why this is the last
  // thing the socket can tell us.
  await expect(page.getByText('Proposal queued')).toBeVisible({ timeout: 60_000 });
});
