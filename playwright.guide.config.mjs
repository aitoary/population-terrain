import { defineConfig } from '@playwright/test';
import shared from './playwright.share.config.mjs';

const dev = process.env.SHARE_DEV === '1';
const acceptance = !dev && process.env.GUIDE_ACCEPTANCE === '1';
const mode = dev ? 'dev' : acceptance ? 'acceptance' : 'preview';

// Separate bounded runs keep the existing share suite within its 300s limit.
export default defineConfig({
  ...shared,
  testMatch: 'featured_locations.browser.mjs',
  outputDir: `artifacts/featured-locations-${mode}`,
  reporter: [['line'], ['json', { outputFile: `artifacts/browser-featured-locations-${mode}.json` }]],
  use: {
    ...shared.use,
    // Use Chrome's normal graphics backend for the final destination views.
    // Forced SwiftShader can keep coastal terrain refinement pending on this Mac.
    launchOptions: { ...shared.use.launchOptions, args: [] },
  },
  webServer: acceptance ? {
    ...shared.webServer,
    command: 'npm run preview -- --outDir dist-acceptance --host 127.0.0.1 --port 4174 --strictPort',
  } : shared.webServer,
});
