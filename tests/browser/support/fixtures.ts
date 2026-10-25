import { test as base, type Page } from '@playwright/test';

export { expect } from '@playwright/test';
export type { Page } from '@playwright/test';

export async function blockExternalFonts(page: Page) {
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
}

export const test = base.extend({
  page: async ({ page }, use) => {
    // Product behavior and local screenshots must not depend on a remote font CDN.
    await blockExternalFonts(page);
    await use(page);
  },
});
