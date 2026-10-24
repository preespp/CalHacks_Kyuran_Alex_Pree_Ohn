import { expect, test, type Page } from '@playwright/test';
import { installVoiceMocks } from './voice-mocks';

test.beforeEach(async ({ page }) => {
  await installVoiceMocks(page);
  await page.clock.install();
  await page.route('**/api/lab/health', (route) =>
    route.fulfill({ json: { assistant_provider: 'muse' } }),
  );
});

async function enableWake(page: Page) {
  await page.getByRole('button', { name: 'Enable Hello', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.spoken))
    .toContain('Wake listening enabled.');
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(true);
}

test('manual wake activation acknowledges before recording and returns to standby after a reply', async ({
  page,
}) => {
  let transcriptions = 0;
  const questions: string[] = [];
  const paths: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/api/')) paths.push(path);
  });
  await page.route('**/api/lab/transcribe', (route) => {
    transcriptions++;
    return route.fulfill({ json: { text: 'Where are my keys?' } });
  });
  await page.route('**/api/lab/chat', (route) => {
    questions.push(route.request().postDataJSON().message);
    return route.fulfill({ json: { answer: 'Household memory is disconnected in this test.' } });
  });
  await page.goto('/muse');
  expect(await page.evaluate(() => window.__voiceTest.wakeStarts)).toBe(0);
  await enableWake(page);
  await page.evaluate(() => {
    window.__voiceTest.recognize('a conversation about keys');
    window.__voiceTest.recognize('helloworld');
    window.__voiceTest.recognize('Hey Muse'); // The previous phrase no longer activates listening.
  });
  expect(await page.evaluate(() => window.__voiceTest.recordings)).toBe(0);
  expect(questions).toHaveLength(0);
  await page.evaluate(() => window.__voiceTest.recognize('Hello!'));
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.spoken))
    .toContain('Hi I am Muse how can I help you today with household stuff');
  expect(await page.evaluate(() => window.__voiceTest.wake)).toBeNull();
  expect(await page.evaluate(() => window.__voiceTest.recordings)).toBe(0);
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await expect(page.getByRole('meter')).toBeVisible();
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0.08;
  });
  await page.clock.runFor(400);
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0;
  });
  await page.clock.runFor(1450);
  await expect(page.getByRole('log')).toContainText('memory is disconnected');
  expect(questions).toEqual(['Where are my keys?']);
  expect(transcriptions).toBe(1);
  expect(await page.evaluate(() => window.__voiceTest.wake)).toBeNull();
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(true);
  expect(await page.evaluate(() => window.__voiceTest.streams)).toBe(1);
  await expect(page.getByRole('textbox', { name: 'Message Muse' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Enable Hello', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__voiceTest.wake)).toBeNull();
  expect(paths.every((path) => path.startsWith('/api/lab/'))).toBe(true);
});

test('inline wake command uses the recognized text without a redundant Meta transcription', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/lab/chat', (route) => {
    calls++;
    expect(route.request().postDataJSON().message).toBe('Tell me a joke');
    return route.fulfill({ json: { answer: 'A short joke.' } });
  });
  await page.goto('/muse');
  await enableWake(page);
  await page.evaluate(() => window.__voiceTest.recognize('HELLO, Tell me a joke'));
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await expect(page.getByRole('log')).toContainText('A short joke.');
  expect(calls).toBe(1);
  expect(await page.evaluate(() => window.__voiceTest.recordings)).toBe(0);
  await page.getByRole('button', { name: 'Disable Hello' }).click();
  expect(await page.evaluate(() => window.__voiceTest.wake)).toBeNull();
});

test('wake permission failure stops listening and preserves typing', async ({ page }) => {
  await page.goto('/muse');
  await enableWake(page);
  const starts = await page.evaluate(() => window.__voiceTest.wakeStarts);
  await page.evaluate(() => window.__voiceTest.wakeError('not-allowed'));
  await expect(page.getByRole('alert')).toContainText('permission was denied');
  await page.clock.runFor(4000);
  expect(await page.evaluate(() => window.__voiceTest.wakeStarts)).toBe(starts);
  await expect(page.getByRole('textbox', { name: 'Message Muse' })).toBeEnabled();
});

test('hidden page disables wake mode and does not resume it on return', async ({ page }) => {
  await page.goto('/muse');
  await enableWake(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByRole('button', { name: 'Enable Hello' })).toBeVisible();
  expect(await page.evaluate(() => window.__voiceTest.wake)).toBeNull();
  const starts = await page.evaluate(() => window.__voiceTest.wakeStarts);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(2000);
  expect(await page.evaluate(() => window.__voiceTest.wakeStarts)).toBe(starts);
});

test('repeated immediate browser shutdowns stop wake restarts', async ({ page }) => {
  await page.goto('/muse');
  await enableWake(page);
  for (let index = 0; index < 3; index++) {
    await page.evaluate(() => window.__voiceTest.endWake());
    await page.clock.runFor(500);
  }
  await expect(page.getByRole('alert')).toContainText('keeps ending wake listening');
  expect(await page.evaluate(() => window.__voiceTest.wake)).toBeNull();
});

test('a browser without wake recognition retains manual voice and keyboard access', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto('/muse');
  await expect(page.getByRole('button', { name: 'Enable Hello' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Talk to Muse', exact: true })).toBeEnabled();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
});
