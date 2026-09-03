import { defineConfig } from '@playwright/test';

// The browser must be pointed at localhost, not 127.0.0.1: the client bundle is
// built with NEXT_PUBLIC_ENGINE_URL=http://localhost:33000 and the engine allows
// the http://localhost:33002 origin, so a browser on the IPv4 literal is a
// different origin and every call it makes is refused by CORS. The API-side
// harnesses in this repo do use 127.0.0.1, deliberately -- they are not browsers
// and are not origin-checked.

export default defineConfig({
  testDir: './test/e2e',
  // Mints this run's own tenants (#19) so the specs stop littering the
  // seeded demo shop; helpers/session.ts remaps the persona names.
  globalSetup: './test/e2e/global-setup.ts',
  // No `webServer`: scripts/e2e.mjs runs `docker:up` first, so the whole stack
  // is already listening. The LLM path is genuinely slow, hence the budget.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // Serial, single worker: these specs create products and orders in one shared
  // tenant and sign the same browser in and out. Parallelism would make them
  // race over each other's data.
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:33002', trace: 'retain-on-failure' },
});
