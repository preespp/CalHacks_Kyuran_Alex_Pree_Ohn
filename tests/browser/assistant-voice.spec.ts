import { expect, test } from './fixtures';
import { installVoiceMocks } from './voice-mocks';
import { chatReply, openAssistant } from './assistant-helpers';

test('Ask Muse supports typing, bounded context, and clearing the conversation', async ({
  page,
}) => {
  const paths: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) paths.push(path);
  });
  const messages: { message: string; history: unknown[] }[] = [];
  await page.route('**/api/chat', (route) => {
    messages.push(route.request().postDataJSON());
    return route.fulfill({
      json: chatReply(
        messages.length === 1 ? 'Hello, I am Muse.' : 'Yes, that was our earlier greeting.',
      ),
    });
  });
  await openAssistant(page);
  await expect(page.getByRole('heading', { name: 'Just ask your household.' })).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Ask about a shared object' });
  await expect(input).toBeEnabled();
  expect(messages).toHaveLength(0);
  await input.fill('Hello');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Hello, I am Muse.');
  await input.fill('Do you remember our greeting?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('our earlier greeting');
  expect(messages[1].history).toHaveLength(2);
  expect(paths.some((path) => path.startsWith('/api/lab/'))).toBe(false);
  await page.getByRole('button', { name: 'Clear chat' }).click();
  await expect(page.getByRole('log')).not.toContainText('our earlier greeting');
});

test('Muse microphone transcribes to editable text, reads replies, and keeps typing usable', async ({
  page,
}) => {
  await installVoiceMocks(page);
  let transcriptions = 0;
  await page.route('**/api/voice/transcribe', async (route) => {
    transcriptions++;
    expect(route.request().postDataBuffer()?.includes(Buffer.from('RIFF'))).toBeTruthy();
    await route.fulfill({ json: { provider: 'muse', text: 'Tell me a joke.' } });
  });
  await page.route('**/api/chat', (route) =>
    route.fulfill({ json: chatReply('Here is a short joke from Muse.') }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await openAssistant(page);
  const mic = page.getByRole('button', { name: 'Dictate a message', exact: true });
  const input = page.getByRole('textbox', { name: 'Ask about a shared object' });
  await expect(mic).toBeEnabled();
  await mic.click();
  await expect(page.getByRole('button', { name: 'Stop and transcribe' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel recording' }).click();
  await expect(mic).toBeEnabled();
  expect(transcriptions).toBe(0);
  await mic.click();
  await page.getByRole('button', { name: 'Stop and transcribe' }).click();
  await expect(input).toHaveValue('Tell me a joke.');
  await expect(input).toBeEnabled();
  expect(transcriptions).toBe(1);
  await expect(page.getByRole('checkbox', { name: 'Read replies aloud' })).toBeChecked();
  await input.fill('Tell me a short joke.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('short joke from Muse');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __voiceTest: { spoken: string[] } }).__voiceTest.spoken.length,
      ),
    )
    .toBe(1);
  await page.getByRole('button', { name: 'Read reply', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __voiceTest: { spoken: string[] } }).__voiceTest.spoken.length,
      ),
    )
    .toBe(2);
  await page.getByRole('button', { name: 'Stop speaking' }).click();
  await expect(page.getByRole('button', { name: 'Stop speaking' })).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/muse-voice-mobile.png', fullPage: true });
  await page.evaluate(() => {
    (window as unknown as { __voiceTest: { denied: boolean } }).__voiceTest.denied = true;
  });
  await mic.click();
  await expect(page.getByRole('alert')).toContainText('permission denied');
  await expect(input).toBeEnabled();
  await input.fill('Typing still works');
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { __voiceTest: { stopped: number } }).__voiceTest.stopped,
    ),
  ).toBeGreaterThanOrEqual(2);
});

test('Ask Muse reports quota failure without substituting an answer', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/chat', (route) => {
    calls++;
    return route.fulfill({
      status: 429,
      json: { detail: 'Muse quota or credit limit was reached.' },
    });
  });
  await openAssistant(page);
  await page.getByRole('textbox', { name: 'Ask about a shared object' }).fill('Hello');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('quota or credit limit');
  await expect(page.getByRole('textbox', { name: 'Ask about a shared object' })).toHaveValue(
    'Hello',
  );
  expect(calls).toBe(1);
  await expect(page.locator('.assistant-message-assistant')).toHaveCount(0);
});
