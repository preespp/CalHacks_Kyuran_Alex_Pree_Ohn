import { defineConfig } from '@playwright/test';

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
      command: '.venv/bin/python -m uvicorn commonplace_api.main:app --host 127.0.0.1 --port 8011',
      url: 'http://127.0.0.1:8011/api/health',
      env: {
        DATA_DIR: `.data/browser-tests/${Date.now()}`,
        VISION_PROVIDER: 'demo',
        ASSISTANT_PROVIDER: 'disabled',
        STORAGE_PROVIDER: 'local',
        APP_ENV: 'development',
      },
      reuseExistingServer: false,
    },
    {
      command:
        '.venv/bin/python -m uvicorn commonplace_api.assistant_lab:app --host 127.0.0.1 --port 8012',
      url: 'http://127.0.0.1:8012/api/lab/health',
      env: {
        APP_ENV: 'development',
        MODEL_API_KEY: 'browser-test-key-not-real',
        META_MODEL: 'muse-test',
      },
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev --workspace @commonplace/web -- --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      env: {
        API_PROXY_TARGET: 'http://127.0.0.1:8011',
        MUSE_PROXY_TARGET: 'http://127.0.0.1:8012',
        VITE_MUSE_LAB_ONLY: 'false',
      },
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev --workspace @commonplace/web -- --port 5175 --strictPort',
      url: 'http://127.0.0.1:5175',
      env: {
        API_PROXY_TARGET: 'http://127.0.0.1:8011',
        MUSE_PROXY_TARGET: 'http://127.0.0.1:8012',
        VITE_MUSE_LAB_ONLY: 'true',
      },
      reuseExistingServer: false,
    },
  ],
});
