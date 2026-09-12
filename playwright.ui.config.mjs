import { defineConfig } from '@playwright/test';
import shared from './playwright.share.config.mjs';

const acceptance = process.env.UI_ACCEPTANCE === '1';
const mode = acceptance ? 'acceptance' : 'preview';

export default defineConfig({
  ...shared,
  testMatch: 'ui_flow.browser.mjs',
  outputDir: `artifacts/ui-flow-${mode}`,
  reporter: [['line'], ['json', { outputFile: `artifacts/browser-ui-flow-${mode}.json` }]],
  use: { ...shared.use, launchOptions: { ...shared.use.launchOptions, args: [] } },
  webServer: acceptance ? {
    ...shared.webServer,
    command: 'npm run preview -- --outDir dist-acceptance --host 127.0.0.1 --port 4174 --strictPort',
  } : shared.webServer,
});
