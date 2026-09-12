import { defineConfig } from '@playwright/test';

const dev = process.env.SHARE_DEV === '1';
const port = dev ? 5174 : 4174;
const mode = dev ? 'dev' : 'preview';

export default defineConfig({
  testDir: './scripts',
  testMatch: 'share_link.browser.mjs',
  workers: 1,
  timeout: 120_000,
  globalTimeout: 300_000,
  expect: { timeout: 15_000 },
  outputDir: `artifacts/share-links-${mode}`,
  reporter: [['line'], ['json', { outputFile: `artifacts/browser-share-links-${mode}.json` }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      chromiumSandbox: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: `npm run ${dev ? 'dev' : 'preview'} -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 25_000,
  },
});
