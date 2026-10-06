import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { createBackend, type BackendConfig } from '../src/ai/llm/backend';
import { describeError } from '../src/ai/llm/errors';
import { runPicks, runSetPlan, streamChat } from '../src/ai/llm/core';
import { CLAUDE_MODELS, isProviderId, providerInfo, type ProviderId } from '../src/ai/llm/providers';
import {
  AiOptionsSchema,
  ChatRequestSchema,
  PicksRequestSchema,
  SetPlanRequestSchema,
} from '../src/ai/llm/schema';

/**
 * MixMind API. AI keys never leave the server: the browser sends DJ context (decks, library
 * summary) and gets suggestions back. The provider comes from the environment – any of the
 * free ones (Gemini, Groq, OpenRouter, a local Ollama) or Claude.
 */

const KEY_VARS: Partial<Record<ProviderId, string>> = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

/** AI_PROVIDER if set, otherwise the first provider whose key is present. */
export function serverConfig(env: Record<string, string | undefined> = process.env): BackendConfig | null {
  const chosen = env.AI_PROVIDER?.trim().toLowerCase();
  let id: ProviderId | undefined;
  if (chosen) id = isProviderId(chosen) ? chosen : undefined;
  else id = (Object.keys(KEY_VARS) as ProviderId[]).find((p) => env[KEY_VARS[p]!]);
  if (!id) return null;
  const p = providerInfo(id);
  const apiKey = (KEY_VARS[id] && env[KEY_VARS[id]!]) || env.AI_API_KEY || '';
  const baseUrl = env.AI_BASE_URL || p.baseUrl;
  if ((p.needsKey && !apiKey) || (p.kind === 'openai' && !baseUrl)) return null;
  const model = env.AI_MODEL || p.defaultModel;
  if (!model) return null;
  return { provider: id, apiKey, baseUrl, model };
}

// ---- tiny in-memory rate limiter (per IP, sliding window)
const WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS = Number(process.env.MIXMIND_RATE_LIMIT ?? 40);
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
  return list.length > MAX_REQUESTS;
}

function clientIp(c: Context): string {
  const fwd = c.req.header('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? 'local';
}

/** The server's backend for one request; Claude callers may pick a model from the allow-list. */
async function backendFor(cfg: BackendConfig, body: unknown) {
  const parsed = AiOptionsSchema.safeParse((body as { options?: unknown })?.options ?? {});
  const o = parsed.success ? parsed.data : {};
  const model =
    cfg.provider === 'anthropic' && CLAUDE_MODELS.some((m) => m.id === o.model) ? o.model : cfg.model;
  return createBackend({ ...cfg, model, effort: o.effort ?? 'low' });
}

export const app = new Hono().basePath('/api');

app.use('*', bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: 'Request too large' }, 413) }));

app.get('/health', (c) => {
  const cfg = serverConfig();
  return c.json({ ok: true, ai: Boolean(cfg), provider: cfg?.provider ?? null, model: cfg?.model ?? null });
});

async function guarded<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<{ data: z.infer<T>; raw: unknown; cfg: BackendConfig } | Response> {
  const cfg = serverConfig();
  if (!cfg) return c.json({ error: 'The server has no AI key configured.' }, 503);
  if (rateLimited(clientIp(c))) return c.json({ error: 'Too many AI requests – slow down a little.' }, 429);
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return c.json({ error: 'Invalid request', issues: parsed.error.issues.slice(0, 5) }, 400);
  return { data: parsed.data, raw, cfg };
}

app.post('/ai/picks', async (c) => {
  const g = await guarded(c, PicksRequestSchema);
  if (g instanceof Response) return g;
  try {
    return c.json(await runPicks(await backendFor(g.cfg, g.raw), g.data));
  } catch (err) {
    const e = describeError(err);
    return c.json({ error: e.message }, e.status as 400);
  }
});

app.post('/ai/setplan', async (c) => {
  const g = await guarded(c, SetPlanRequestSchema);
  if (g instanceof Response) return g;
  try {
    return c.json(await runSetPlan(await backendFor(g.cfg, g.raw), g.data));
  } catch (err) {
    const e = describeError(err);
    return c.json({ error: e.message }, e.status as 400);
  }
});

app.post('/ai/chat', async (c) => {
  const g = await guarded(c, ChatRequestSchema);
  if (g instanceof Response) return g;
  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());
    try {
      await streamChat(
        await backendFor(g.cfg, g.raw),
        g.data,
        (delta) => void stream.writeSSE({ data: JSON.stringify({ type: 'text', text: delta }) }),
        abort.signal,
      );
      await stream.writeSSE({ data: JSON.stringify({ type: 'done' }) });
    } catch (err) {
      const e = describeError(err);
      await stream.writeSSE({
        data: JSON.stringify({ type: 'error', message: e.message, status: e.status }),
      });
    }
  });
});
