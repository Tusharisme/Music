import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { getRequestListener } from '@hono/node-server';

/**
 * Mounts the Hono API (server/app.ts) inside the Vite dev server so `npm run dev`
 * gives you the full app – UI + /api/ai/* – in one process. The module is loaded
 * through Vite's SSR loader, so edits to the server code apply without a restart.
 */
function apiDevPlugin(): Plugin {
  return {
    name: 'mixmind-api-dev',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next();
        try {
          const mod = (await server.ssrLoadModule('/server/app.ts')) as typeof import('./server/app');
          await getRequestListener(mod.app.fetch)(req, res);
        } catch (err) {
          server.config.logger.error(`[api] ${(err as Error).stack ?? err}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end('API error');
          }
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Expose server-only secrets from .env to the dev API without leaking them to the client bundle.
  const env = loadEnv(mode, process.cwd(), '');
  for (const key of ['ANTHROPIC_API_KEY', 'MIXMIND_AI_MODEL']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }

  return {
    base: process.env.BASE_PATH ?? '/',
    plugins: [
      react(),
      apiDevPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
        manifest: {
          name: 'MixMind – AI DJ Mixer',
          short_name: 'MixMind',
          description:
            'A two-deck DJ mixer in your browser with an AI copilot that suggests what to play next and mixes it for you.',
          theme_color: '#07080f',
          background_color: '#07080f',
          display: 'standalone',
          orientation: 'any',
          categories: ['music', 'entertainment'],
          icons: [
            { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
            { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
          navigateFallbackDenylist: [/^\/api\//],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        },
      }),
    ],
    worker: {
      format: 'es',
    },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 900,
    },
  };
});
