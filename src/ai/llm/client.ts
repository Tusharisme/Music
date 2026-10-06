import type { ChatRequest, PicksOutput, PicksRequest, SetPlanOutput, SetPlanRequest } from './schema';
import { useSettings } from '../../state/settings';
import type { CopilotStatus } from '../../state/ai';
import { isProviderId, providerInfo, type ProviderId } from './providers';

/**
 * Browser side of the copilot: talks to the MixMind server when it has an AI key, otherwise
 * straight to the chosen provider with the key saved in this browser.
 */

const BASE = import.meta.env.BASE_URL ?? '/';
const api = (path: string) => `${BASE}api/${path}`;

interface ServerInfo {
  ai: boolean;
  provider?: ProviderId;
  model?: string;
}

let server: ServerInfo | null = null;

async function probeServer(): Promise<ServerInfo> {
  try {
    const r = await fetch(api('health'), { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return { ai: false };
    const j = (await r.json()) as { ai?: boolean; provider?: string; model?: string };
    return {
      ai: Boolean(j.ai),
      provider: isProviderId(j.provider) ? j.provider : undefined,
      model: j.model ?? undefined,
    };
  } catch {
    return { ai: false };
  }
}

/** The provider, key, model and address this browser would use on its own. */
export function localConfig() {
  const s = useSettings.getState();
  const provider = providerInfo(s.aiProvider);
  return {
    provider,
    apiKey: (s.aiKeys[provider.id] ?? '').trim(),
    model: (s.aiModels[provider.id] ?? '').trim() || provider.defaultModel,
    baseUrl: (s.aiBaseUrls[provider.id] ?? '').trim() || provider.baseUrl,
    effort: s.effort,
  };
}

/** Work out how (and whether) the copilot can be reached: a service connected in this browser
 * first (it's the user's own choice), then the MixMind server's. */
export async function checkCopilot(force = false): Promise<CopilotStatus> {
  const s = useSettings.getState();
  if (s.aiMode === 'off')
    return { state: 'unavailable', via: null, reason: 'The AI copilot is turned off in Settings → AI.' };
  if (s.aiMode !== 'server') {
    const c = localConfig();
    const usable =
      (c.apiKey || !c.provider.needsKey) && (c.provider.kind === 'anthropic' || c.baseUrl) && c.model;
    if (usable) return { state: 'ready', via: 'byok', provider: c.provider.id, model: c.model };
  }
  if (s.aiMode !== 'byok') {
    if (server === null || force) server = await probeServer();
    if (server.ai) return { state: 'ready', via: 'server', provider: server.provider, model: server.model };
  }
  return {
    state: 'unavailable',
    via: null,
    reason:
      s.aiMode === 'server'
        ? 'The MixMind server has no AI key configured.'
        : 'Not connected yet – pick an AI service and add its key (Google Gemini and Groq are free).',
  };
}

async function direct() {
  const c = localConfig();
  const [{ createBackend }, core, { describeError }] = await Promise.all([
    import('./backend'),
    import('./core'),
    import('./errors'),
  ]);
  const fail = (err: unknown) => new Error(describeError(err).message);
  try {
    const backend = await createBackend({
      provider: c.provider.id,
      apiKey: c.apiKey,
      model: c.model,
      baseUrl: c.baseUrl,
      effort: c.effort,
    });
    return { backend, core, fail };
  } catch (err) {
    throw fail(err);
  }
}

function serverOptions() {
  const c = localConfig();
  // The server only honours these for Claude (from an allow-list); other providers use its own model.
  return { model: c.provider.id === 'anthropic' ? c.model : undefined, effort: c.effort };
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(api(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Request failed (${r.status})`);
  return j;
}

export async function askPicks(via: 'server' | 'byok', req: PicksRequest): Promise<PicksOutput> {
  if (via === 'server') return postJson<PicksOutput>('ai/picks', { ...req, options: serverOptions() });
  const { backend, core, fail } = await direct();
  try {
    return await core.runPicks(backend, req);
  } catch (err) {
    throw fail(err);
  }
}

export async function planSet(via: 'server' | 'byok', req: SetPlanRequest): Promise<SetPlanOutput> {
  if (via === 'server') return postJson<SetPlanOutput>('ai/setplan', { ...req, options: serverOptions() });
  const { backend, core, fail } = await direct();
  try {
    return await core.runSetPlan(backend, req);
  } catch (err) {
    throw fail(err);
  }
}

/** Stream a chat answer; resolves with the full text. */
export async function chat(
  via: 'server' | 'byok',
  req: ChatRequest,
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (via === 'byok') {
    const { backend, core, fail } = await direct();
    try {
      return await core.streamChat(backend, req, onText, signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      throw fail(err);
    }
  }
  const r = await fetch(api('ai/chat'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ ...req, options: serverOptions() }),
    signal,
  });
  if (!r.ok || !r.body) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `Chat failed (${r.status})`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (!data) continue;
      const ev = JSON.parse(data) as { type: string; text?: string; message?: string };
      if (ev.type === 'text' && ev.text) {
        full += ev.text;
        onText(ev.text);
      } else if (ev.type === 'error') throw new Error(ev.message ?? 'AI error');
    }
  }
  return full;
}

export interface ConnectionDraft {
  provider: ProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
}

/** Check a key/address before saving it, and fetch the models it offers. */
export async function testConnection(
  draft: ConnectionDraft,
): Promise<{ ok: boolean; message: string; models: string[] }> {
  const p = providerInfo(draft.provider);
  if (p.needsKey && !draft.apiKey)
    return { ok: false, message: `Paste your ${p.label} key first.`, models: [] };
  const [{ listModels }, { describeError }] = await Promise.all([import('./backend'), import('./errors')]);
  try {
    const models = await listModels({ provider: p.id, apiKey: draft.apiKey, baseUrl: draft.baseUrl });
    const known = !models.length || models.includes(draft.model) || draft.model.endsWith('-latest');
    return {
      ok: true,
      models,
      message: known
        ? `Connected to ${p.label}.`
        : `Connected to ${p.label}, but it doesn't list "${draft.model}" – pick a model from the list.`,
    };
  } catch (err) {
    return { ok: false, message: describeError(err).message, models: [] };
  }
}
