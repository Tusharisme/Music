import { z } from 'zod';
import type { Backend, BackendConfig, JsonTask } from './backend';
import { AiError } from './errors';
import { providerInfo, type ProviderId, type ProviderInfo } from './providers';

/**
 * Client for OpenAI-style chat-completion APIs (Gemini, Groq, OpenRouter, Ollama…) on plain
 * fetch, so it runs the same in the browser and on the server. Free models differ in what they
 * accept, so JSON answers step down from a JSON schema to JSON mode to a JSON-only prompt, and
 * the client remembers what each model took.
 */

type JsonMode = 'schema' | 'object' | 'prompt';
const MODES: JsonMode[] = ['schema', 'object', 'prompt'];

const learned = new Map<string, { mode?: JsonMode; noReasoning?: boolean }>();

/** Models that were just overloaded or rate-limited, skipped for a minute. */
const busyUntil = new Map<string, number>();
const BUSY_MS = 60_000;

const JSON_TIMEOUT_MS = 90_000;
const CHAT_TIMEOUT_MS = 120_000;

interface Completion {
  choices?: { message?: { content?: unknown }; finish_reason?: string }[];
}
interface Chunk {
  choices?: { delta?: { content?: unknown } }[];
  error?: unknown;
}

function resolve(cfg: BackendConfig) {
  const p = providerInfo(cfg.provider);
  const base = (cfg.baseUrl || p.baseUrl).trim().replace(/\/+$/, '');
  if (!base) throw new AiError(`Enter the address of your AI service in Settings → AI.`, 400, '', 'setup');
  const headers: Record<string, string> = {};
  if (cfg.apiKey.trim()) headers.authorization = `Bearer ${cfg.apiKey.trim()}`;
  if (p.id === 'openrouter') headers['x-title'] = 'MixMind';
  const doFetch: typeof fetch = cfg.fetch ?? ((input, init) => fetch(input, init));
  return { p, base, headers, doFetch };
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal;
}

function networkError(err: unknown, p: ProviderInfo): unknown {
  if (err instanceof AiError) return err;
  if (err instanceof Error && err.name === 'AbortError') return err;
  if (err instanceof Error && err.name === 'TimeoutError')
    return new AiError(`${p.label} took too long to answer – try again.`, 504, '', 'network');
  const hint =
    p.id === 'ollama'
      ? ' – is Ollama running? (From a website, start it with OLLAMA_ORIGINS=*.)'
      : p.id === 'custom'
        ? ' – check its address in Settings → AI (it must allow requests from this page).'
        : ' – check your internet connection.';
  return new AiError(
    `Couldn't reach ${p.label}${hint}`,
    502,
    err instanceof Error ? err.message : '',
    'network',
  );
}

/** The message inside an error body: `{error: {message}}`, Gemini's `[{error}]`, or plain text. */
export function errorText(raw: unknown): string {
  let j = raw;
  if (typeof raw === 'string') {
    try {
      j = JSON.parse(raw);
    } catch {
      return raw.trim().slice(0, 300);
    }
  }
  if (Array.isArray(j)) j = j[0];
  if (!j || typeof j !== 'object') return '';
  const e = (j as { error?: unknown }).error ?? j;
  if (typeof e === 'string') return e.slice(0, 300);
  if (!e || typeof e !== 'object') return '';
  const { message, metadata } = e as { message?: unknown; metadata?: { raw?: unknown } };
  const msg = typeof message === 'string' ? message : '';
  const extra =
    typeof metadata?.raw === 'string' && metadata.raw !== msg ? ` (${metadata.raw.slice(0, 200)})` : '';
  return (msg + extra).slice(0, 400);
}

async function httpError(r: Response, p: ProviderInfo, model: string): Promise<AiError> {
  const detail = errorText(await r.text().catch(() => '')) || r.statusText || `HTTP ${r.status}`;
  const low = detail.toLowerCase();
  const aboutFeature = /response_format|json|schema|reasoning|stream|tool/.test(low);
  if (r.status === 401 || r.status === 403 || /api key|api_key|apikey|unauthori[sz]ed|authenticat/.test(low))
    return new AiError(
      `${p.label} didn't accept the API key – check it in Settings → AI.`,
      401,
      detail,
      'auth',
    );
  if (
    r.status === 404 ||
    (!aboutFeature &&
      /model.{0,80}(not found|does not exist|decommissioned|no longer|not available)/.test(low))
  )
    return new AiError(
      `The model "${model}" isn't available on ${p.label} – pick another in Settings → AI.`,
      404,
      detail,
      'model',
    );
  if (
    r.status === 413 ||
    /too large|context length|context window|maximum context|tokens per minute/.test(low)
  )
    return new AiError(
      `That was too much for ${p.label} in one go – wait a minute, or choose a model with a bigger allowance.`,
      413,
      detail,
      'size',
    );
  if (r.status === 429 || r.status === 402)
    return new AiError(
      /per.?day|daily|quota|credits/.test(low)
        ? `Today's free ${p.label} allowance is used up – try later or switch provider in Settings → AI.`
        : `${p.label} is busy or rate-limiting (free tiers allow a few requests a minute) – try again shortly.`,
      429,
      detail,
      'limit',
    );
  if (r.status >= 500)
    return new AiError(
      `${p.label} is having trouble right now – try again shortly.`,
      503,
      detail,
      'provider',
    );
  return new AiError(`${p.label} rejected the request: ${detail.slice(0, 200)}`, 400, detail, 'rejected');
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c) =>
      typeof c === 'string'
        ? c
        : typeof (c as { text?: unknown })?.text === 'string'
          ? (c as { text: string }).text
          : '',
    )
    .join('');
}

/** Drop `<think>…</think>` reasoning that some models put in the answer itself. */
export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
}

/** The same, for a stream: holds back partial tags across chunks. */
export function thinkFilter() {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let inThink = false;
  let pending = '';
  const partial = (s: string, tag: string) => {
    for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (tag.startsWith(s.slice(-k))) return k;
    return 0;
  };
  return {
    push(chunk: string): string {
      pending += chunk;
      let out = '';
      for (;;) {
        if (inThink) {
          const end = pending.indexOf(CLOSE);
          if (end < 0) {
            pending = pending.slice(-(CLOSE.length - 1));
            return out;
          }
          pending = pending.slice(end + CLOSE.length);
          inThink = false;
        } else {
          const start = pending.indexOf(OPEN);
          if (start < 0) {
            const keep = partial(pending, OPEN);
            out += pending.slice(0, pending.length - keep);
            pending = pending.slice(pending.length - keep);
            return out;
          }
          out += pending.slice(0, start);
          pending = pending.slice(start + OPEN.length);
          inThink = true;
        }
      }
    },
    flush(): string {
      const out = inThink ? '' : pending;
      pending = '';
      return out;
    },
  };
}

/** JSON from a model reply: bare, in a ```json fence, or the outermost {...}. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  const attempts = [
    t,
    /```(?:json)?\s*([\s\S]*?)```/i.exec(t)?.[1],
    t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1),
  ];
  for (const a of attempts) {
    if (!a) continue;
    try {
      return JSON.parse(a);
    } catch {
      // try the next form
    }
  }
  return undefined;
}

/** `data:` payloads of a server-sent-events stream. */
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let data: string[] = [];
  const line = function* (l: string): Generator<string> {
    if (l === '') {
      if (data.length) yield data.join('\n');
      data = [];
    } else if (l.startsWith('data:')) data.push(l.slice(5).replace(/^ /, ''));
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        yield* line(l);
      }
    }
    yield* line(buf + dec.decode());
    yield* line('');
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const s = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete s.$schema;
  return s;
}

export function openAiBackend(cfg: BackendConfig): Backend {
  const { p, base, headers, doFetch } = resolve(cfg);
  const model = (cfg.model || p.defaultModel).trim();
  if (!model) throw new AiError(`Choose a model for ${p.label} in Settings → AI.`, 400, '', 'setup');
  const memoKey = `${p.id}|${base}|${model}`;
  const memo = learned.get(memoKey) ?? {};
  learned.set(memoKey, memo);

  // The chosen model first, then the provider's fallbacks; recently busy ones go last.
  const candidates = [model, ...p.fallbackModels.filter((m) => m !== model)];
  const isBusy = (m: string) => (busyUntil.get(`${base}|${m}`) ?? 0) > Date.now();

  async function post(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    let last: unknown = null;
    for (const m of [...candidates.filter((c) => !isBusy(c)), ...candidates.filter(isBusy)]) {
      let r: Response;
      try {
        r = await doFetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ ...body, model: m }),
          signal,
        });
      } catch (err) {
        throw networkError(err, p);
      }
      if (r.ok) return r;
      const err = await httpError(r, p, m);
      // Overloaded or rate-limited: another free model usually has room.
      if (err.code !== 'limit' && !(err.code === 'provider' && err.status === 503)) throw err;
      busyUntil.set(`${base}|${m}`, Date.now() + BUSY_MS);
      last = err;
    }
    throw last;
  }

  const rejectsReasoning = (err: unknown) =>
    err instanceof AiError && err.code === 'rejected' && /reason|thinking/i.test(err.detail);

  async function json(task: JsonTask): Promise<unknown> {
    let reasoning = p.lowReasoning && !memo.noReasoning;
    let i = Math.max(0, MODES.indexOf(memo.mode ?? 'schema'));
    for (;;) {
      const mode = MODES[i];
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: `${task.system}\n\n${task.library}` },
          { role: 'user', content: `${task.prompt}\n\n${task.shape}` },
        ],
        max_tokens: p.maxTokens,
      };
      if (mode === 'schema')
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: task.name, strict: false, schema: jsonSchema(task.schema) },
        };
      else if (mode === 'object') body.response_format = { type: 'json_object' };
      if (reasoning) body.reasoning_effort = 'low';
      try {
        const r = await post(body, withTimeout(task.signal, JSON_TIMEOUT_MS));
        const choice = ((await r.json().catch(() => ({}))) as Completion).choices?.[0];
        const text = stripThink(contentText(choice?.message?.content));
        const parsed = parseJsonLoose(text);
        if (parsed === undefined)
          throw new AiError(
            choice?.finish_reason === 'length'
              ? `${p.label}'s answer was cut off – try again.`
              : `${p.label} didn't answer in the expected format – try again.`,
            502,
            text.slice(0, 300),
            'format',
          );
        memo.mode = mode;
        return parsed;
      } catch (err) {
        if (reasoning && rejectsReasoning(err)) {
          reasoning = false;
          memo.noReasoning = true;
          continue;
        }
        const stepDown = err instanceof AiError && (err.code === 'rejected' || err.code === 'format');
        if (stepDown && i < MODES.length - 1) {
          i++;
          continue;
        }
        throw networkError(err, p);
      }
    }
  }

  async function chat(
    task: Parameters<Backend['chat']>[0],
    onText: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    let reasoning = p.lowReasoning && !memo.noReasoning;
    const sig = withTimeout(signal, CHAT_TIMEOUT_MS);
    const body = () => ({
      model,
      messages: [
        { role: 'system', content: `${task.system}\n\n${task.library}\n\n${task.tail}` },
        ...task.messages,
      ],
      stream: true,
      max_tokens: p.maxTokens,
      ...(reasoning ? { reasoning_effort: 'low' } : {}),
    });
    let r: Response;
    try {
      r = await post(body(), sig);
    } catch (err) {
      if (!(reasoning && rejectsReasoning(err))) throw err;
      reasoning = false;
      memo.noReasoning = true;
      r = await post(body(), sig);
    }
    const filter = thinkFilter();
    let full = '';
    const emit = (s: string) => {
      const out = full ? s : s.replace(/^\s+/, '');
      if (!out) return;
      full += out;
      onText(out);
    };
    try {
      if (r.body && (r.headers.get('content-type') ?? '').includes('event-stream')) {
        for await (const data of sseData(r.body)) {
          if (data === '[DONE]') break;
          let j: Chunk;
          try {
            j = JSON.parse(data) as Chunk;
          } catch {
            continue;
          }
          if (j.error) {
            const msg = errorText(j);
            throw new AiError(`${p.label} stopped with an error: ${msg || 'unknown'}`, 502, msg, 'provider');
          }
          emit(filter.push(contentText(j.choices?.[0]?.delta?.content)));
        }
      } else {
        const j = (await r.json().catch(() => ({}))) as Completion;
        emit(filter.push(contentText(j.choices?.[0]?.message?.content)));
      }
    } catch (err) {
      throw networkError(err, p);
    }
    emit(filter.flush());
    if (!full.trim()) throw new AiError(`${p.label} sent an empty answer – try again.`, 502, '', 'format');
    return full;
  }

  return { label: p.label, maxTracks: p.maxTracks, json, chat };
}

// ---------------------------------------------------------------- model lists

const NOT_CHAT =
  /embed|whisper|tts|transcri|orpheus|guard|imagen|image|veo|lyria|moderation|rerank|aqa|live|audio|computer-use|robotics|deep-research|antigravity|nano-banana|omni|customtools/i;
/** Gemini's Pro models aren't on the free tier. */
const GEMINI_PAID = /(^|-)pro(-|$)/;

interface ModelEntry {
  id?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  architecture?: { output_modalities?: unknown };
}

export function pickModels(provider: ProviderId, data: unknown[]): string[] {
  const entries = data.filter((m): m is ModelEntry => !!m && typeof m === 'object');
  const free = (m: ModelEntry) => {
    const out = m.architecture?.output_modalities;
    return (
      String(m.pricing?.prompt) === '0' &&
      String(m.pricing?.completion) === '0' &&
      (!Array.isArray(out) || out.includes('text'))
    );
  };
  const ids = (provider === 'openrouter' ? entries.filter(free) : entries)
    .map((m) => (typeof m.id === 'string' ? m.id.replace(/^models\//, '') : ''))
    .filter(
      (id) =>
        id &&
        !NOT_CHAT.test(id) &&
        (provider !== 'gemini' || (/^(gemini|gemma)/.test(id) && !GEMINI_PAID.test(id))),
    );
  const rank = (id: string) => (id.endsWith('-latest') || id === 'openrouter/free' ? 0 : 1);
  return [...new Set(ids)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export async function listOpenAiModels(cfg: BackendConfig): Promise<string[]> {
  const { p, base, headers, doFetch } = resolve(cfg);
  const get = async (path: string) => {
    try {
      return await doFetch(`${base}/${path}`, { headers, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw networkError(err, p);
    }
  };
  // OpenRouter's model list is public, so check the key separately.
  if (p.id === 'openrouter') {
    const k = await get('key');
    if (k.status === 401 || k.status === 403) throw await httpError(k, p, '');
  }
  const r = await get('models');
  // Some compatible servers can't list models; that's no reason to refuse the connection.
  if (r.status === 404) return [];
  if (!r.ok) throw await httpError(r, p, cfg.model ?? '');
  const j = (await r.json().catch(() => ({}))) as { data?: unknown };
  return pickModels(p.id, Array.isArray(j.data) ? j.data : []);
}
