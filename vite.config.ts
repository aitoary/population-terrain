import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Match Cesium's official Vite example; all four directories are needed in dist too.
const cesiumSource = 'node_modules/cesium/Build/Cesium';
const cesiumBaseUrl = 'cesium';

export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: ['Workers', 'Assets', 'ThirdParty', 'Widgets'].map((directory) => ({
        src: `${cesiumSource}/${directory}`,
        dest: cesiumBaseUrl,
        // static-copy v4 preserves the source prefix; keep only the Cesium subtree.
        rename: { stripBase: cesiumSource.split('/').length },
      })),
    }),
  ],
  define: { CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}/`) },
  server: {
    host: '127.0.0.1',
    fs: {
      // Retain Vite's sensitive-file exclusions and keep originals off the dev server too.
      deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/data/raw/**'],
    },
  },
  preview: { host: '127.0.0.1' },
});
