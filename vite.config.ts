import { defineConfig } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import excludedAssets from './scripts/cesium-excluded-assets.json' with { type: 'json' };

// Match Cesium's official Vite example; all four directories are needed in dist too.
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
      targets: ['Workers', 'Assets', 'ThirdParty', 'Widgets'].map((directory) => ({
        // Match files individually so only the reviewed unused images are excluded.
                src: [`${cesiumSource}/${directory}/**/*`, ...excludedAssets.map((file) => `!${cesiumSource}/${file}`)],
        dest: cesiumBaseUrl,
        // static-copy v4 preserves the source prefix; keep only the Cesium subtree.
        rename: { stripBase: cesiumSource.split('/').length },
      })),
    }),
  ],
  define: { CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}/`), __ACCEPTANCE__: mode === 'acceptance' },
  server: {
    host: '127.0.0.1',
    fs: {
      // Retain Vite's sensitive-file exclusions and keep originals off the dev server too.
      deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/data/raw/**'],
    },
  },
  preview: { host: '127.0.0.1' },
}));
