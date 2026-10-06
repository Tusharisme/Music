import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { app as api, serverConfig } from './app';
import { providerInfo } from '../src/ai/llm/providers';

/** Production server: the built web app (dist/) plus the AI API. */
const root = new Hono();
root.route('/', api);
root.use(
  '/assets/*',
  serveStatic({
    root: './dist',
    onFound: (_path, c) => {
      c.header('Cache-Control', 'public, max-age=31536000, immutable');
    },
  }),
);
root.use('/*', serveStatic({ root: './dist' }));
// SPA fallback.
root.get('*', serveStatic({ path: './dist/index.html' }));

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: root.fetch, port, hostname: process.env.HOST ?? '0.0.0.0' }, (info) => {
  const cfg = serverConfig();
  const ai = cfg
    ? `AI copilot: ${providerInfo(cfg.provider).label}, ${cfg.model}`
    : 'no AI key set – visitors can still connect the copilot with their own (free) key';
  console.log(`MixMind running on http://localhost:${info.port} (${ai})`);
});
