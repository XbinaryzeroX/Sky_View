/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const cesiumSource = 'node_modules/cesium/Build/Cesium';

export default defineConfig({
  root: '.',
  base: '/',
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/Workers`, dest: 'cesium', rename: { stripBase: 4 } },
        { src: `${cesiumSource}/ThirdParty`, dest: 'cesium', rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Assets`, dest: 'cesium', rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Widgets`, dest: 'cesium', rename: { stripBase: 4 } },
      ],
    }),
  ],
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
