// Every spec imports `test` from here instead of @playwright/test. The real
// Firebase SDK is never fetched: its gstatic scripts are answered with an empty
// file, which is the "SDK failed to load" case. cloud.spec injects a fake.
// Groq requests are blocked unless a spec mocks them.

import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://www.gstatic.com/firebasejs/**', route =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    // Groq is never called for real; specs that need it route their own mock,
    // which Playwright tries before this one.
    await page.route('**/api.groq.com/**', route => route.abort());
    // Specs never depend on this PC's .env: no Worker URL or OAuth client id
    // unless a spec saves one in Settings → Business.
    await page.route('**/js/app-config.js', route =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: 'export const APP_CONFIG = {};\n' }));
    await use(page);
  }
});

export { expect };
