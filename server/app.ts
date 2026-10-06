import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { streamSSE } from 'hono/streaming';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { describeError, runPicks, runSetPlan, streamChat } from '../src/ai/claude/core';
import { DEFAULT_MODEL_ID, MODELS } from '../src/ai/claude/models';
import {
  AiOptionsSchema,
  ChatRequestSchema,
  PicksRequestSchema,
  SetPlanRequestSchema,
} from '../src/ai/claude/schema';

/**
 * MixMind API. The Anthropic key never leaves the server: the browser sends DJ
 * context (decks, library summary) and gets suggestions back.
 */

const serverModel = () => {
  const m = process.env.MIXMIND_AI_MODEL;
  return MODELS.some((x) => x.id === m) ? (m as string) : DEFAULT_MODEL_ID;
};

let client: Anthropic | null = null;
const anthropic = (): Anthropic => {
  if (!client) client = new Anthropic();
  return client;
};
const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

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

function options(body: unknown) {
  const parsed = AiOptionsSchema.safeParse((body as { options?: unknown })?.options ?? {});
  const o = parsed.success ? parsed.data : {};
  // Only allow models from the allow-list; default to the server's choice.
  return { model: MODELS.some((m) => m.id === o.model) ? o.model : serverModel(), effort: o.effort ?? 'low' };
}

export const app = new Hono().basePath('/api');

app.use('*', bodyLimit({ maxSize: 512 * 1024, onError: (c) => c.json({ error: 'Request too large' }, 413) }));

app.get('/health', (c) =>
  c.json({ ok: true, ai: hasKey(), model: serverModel(), models: MODELS.map((m) => m.id) }),
);

async function guarded<T extends z.ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<{ data: z.infer<T>; raw: unknown } | Response> {
  if (!hasKey()) return c.json({ error: 'The server has no ANTHROPIC_API_KEY configured.' }, 503);
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
  return { data: parsed.data, raw };
}

app.post('/ai/picks', async (c) => {
  const g = await guarded(c, PicksRequestSchema);
  if (g instanceof Response) return g;
  try {
    return c.json(await runPicks(anthropic(), g.data, options(g.raw)));
  } catch (err) {
    const e = describeError(err);
    return c.json({ error: e.message }, e.status as 400);
  }
});

app.post('/ai/setplan', async (c) => {
  const g = await guarded(c, SetPlanRequestSchema);
  if (g instanceof Response) return g;
  try {
    return c.json(await runSetPlan(anthropic(), g.data, options(g.raw)));
  } catch (err) {
    const e = describeError(err);
    return c.json({ error: e.message }, e.status as 400);
  }
});

app.post('/ai/chat', async (c) => {
  const g = await guarded(c, ChatRequestSchema);
  if (g instanceof Response) return g;
  const opts = options(g.raw);
  return streamSSE(c, async (stream) => {
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());
    try {
      await streamChat(
        anthropic(),
        g.data,
        opts,
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
