import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: {
      // Audio must be able to start without a real user gesture in headless runs.
      args: ['--autoplay-policy=no-user-gesture-required'],
      // Use a preinstalled Chromium when one is provided (e.g. sandboxes without downloads).
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
    },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      testIgnore: /mobile/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, testMatch: /mobile/ },
  ],
  webServer: {
    command: `npm run build && node dist-server/index.mjs`,
    url: `http://localhost:${PORT}/api/health`,
    env: { PORT: String(PORT), ANTHROPIC_API_KEY: '' },
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
