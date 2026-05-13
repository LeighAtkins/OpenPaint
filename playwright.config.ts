import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const localNodeBin = path.resolve(process.cwd(), '.agent/tools/node-v22.12.0-linux-x64/bin/node');
const nodeBin = fs.existsSync(localNodeBin) ? localNodeBin : process.execPath;
const nodeBinDir = path.dirname(nodeBin);
const webServerScript = path.resolve(process.cwd(), 'scripts/playwright-dev-server.mjs');
const webServerCommand = `PATH="${nodeBinDir}:$PATH" "${nodeBin}" "${webServerScript}"`;

export default defineConfig({
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'visual',
      testDir: './tests/visual',
      use: {
        browserName: 'chromium',
        viewport: { width: 800, height: 600 },
      },
    },
    {
      name: 'e2e',
      testDir: './tests/e2e',
      use: {
        browserName: 'chromium',
        baseURL: 'http://127.0.0.1:5173',
        viewport: { width: 1280, height: 800 },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
      },
    },
  ],
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  webServer: {
    command: webServerCommand,
    port: 5173,
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
});
