import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import excludedAssets from './scripts/cesium-excluded-assets.json' with { type: 'json' };

// Cesium公式のVite構成に合わせ、実行に必要な4ディレクトリを配布物へコピーする。
const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesium';

export default defineConfig(({ mode }) => ({
  build: { outDir: mode === 'acceptance' ? 'dist-acceptance' : 'dist' },
  plugins: [
    react(),
    {
      name: 'distribution-provenance',
      generateBundle(_options, bundle) {
        const modules = Object.values(bundle).flatMap((item) => item.type === 'chunk'
          ? Object.entries(item.modules).filter(([, info]) => info.renderedLength > 0).map(([id]) => id.split('node_modules/')[1]).filter((id): id is string => Boolean(id))
          : []);
        mkdirSync('artifacts', { recursive: true });
        writeFileSync('artifacts/bundle-modules.json', JSON.stringify([...new Set(modules)].sort(), null, 2));
      },
    },
    viteStaticCopy({
      targets: [
        { src: 'docs/population-terrain-architecture.html', dest: 'docs', rename: { stripBase: 1 } },
        ...['Workers', 'Assets', 'ThirdParty', 'Widgets'].map((directory) => ({
          // 除外済み画像だけを省けるよう、コピー対象をファイル単位で照合する。
          src: [`${cesiumSource}/${directory}/**/*`, ...excludedAssets.map((file) => `!${cesiumSource}/${file}`)],
          dest: cesiumBaseUrl,
          // static-copy v4は元のパス接頭辞を残すため、Cesium以下だけが配布されるよう削る。
          rename: { stripBase: cesiumSource.split('/').length },
        })),
      ],
    }),
  ],
  define: { CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}/`), __ACCEPTANCE__: mode === 'acceptance' },
  server: {
    host: '127.0.0.1',
    fs: {
      // Vite標準の機密ファイル除外を維持し、原本データも開発サーバーから公開しない。
      deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/data/raw/**'],
    },
  },
  preview: { host: '127.0.0.1' },
}));
