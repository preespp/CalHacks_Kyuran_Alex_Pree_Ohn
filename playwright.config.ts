import { defineConfig } from '@playwright/test';

const python = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : '.venv/bin/python';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `"${python}" -m uvicorn commonplace_api.main:app --host 127.0.0.1 --port 8011`,
      url: 'http://127.0.0.1:8011/api/health',
      env: {
        DATA_DIR: `.data/browser-tests/${Date.now()}`,
        VISION_PROVIDER: 'demo',
        ASSISTANT_PROVIDER: 'disabled',
        STORAGE_PROVIDER: 'local',
        APP_ENV: 'prototype',
        GUEST_PROFILE_STORE: 'local',
        CAMERA_FRAME_SINK: 'disabled',
        MEMORY_PROVIDER: 'sqlite',
        SEED_SAMPLE_DATA: 'true',
      },
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev --workspace @commonplace/web -- --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      env: {
        API_PROXY_TARGET: 'http://127.0.0.1:8011',
        VITE_MEDIA_AUTOSTART: 'false',
      },
      reuseExistingServer: false,
    },
  ],
});
