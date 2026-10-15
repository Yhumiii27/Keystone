// End-to-end tests (R-016): Playwright against `next start` with a fresh database — run them with `npm run test:e2e`
// (tests/e2e/run.ts starts the server and sets E2E_BASE_URL). One worker: the scenarios share the server's database and run
// in file order. Chromium only (PLAYWRIGHT_BROWSERS_PATH points at a preinstalled one where available). Not part of vitest.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list']],
  outputDir: 'test-results/playwright',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3315',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
