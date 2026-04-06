import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:4026',
    headless: true,
    viewport: { width: 390, height: 844 }, // iPhone 14 Pro
    locale: 'en-US',
  },
  webServer: {
    command: 'npm run dev',
    port: 4026,
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
