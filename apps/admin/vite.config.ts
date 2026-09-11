import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const fromHere = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    /**
     * Resolve the workspace packages to their source rather than their built `dist`.
     *
     * Reading from `dist` means every change to a translation or a domain rule needs a rebuild
     * before it shows up here, and a forgotten rebuild looks like a missing translation rather
     * than a stale build. `tsconfig.json` carries the same two paths so the compiler and the
     * bundler are never looking at different files.
     */
    alias: {
      '@nasl/i18n': fromHere('../../packages/i18n/src/index.ts'),
      '@nasl/shared': fromHere('../../packages/shared/src/index.ts'),
    },
    // A workspace can easily end up with React hoisted at the root and again under an app.
    // Two copies in one tree makes every hook read null internals.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5174,
    proxy: {
      '/v1': { target: process.env.VITE_API_URL ?? 'http://localhost:4000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
