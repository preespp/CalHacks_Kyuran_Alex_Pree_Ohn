import { expect, test, type Page } from '@playwright/test';
import { joinAsGuest } from './guest-helpers';
import { installCameraMocks } from './camera-mocks';
import { installVoiceMocks } from './voice-mocks';

const GREETING = 'Hi I am Muse how can I help you today with household stuff';
function stats(index: number, analyzed = 0) {
  const quality = {
    frame_id: index,
    width: 640,
    height: 480,
    sharpness: 55,
    brightness: 127,
    quality_score: 55,
  };
  return {
    received_frames: index,
    received_fps: index > 1 ? 0.2 : 0,
    quality,
    top_frames: [quality],
    analysis: {
      state: 'waiting',
      processed_frames: analyzed,
      count: analyzed ? 1 : 0,
      observed_at: analyzed ? new Date().toISOString() : null,
      error: null,
    },
  };
}

async function prepare(page: Page, { vision = true, voice = false, automatic = false } = {}) {
  if (voice) await installVoiceMocks(page);
  await installCameraMocks(page);
  if (automatic)
    await page.addInitScript(() => {
      sessionStorage.setItem('commonplace-camera-enabled', 'true');
      sessionStorage.setItem('commonplace-voice-enabled', 'true');
    });
  const health = await (await page.request.get('/api/health')).json();
  await page.route('**/api/health', (route) =>
    route.fulfill({
      json: {
        ...health,
        vision_provider: vision ? 'gemini' : 'demo',
        assistant_provider: voice ? 'muse' : 'disabled',
      },
    }),
  );
  await page.goto('/');
  await joinAsGuest(page, 'Scan tester');
  await expect(page.locator('.object-card').first()).toBeVisible();
}

async function openCamera(page: Page) {
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(page).toHaveURL(/\/camera$/);
  await expect(page.getByRole('heading', { name: 'A view into our home.' })).toBeVisible();
}

function cameraState(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __cameraTest: {
            stopped: number;
            streams: number;
            constraints: MediaStreamConstraints[];
            jpegQuality: number;
            denied: boolean;
          };
        }
      ).__cameraTest,
  );
}

for (const seconds of [3, 4, 5]) {
  test(`camera captures every ${seconds} seconds and defaults to five`, async ({ page }) => {
    const bodies: string[] = [];
    await page.route('**/api/camera/frames', (route) => {
      bodies.push(route.request().postData()!);
      return route.fulfill({ json: stats(bodies.length, 1) });
    });
    await prepare(page);
    await openCamera(page);
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    const interval = page.getByRole('combobox', { name: 'Camera capture interval' });
    await expect(interval).toHaveValue('5');
    await expect(interval.locator('option')).toHaveText([
      'Every 3 seconds',
      'Every 4 seconds',
      'Every 5 seconds',
    ]);
    await interval.selectOption(String(seconds));
    await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
    await expect.poll(() => bodies.length).toBe(1);
    await expect(page.getByText('Processed frames: 1', { exact: false })).toBeVisible();
    await page.clock.runFor(seconds * 1000 - 100);
    expect(bodies).toHaveLength(1);
    await page.clock.runFor(200);
    await expect.poll(() => bodies.length).toBe(2);
    const field = (body: string, name: string) =>
      body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]+)`))?.[1];
    expect(field(bodies[0], 'scan_id')).toBe(field(bodies[1], 'scan_id'));
    expect(field(bodies[0], 'request_id')).not.toBe(field(bodies[1], 'request_id'));
    expect(field(bodies[0], 'memory_enabled')).toBe('true');
    expect(field(bodies[0], 'analysis_interval')).toBe(String(seconds));
    await page.getByRole('button', { name: 'Stop scanning', exact: true }).click();
    const stoppedCount = bodies.length;
    await page.clock.runFor(seconds * 2000);
    expect(bodies).toHaveLength(stoppedCount);
    expect((await cameraState(page)).stopped).toBe(1);
  });
}

test('camera keeps the same stream across camera, memory, and Muse screens; chat persists', async ({
  page,
}) => {
  let frames = 0;
  await page.route('**/api/camera/frames', (route) => route.fulfill({ json: stats(++frames, 1) }));
  await page.route('**/api/chat', (route) =>
    route.fulfill({
      json: {
        provider: 'muse',
        answer: 'The keys were last seen on the desk.',
        query: 'keys',
        matches: [],
        total_matches: 0,
        needs_disambiguation: false,
      },
    }),
  );
  await prepare(page, { voice: true });
  await openCamera(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect.poll(() => frames).toBe(1);
  await page.getByRole('button', { name: 'Ask Muse', exact: true }).click();
  await page.getByRole('textbox', { name: 'Ask about a shared object' }).fill('Where are my keys?');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('last seen on the desk');
  await page.getByRole('button', { name: 'Our memory', exact: true }).click();
  await page.clock.runFor(5100);
  await expect.poll(() => frames).toBeGreaterThan(1);
  expect((await cameraState(page)).streams).toBe(1);
  expect((await cameraState(page)).stopped).toBe(0);
  await page.getByRole('button', { name: 'Ask Muse', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Where are my keys?');
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await expect(page.getByLabel('Live room camera')).toBeVisible();
  expect((await cameraState(page)).streams).toBe(1);
});

test('default-enabled camera and Hello voice run together and stop independently', async ({
  page,
}) => {
  let frames = 0;
  await page.route('**/api/camera/frames', (route) => route.fulfill({ json: stats(++frames) }));
  await prepare(page, { voice: true, automatic: true });
  await expect.poll(() => frames).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(true);
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await page.evaluate(() => window.__voiceTest.recognize('Hello'));
  await expect.poll(() => page.evaluate(() => window.__voiceTest.spoken)).toContain(GREETING);
  expect((await cameraState(page)).stopped).toBe(0);
  await page.evaluate(() => window.__voiceTest.finishSpeech());
  await expect.poll(() => page.evaluate(() => window.__voiceTest.recordings)).toBe(1);
  await page.getByRole('button', { name: 'Turn off Muse voice', exact: true }).click();
  expect((await cameraState(page)).stopped).toBe(0);
  await page.getByRole('button', { name: 'Stop scanning', exact: true }).click();
  expect((await cameraState(page)).stopped).toBe(1);
  await page.getByRole('button', { name: 'Our memory', exact: true }).click();
  expect((await cameraState(page)).streams).toBe(1);
});

test('camera-only mode uses actual backend quality checks without model or object writes', async ({
  page,
}) => {
  await prepare(page, { vision: false });
  await openCamera(page);
  const token = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem('commonplace-guest-session')!).token,
  );
  const headers = { Authorization: `Bearer ${token}` };
  const before = await (await page.request.get('/api/objects', { headers })).json();
  await page.getByRole('button', { name: 'Start camera preview', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Backend frame quality' })).toBeVisible();
  expect(await (await page.request.get('/api/objects', { headers })).json()).toEqual(before);
  await page.getByRole('button', { name: 'Household', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('textbox', { name: 'Your name' })
    .fill('Next camera user');
  await page.getByRole('button', { name: 'Switch guest', exact: true }).click();
  await expect(page.locator('.profile strong')).toHaveText('Next camera user');
  await expect(
    page.getByRole('button', { name: 'Stop camera preview', exact: true }),
  ).toBeEnabled();
  expect((await cameraState(page)).streams).toBe(2);
  expect((await cameraState(page)).stopped).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'test-results/camera-page-mobile.png', fullPage: true });
});

test('front-camera/JPEG settings and 3-second interval are sent to the backend', async ({
  page,
}) => {
  let body = '';
  await page.route('**/api/camera/frames', (route) => {
    body = route.request().postData()!;
    return route.fulfill({ json: stats(1) });
  });
  await prepare(page);
  await openCamera(page);
  await page.getByRole('combobox', { name: 'Choose camera' }).selectOption('user');
  await page.getByRole('combobox', { name: 'Camera capture interval' }).selectOption('3');
  await page.getByRole('slider', { name: 'JPEG compression quality' }).fill('42');
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Backend frame quality' })).toBeVisible();
  const state = await cameraState(page);
  expect(state.jpegQuality).toBe(0.42);
  expect(state.constraints[0].video).toMatchObject({ facingMode: { ideal: 'user' } });
  expect(body).toContain('name="analysis_interval"\r\n\r\n3');
});

test('slow frame ingestion skips busy ticks and stop ignores late responses', async ({ page }) => {
  let frames = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/camera/frames', async (route) => {
    frames++;
    await held;
    await route.fulfill({ json: stats(frames) }).catch(() => {});
  });
  await prepare(page);
  await openCamera(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect.poll(() => frames).toBe(1);
  await page.clock.runFor(16000);
  expect(frames).toBe(1);
  await page.getByRole('button', { name: 'Stop scanning', exact: true }).click();
  release();
  await page.clock.runFor(16000);
  expect(frames).toBe(1);
  await expect(page.getByText('Processed frames: 0', { exact: false })).toBeVisible();
});

test('processing status returns to the normal message and camera continues on another screen', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let frames = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/camera/frames', async (route) => {
    frames++;
    if (frames === 1) await held;
    await route.fulfill({ json: stats(frames) });
  });
  await prepare(page, { vision: false });
  await openCamera(page);
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole('button', { name: 'Start camera preview', exact: true }).click();
  await expect(page.getByText('Processing a frame…', { exact: true })).toBeVisible();
  release();
  await expect(page.getByText('Processing a frame…', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Household camera', exact: true }).getByRole('status'),
  ).toContainText('Camera frame checked.');
  await expect(page.getByRole('region', { name: 'Backend frame quality' })).toBeVisible();
  await page.getByRole('button', { name: 'Our memory', exact: true }).click();
  await page.clock.runFor(5100);
  await expect.poll(() => frames).toBe(2);
  await expect(page.getByText('Camera on · Capture every 5 seconds')).toBeVisible();
  expect((await cameraState(page)).streams).toBe(1);
  expect(errors).toEqual([]);
});

test('incomplete camera responses show a recoverable error without crashing the UI', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/camera/frames', (route) => route.fulfill({ json: { quality: null } }));
  await prepare(page, { vision: false });
  await openCamera(page);
  await page.getByRole('button', { name: 'Start camera preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('camera API returned an unexpected response');
  await expect(
    page.getByRole('button', { name: 'Start camera preview', exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Backend frame quality' })).toHaveCount(0);
  expect((await cameraState(page)).stopped).toBe(1);
  expect(errors).toEqual([]);
});

test('hiding the site stops the camera and wake listening', async ({ page }) => {
  await page.route('**/api/camera/frames', (route) => route.fulfill({ json: stats(1) }));
  await prepare(page, { voice: true, automatic: true });
  await expect.poll(() => cameraState(page).then((state) => state.streams)).toBe(1);
  await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => cameraState(page).then((state) => state.stopped)).toBe(1);
  await expect.poll(() => page.evaluate(() => !!window.__voiceTest.wake)).toBe(false);
});

test('denied camera permission remains recoverable without claiming capture is on', async ({
  page,
}) => {
  await prepare(page);
  await openCamera(page);
  await page.evaluate(() => {
    (window as unknown as { __cameraTest: { denied: boolean } }).__cameraTest.denied = true;
  });
  await page.getByRole('button', { name: 'Start scanning', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Camera permission was denied');
  await expect(page.getByText('Camera off · Capture every 5 seconds')).toBeVisible();
});

test('short desktop sidebar scrolls and keeps the user profile reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 500 });
  await page.goto('/');
  await joinAsGuest(page, 'Sidebar user');
  const sidebar = page.locator('.sidebar');
  expect(await sidebar.evaluate((element) => getComputedStyle(element).overflowY)).toBe('auto');
  await sidebar.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const profile = await page.locator('.profile').boundingBox();
  expect(profile!.y).toBeGreaterThanOrEqual(0);
  expect(profile!.y + profile!.height).toBeLessThanOrEqual(500);
  await page.screenshot({ path: 'test-results/sidebar-short.png' });
});
