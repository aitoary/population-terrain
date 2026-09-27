import { defineConfig } from '@playwright/test';
import shared from './playwright.share.config.mjs';

const dev = process.env.SHARE_DEV === '1';
const acceptance = !dev && process.env.GUIDE_ACCEPTANCE === '1';
const mode = dev ? 'dev' : acceptance ? 'acceptance' : 'preview';

// 個別に時間を制限して実行し、既存の共有リンク検証を300秒の上限内に収める。
export default defineConfig({
  ...shared,
  testMatch: 'featured_locations.browser.mjs',
  outputDir: `artifacts/featured-locations-${mode}`,
  reporter: [['line'], ['json', { outputFile: `artifacts/browser-featured-locations-${mode}.json` }]],
  use: {
    ...shared.use,
    // 最終到達視点では通常のChrome描画を使う。SwiftShaderを強制すると地形の精細化待機が終わらない場合がある。
    launchOptions: { ...shared.use.launchOptions, args: [] },
  },
  webServer: acceptance ? {
    ...shared.webServer,
    command: 'npm run preview -- --outDir dist-acceptance --host 127.0.0.1 --port 4174 --strictPort',
  } : shared.webServer,
});
