import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', workers: 1, retries: 0, reporter: 'list', timeout: 45000,
  outputDir: 'verification/browser-artifacts',
  use: { baseURL: 'http://127.0.0.1:3211', browserName: 'chromium', channel: 'chrome', headless: true, viewport: { width: 1440, height: 1080 }, screenshot: 'only-on-failure' },
  globalSetup: './tests/browser/setup.mjs',
});
