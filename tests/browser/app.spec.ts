import { expect, test, type Page } from './support/fixtures';
import { installVoiceMocks } from './support/voice-mocks';
import { chatReply } from './support/assistant-helpers';

const GREETING = 'Hi, I’m Remi. How can I help you find things around your home today?';

async function openRemi(page: Page, voice = true) {
  if (voice) await installVoiceMocks(page);
  const health = await (await page.request.get('/api/health')).json();
  await page.route('**/api/health', (route) =>
    route.fulfill({ json: { ...health, assistant_provider: voice ? 'muse' : 'disabled' } }),
  );
  await page.goto('/');
  await expect(page.locator('.object-card').first()).toBeVisible();
  if (voice) await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(true);
}

for (const phrase of ['Hey Remi', 'Hello Remi', 'Hi Remi']) {
  test(`${phrase} wakes Remi, acknowledges, answers an inline question and returns to standby`, async ({
    page,
  }) => {
    const messages: string[] = [];
    let transcriptions = 0;
    await page.route('**/api/chat', (route) => {
      messages.push(route.request().postDataJSON().message);
      return route.fulfill({ json: chatReply('Your keys were last seen on the desk.') });
    });
    await page.route('**/api/voice/transcribe', (route) => {
      transcriptions++;
      return route.fulfill({ json: { text: 'Unexpected extra recording' } });
    });
    await openRemi(page);
    await page.evaluate(
      (phrase) => window.__voiceTest.recognize(`${phrase}, where are my keys?`),
      phrase,
    );
    await expect.poll(() => page.evaluate(() => window.__voiceTest.spoken)).toEqual([GREETING]);
    expect(messages).toEqual([]);
    await page.evaluate(() => window.__voiceTest.finishSpeech());
    await expect.poll(() => messages).toEqual(['where are my keys?']);
    await expect
      .poll(() => page.evaluate(() => window.__voiceTest.spoken.at(-1)))
      .toBe('Your keys were last seen on the desk.');
    await page.evaluate(() => window.__voiceTest.finishSpeech());
    await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(true);
    expect(transcriptions).toBe(0);
    await expect(
      page.getByRole('button', { name: /Turn (off|on).*voice|Disable Hello|Enable Hello/ }),
    ).toHaveCount(0);
  });
}

test('wake without an inline question records after the greeting, transcribes and answers', async ({
  page,
}) => {
  const messages: string[] = [];
  let transcriptions = 0;
  await page.route('**/api/voice/transcribe', (route) => {
    transcriptions++;
    return route.fulfill({ json: { text: 'Where is my adapter?' } });
  });
  await page.route('**/api/chat', (route) => {
    messages.push(route.request().postDataJSON().message);
    return route.fulfill({ json: chatReply('The adapter was last seen beside the monitor.') });
  });
  await openRemi(page);
  await page.clock.install();
  await page.evaluate(() => window.__voiceTest.recognize('Hello Remi'));
  await expect.poll(() => page.evaluate(() => window.__voiceTest.spoken)).toContain(GREETING);
  expect(await page.evaluate(() => window.__voiceTest.recordings)).toBe(0);
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await expect.poll(() => page.evaluate(() => window.__voiceTest.recordings)).toBe(1);
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0.08;
  });
  await page.clock.runFor(400);
  await page.evaluate(() => {
    window.__voiceTest.amplitude = 0;
  });
  await page.clock.runFor(1500);
  await expect.poll(() => messages).toEqual(['Where is my adapter?']);
  expect(transcriptions).toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.spoken.at(-1)))
    .toBe('The adapter was last seen beside the monitor.');
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(true);
});

test('sidebar voice, speed and volume persist and apply to previews and greetings', async ({
  page,
}) => {
  await openRemi(page);
  await page.getByText('Remi voice settings', { exact: true }).click();
  const sidebar = page.locator('.sidebar');
  await sidebar.getByRole('combobox', { name: 'Speaking voice' }).selectOption('test-sam');
  await sidebar.getByRole('slider', { name: 'Speaking speed' }).fill('0.9');
  await sidebar.getByRole('slider', { name: 'Reply volume' }).fill('0.4');
  await sidebar.getByRole('button', { name: 'Preview voice' }).click();
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.speechRequests.at(-1)))
    .toMatchObject({ voiceURI: 'test-sam', rate: 0.9, volume: 0.4 });
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(true);
  await page.getByText('Remi voice settings', { exact: true }).click();
  await expect(sidebar.getByRole('combobox', { name: 'Speaking voice' })).toHaveValue('test-sam');
  await expect(sidebar.getByRole('slider', { name: 'Reply volume' })).toHaveValue('0.4');
  await page.evaluate(() => window.__voiceTest.recognize('Hi Remi'));
  await expect
    .poll(() => page.evaluate(() => window.__voiceTest.speechRequests.at(-1)))
    .toMatchObject({ text: GREETING, voiceURI: 'test-sam', rate: 0.9, volume: 0.4 });
});

test('chat uses the API, preserves history after closing and survives navigation', async ({
  page,
}) => {
  const histories: unknown[][] = [];
  await page.route('**/api/chat', (route) => {
    histories.push(route.request().postDataJSON().history);
    return route.fulfill({ json: chatReply('Your keys were last seen on the desk.') });
  });
  await openRemi(page);
  await page.getByRole('textbox', { name: 'Ask Remi', exact: true }).fill('Where are my keys?');
  await page.getByRole('button', { name: 'Send query', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Your keys were last seen on the desk.');
  await page.getByRole('button', { name: 'Close Remi chat' }).click();
  await page.getByRole('button', { name: /^Activity/ }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.getByRole('button', { name: 'Open Remi chat', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Where are my keys?');
  await page
    .getByRole('textbox', { name: 'Ask about a shared object' })
    .fill('What about the bottle?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => histories.length).toBe(2);
  expect(histories[1]).toHaveLength(2);
});

test('a new household member is saved and selectable without creating another profile', async ({
  page,
  request,
}) => {
  await openRemi(page, false);
  const first = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('commonplace-guest-session')!),
  );
  await page.getByRole('button', { name: 'Household members' }).click();
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('New household tester');
  await page.getByRole('button', { name: 'Add household member', exact: true }).click();
  await expect(page.locator('.profile strong')).toHaveText('New household tester');
  const added = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('commonplace-guest-session')!),
  );
  expect(
    (
      await request.get('/api/me', { headers: { Authorization: `Bearer ${first.token}` } })
    ).status(),
  ).toBe(401);
  const directory = await (await request.get('/api/guest/users')).json();
  expect(directory.users).toContainEqual(added.member);
  await page.getByRole('button', { name: 'Household members' }).click();
  await page
    .getByRole('button', { name: new RegExp(`^Use Pree \\(${first.member.id.slice(-6)}\\)$`) })
    .click();
  await expect(page.locator('.profile strong')).toHaveText('Pree');
  await page.getByRole('button', { name: 'Household members' }).click();
  await page
    .getByRole('button', {
      name: new RegExp(`^Use New household tester \\(${added.member.id.slice(-6)}\\)$`),
    })
    .click();
  await expect(page.locator('.profile strong')).toHaveText('New household tester');
  expect(
    (await page.evaluate(() => JSON.parse(sessionStorage.getItem('commonplace-guest-session')!)))
      .member.id,
  ).toBe(added.member.id);
});

test('permissions errors keep typing available and hidden tabs pause wake recognition', async ({
  page,
}) => {
  await openRemi(page);
  await page.evaluate(() => window.__voiceTest.wakeError('not-allowed'));
  await page.getByRole('button', { name: 'Open Remi chat', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Voice permission was denied');
  await expect(page.getByRole('textbox', { name: 'Ask about a shared object' })).toBeEnabled();
  await page.getByRole('button', { name: 'Allow microphone' }).click();
  await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(false);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(true);
});

test('scan dialog scrolls inside a short laptop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 500 });
  await openRemi(page, false);
  await page.getByRole('button', { name: 'Scan room' }).click();
  await page.getByRole('button', { name: /Continue with/ }).click();
  const scan = page.locator('.scan-modal');
  const box = await scan.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(500);
  expect(await scan.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await scan.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(page.getByRole('button', { name: 'Start camera preview' })).toBeInViewport();
  await page.screenshot({ path: 'test-results/remi-scan-short.png' });
});

test('footer reflects the used stack and the date rolls over at midnight without reload', async ({
  page,
}) => {
  await page.clock.install({ time: new Date(2026, 9, 24, 23, 59, 59) });
  await openRemi(page, false);
  const date = page.locator('.topbar .eyebrow');
  await expect(date).toHaveText('SATURDAY, OCT 24');
  await page.clock.runFor(2000);
  await expect(date).toHaveText('SUNDAY, OCT 25');
  const footer = page.locator('.site-footer');
  await expect(footer).toContainText('© 2026');
  await expect(footer).toContainText('Meta Muse');
  await expect(footer).toContainText('Google Gemini');
  await expect(footer).toContainText('SpacetimeDB');
  await expect(footer).not.toContainText(/coinbase|factory|mercor|Fireworks|ANTHROPIC|2025/i);
});

test('ordinary greetings and similar words do not trigger the microphone', async ({ page }) => {
  await openRemi(page);
  await page.clock.install();
  for (const phrase of ['Hello', 'Hi everyone', 'Hey reminder', 'Where is Remi?']) {
    await page.evaluate((phrase) => window.__voiceTest.recognize(phrase), phrase);
    await page.clock.runFor(50);
  }
  expect(await page.evaluate(() => window.__voiceTest.spoken)).toEqual([]);
  expect(await page.evaluate(() => window.__voiceTest.recordings)).toBe(0);
});

test('mobile sidebar retains member and voice controls without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRemi(page);
  await expect(page.getByRole('button', { name: 'Household members' })).toBeVisible();
  await page.getByText('Remi voice settings', { exact: true }).click();
  await expect(
    page.locator('.sidebar').getByRole('slider', { name: 'Reply volume' }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/remi-mobile.png', fullPage: true });
});

test('failed questions from the card remain editable for retry', async ({ page }) => {
  await page.route('**/api/chat', (route) =>
    route.fulfill({ status: 429, json: { detail: 'Please try again shortly.' } }),
  );
  await openRemi(page);
  await page.getByRole('textbox', { name: 'Ask Remi', exact: true }).fill('Where are my glasses?');
  await page.getByRole('button', { name: 'Send query' }).click();
  await expect(page.getByRole('alert')).toContainText('Please try again shortly.');
  await expect(page.getByRole('textbox', { name: 'Ask about a shared object' })).toHaveValue(
    'Where are my glasses?',
  );
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
});
