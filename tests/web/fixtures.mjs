// Every spec imports `test` from here instead of @playwright/test. The real
// Firebase SDK is never fetched: its gstatic scripts are answered with an empty
// file, which is the "SDK failed to load" case. cloud.spec injects a fake.

import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://www.gstatic.com/firebasejs/**', route =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await use(page);
  }
});

export { expect };
