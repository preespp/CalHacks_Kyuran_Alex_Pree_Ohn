import { expect, test } from '@playwright/test';
import { joinAsGuest } from './guest-helpers';

test('disabled assistant is honest and preserves ordinary memory search', async ({ page }) => {
  await page.goto('/');
  await joinAsGuest(page);
  await page.getByRole('button', { name: 'Ask Muse', exact: true }).click();
  await expect(page.getByText('Muse assistant is not enabled yet.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Our memory', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search objects' }).fill('keys');
  await expect(page.locator('.object-card')).toHaveCount(1);
});

test('assistant presents retrieved evidence, handles errors, and clears on profile change', async ({
  page,
}) => {
  // The browser contract is mocked; real Muse tool exchange is covered by backend tests.
  await page.route('**/api/health', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), assistant_provider: 'muse' },
    });
  });
  let failNext = false;
  const histories: unknown[][] = [];
  await page.route('**/api/chat', async (route) => {
    const body = route.request().postDataJSON();
    histories.push(body.history);
    if (failNext) {
      await route.fulfill({
        status: 429,
        json: {
          detail: 'Muse assistant quota was reached. Wait and retry, or use object search.',
        },
      });
      return;
    }
    const response = await page.request.get('/api/connector/search?q=keys', {
      headers: { Authorization: route.request().headers()['authorization'] },
    });
    expect(response.ok()).toBeTruthy();
    const result = await response.json();
    await route.fulfill({
      json: {
        provider: 'muse',
        answer: 'The sample illustration shows the house keys on the desk.',
        query: 'keys',
        matches: result.matches,
        total_matches: result.matches.length,
        needs_disambiguation: false,
      },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await joinAsGuest(page);
  await expect(page.locator('.object-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Ask Muse', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Ask about a shared object' });
  await input.fill('Where are our keys?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const transcript = page.getByRole('log', { name: 'Assistant conversation' });
  await expect(transcript).toContainText('The sample illustration shows the house keys');
  await expect(transcript).not.toContainText('Kyuran');
  await expect(transcript).toContainText('Sample illustration');
  expect(histories[0]).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/assistant-mobile.png', fullPage: true });
  await page.locator('.assistant-record').click();
  await expect(page.getByRole('dialog')).toContainText('House keys');
  await expect(page.getByLabel('Object location in saved image')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();

  failNext = true;
  await input.fill('Where are they now?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('quota was reached');
  expect(histories[1]).toHaveLength(2);
  await expect(input).toHaveValue('Where are they now?');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();

  await page.getByRole('button', { name: 'Household', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Your name' }).fill('Alex');
  await page.getByRole('button', { name: 'Switch guest', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(transcript).not.toContainText('Where are our keys?');
  await expect(input).toHaveValue('');
});
