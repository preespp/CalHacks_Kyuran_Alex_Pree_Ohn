import { expect, test } from '@playwright/test';
import { installVoiceMocks } from './voice-mocks';

test.beforeEach(async ({ page }) => {
  await installVoiceMocks(page);
  await page.route('**/api/lab/health', (route) =>
    route.fulfill({ json: { assistant_provider: 'muse', configured: true } }),
  );
});

test('pause sends automatically, replies aloud, and listens for a fresh follow-up', async ({
  page,
}) => {
  await page.clock.install();
  const messages: { message: string; history: unknown[] }[] = [];
  let transcriptions = 0;
  await page.route('**/api/lab/transcribe', (route) => {
    transcriptions++;
    return route.fulfill({
      json: { text: transcriptions === 1 ? 'Tell me a joke.' : 'Tell me another one.' },
    });
  });
  await page.route('**/api/lab/chat', (route) => {
    messages.push(route.request().postDataJSON());
    return route.fulfill({ json: { provider: 'muse', answer: `Muse reply ${messages.length}.` } });
  });
  await page.goto('/muse');
  await page.getByRole('button', { name: 'Talk to Muse', exact: true }).click();
  await expect(page.getByRole('meter', { name: 'Microphone level' })).toBeVisible();
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0.08;
  });
  await page.clock.runFor(400);
  await expect(page.getByRole('meter')).toHaveAttribute('value', '64');
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0;
  });
  await page.clock.runFor(1450);
  await expect(page.getByRole('log')).toContainText('Muse reply 1.');
  expect(messages[0]).toEqual({ message: 'Tell me a joke.', history: [] });
  expect(await page.evaluate(() => window.__voiceTest.spoken)).toEqual(['Muse reply 1.']);
  expect(await page.evaluate(() => window.__voiceTest.streams)).toBe(1);
  expect(await page.evaluate(() => window.__voiceTest.stopped)).toBe(1);
  // Even after a long reply, the microphone must not record the speaker output.
  await page.clock.runFor(1800);
  expect(await page.evaluate(() => window.__voiceTest.streams)).toBe(1);
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await page.clock.runFor(350);
  await expect.poll(() => page.evaluate(() => window.__voiceTest.streams)).toBe(2);
  await expect(page.getByRole('meter')).toBeVisible();
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0.08;
  });
  await page.clock.runFor(400);
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0;
  });
  await page.clock.runFor(1450);
  await expect(page.getByRole('log')).toContainText('Muse reply 2.');
  expect(messages[1].message).toBe('Tell me another one.');
  expect(messages[1].history).toHaveLength(2);
  expect(transcriptions).toBe(2);
  await page.screenshot({ path: 'test-results/muse-conversation.png', fullPage: true });
  await page.getByRole('button', { name: 'Stop voice session', exact: true }).click();
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.__voiceTest.streams)).toBe(2);
  await expect(page.getByRole('textbox', { name: 'Message Muse' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Talk to Muse', exact: true })).toBeEnabled();
});

test('silence ends the session without sending audio or using the model', async ({ page }) => {
  await page.clock.install();
  let calls = 0;
  await page.route('**/api/lab/transcribe', (route) => {
    calls++;
    return route.fulfill({ json: { text: 'should not happen' } });
  });
  await page.goto('/muse');
  await page.getByRole('button', { name: 'Talk to Muse', exact: true }).click();
  await expect(page.getByRole('meter')).toBeVisible();
  await page.clock.runFor(8200);
  await expect(page.getByRole('alert')).toContainText('No speech detected');
  await expect(page.getByRole('button', { name: 'Stop voice session' })).not.toBeVisible();
  expect(calls).toBe(0);
  expect(await page.evaluate(() => window.__voiceTest.stopped)).toBe(1);
  await expect(page.getByRole('textbox', { name: 'Message Muse' })).toBeEnabled();
});

test('blocked spoken playback pauses the loop and leaves the reply readable', async ({ page }) => {
  await page.clock.install();
  await page.route('**/api/lab/transcribe', (route) => route.fulfill({ json: { text: 'Hello' } }));
  await page.route('**/api/lab/chat', (route) =>
    route.fulfill({ json: { provider: 'muse', answer: 'Hello from Muse.' } }),
  );
  await page.goto('/muse');
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0.08;
    window.__voiceTest.blocked = true;
  });
  await page.getByRole('button', { name: 'Talk to Muse', exact: true }).click();
  await expect(page.getByRole('meter')).toBeVisible();
  await page.clock.runFor(400);
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0;
  });
  await page.clock.runFor(1450);
  await expect(page.getByRole('log')).toContainText('Hello from Muse.');
  await expect(page.getByRole('alert')).toContainText('playback was blocked');
  await expect(page.getByRole('button', { name: 'Stop voice session' })).not.toBeVisible();
  await page.clock.runFor(500);
  expect(await page.evaluate(() => window.__voiceTest.streams)).toBe(1);
  await expect(page.getByRole('button', { name: 'Read reply', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Message Muse' })).toBeEnabled();
});

test('stopping during transcription prevents late automatic chat submission', async ({ page }) => {
  await page.clock.install();
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let transcribing = false;
  let chats = 0;
  await page.route('**/api/lab/transcribe', async (route) => {
    transcribing = true;
    await waiting;
    await route.fulfill({ json: { text: 'Do not send this canceled question' } }).catch(() => {});
  });
  await page.route('**/api/lab/chat', (route) => {
    chats++;
    return route.fulfill({ json: { provider: 'muse', answer: 'Unexpected' } });
  });
  await page.goto('/muse');
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0.08;
  });
  await page.getByRole('button', { name: 'Talk to Muse', exact: true }).click();
  await expect(page.getByRole('meter')).toBeVisible();
  await page.clock.runFor(400);
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0;
  });
  await page.clock.runFor(1450);
  await expect.poll(() => transcribing).toBe(true);
  await page.getByRole('button', { name: 'Stop voice session', exact: true }).click();
  release();
  await page.clock.runFor(500);
  await expect(page.getByRole('textbox', { name: 'Message Muse' })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Message Muse' })).toHaveValue('');
  expect(chats).toBe(0);
});

test('hiding the page ends listening without uploading the unfinished turn', async ({ page }) => {
  let transcriptions = 0;
  await page.route('**/api/lab/transcribe', (route) => {
    transcriptions++;
    return route.fulfill({ json: { text: 'Unexpected' } });
  });
  await page.goto('/muse');
  await page.getByRole('button', { name: 'Talk to Muse', exact: true }).click();
  await expect(page.getByRole('meter')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: 'Stop voice session' })).not.toBeVisible();
  expect(await page.evaluate(() => window.__voiceTest.stopped)).toBe(1);
  expect(transcriptions).toBe(0);
});
