// Browser test layer. The Node suite cannot see CSS, so real-browser specs
// guard anything where styling decides what the user actually sees.

import { defineConfig, devices } from '@playwright/test';

const PORT = 8123;

// Each run gets its own artifacts folder: Playwright empties outputDir when a
// run starts, so two runs at once (dev and QA) would delete each other's trace
// files mid-test (ENOENT). Set once in the runner; workers inherit the env.
process.env.PW_RUN_ID ??= `${Date.now()}-${process.pid}`;

export default defineConfig({
  testDir: 'tests/web',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: `test-results/run-${process.env.PW_RUN_ID}`,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure'
  },
  // Desktop runs every functional spec; the phone/tablet projects run only the
  // layout spec, all on Chromium (isMobile needs a Chromium-based browser).
  projects: [
    {
      name: 'desktop',
      testIgnore: '**/mobile*.spec.mjs',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile',
      testMatch: '**/mobile*.spec.mjs',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    },
    {
      name: 'small',
      testMatch: '**/mobile*.spec.mjs',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 740 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    },
    {
      name: 'tablet',
      testMatch: '**/mobile*.spec.mjs',
      use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 }, deviceScaleFactor: 2, hasTouch: true }
    }
  ],
  webServer: {
    // Generate js/firebase-config.js first (from .env, or empty without one).
    command: 'node scripts/gen-config.mjs && node tests/web/server.mjs',
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: true,
    stdout: 'ignore'
  }
});
