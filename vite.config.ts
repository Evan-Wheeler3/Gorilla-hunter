import { defineConfig } from 'vite';

// base './' so the built game works from any static host path (e.g. GitHub Pages).
export default defineConfig({
  base: './',
  server: { host: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
});
