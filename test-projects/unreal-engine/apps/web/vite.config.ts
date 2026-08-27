import { defineConfig } from 'vite';
import { resolve } from 'path';

/**
 * Vite config for the Web Engine browser client.
 *
 * The client talks to `apps/server` through a same-origin `/api` prefix:
 * the dev server proxies it (and the `/ws` WebSocket upgrade) to the API
 * origin below, so no CORS configuration is needed while developing.
 * `apps/server` mounts its routes at the root (`/projects`, `/auth/login`,
 * `/manifest.json`, …), hence the `^/api` rewrite rather than a prefix.
 *
 * Set `WEB_ENGINE_API_ORIGIN` to point the proxy at another instance
 * (`apps/server` defaults to `PORT=3000`).
 */
const API_ORIGIN = process.env['WEB_ENGINE_API_ORIGIN'] ?? 'http://127.0.0.1:3000';

export default defineConfig({
  root: '.',
  base: './',
  resolve: {
    /* Workspace packages are linked sources; keep their module identity
       stable so `@web-engine/engine-core` never resolves twice. */
    dedupe: ['@web-engine/engine-core', '@web-engine/engine-renderer'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
  server: {
    port: 5173,
    host: true,
    /*
    | Extra hostnames the dev server answers for. Vite rejects any host it does
    | not know (DNS-rebinding protection), so a tunnel or a LAN address — the
    | normal way to look at a WebGL canvas on a second machine — has to be
    | named. Entries may be exact hosts or a domain suffix starting with '.'.
    | Left unset by default: `vite` on localhost needs nothing extra.
    */
    allowedHosts: process.env['WEB_ENGINE_ALLOWED_HOSTS']
      ?.split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
    proxy: {
      '/api': {
        target: API_ORIGIN,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  preview: {
    port: 4173,
    host: true,
  },
});
