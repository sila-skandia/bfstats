import { defineConfig, devices } from '@playwright/test';

/**
 * This suite only ever runs locally, via scripts/verify.sh, to check we haven't
 * broken anything. It is tuned for turnaround, not for a shared CI runner.
 *
 * Notably there is no `process.env.CI` branch. verify.sh sets CI=true inside the
 * container purely to make Playwright non-interactive, but Playwright also reads
 * that flag as "you are on a weak shared runner" and drops to a single worker
 * with two retries — which is what turned a couple of minutes of real work into
 * a fifteen minute wait.
 */

/** Pins its own Pixel 5 viewport via test.use(), so it belongs to one project. */
const MOBILE_SPECS = /responsive-mobile\.spec\.ts/;

/**
 * WebKit is ~2.3x slower than Chromium for the same tests and is off by default.
 * Opt in with PW_ALL_BROWSERS=1 when a change could plausibly be engine-specific
 * (layout, CSS, date parsing, Intl).
 */
const allBrowsers = !!process.env.PW_ALL_BROWSERS;

/**
 * Browsers all talk to one dev server and one SQLite-backed API, so this trades
 * off against backend contention rather than CPU. Override with PW_WORKERS.
 */
const workers = process.env.PW_WORKERS ?? '50%';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  // Local-only: `.only` is a debugging convenience here, not a mistake to catch.
  forbidOnly: false,
  // A retry hides a flake and costs a full timeout. Fix the test instead.
  retries: 0,
  workers,
  // 'list' streams progress; the HTML report must never try to open a browser
  // from inside the container.
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: MOBILE_SPECS,
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: MOBILE_SPECS,
    },
    ...(allBrowsers
      ? [{
          name: 'webkit',
          use: { ...devices['Desktop Safari'] },
          testIgnore: MOBILE_SPECS,
        }]
      : []),
  ],

  // verify.sh starts the API and UI itself and sets PW_SKIP_WEBSERVER.
  webServer: process.env.PW_SKIP_WEBSERVER ? undefined : {
    command: 'npm run dev',
    url: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
