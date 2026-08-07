import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  // No `webServer`: scripts/e2e.mjs runs `docker:up` first, so the whole stack
  // is already listening. The LLM path is genuinely slow, hence the budget.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Serial, single worker: these specs create products and orders in one shared
  // tenant and sign the same browser in and out. Parallelism would make them
  // race over each other's data.
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:3002', trace: 'retain-on-failure' },
});
