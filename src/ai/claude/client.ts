import type { ChatRequest, PicksOutput, PicksRequest, SetPlanOutput, SetPlanRequest } from './schema';
import { useSettings } from '../../state/settings';
import type { ClaudeStatus } from '../../state/ai';

const BASE = import.meta.env.BASE_URL ?? '/';
const api = (path: string) => `${BASE}api/${path}`;

let serverAvailable: boolean | null = null;
let serverModel: string | undefined;

async function probeServer(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(api('health'), { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const j = (await r.json()) as { ai?: boolean; model?: string };
    serverModel = j.model;
    return Boolean(j.ai);
  } catch {
    return false;
  }
}

/** Work out how (and whether) Claude can be reached: own server first, then the user's key. */
export async function checkClaude(force = false): Promise<ClaudeStatus> {
  const s = useSettings.getState();
  if (s.aiMode === 'off')
    return { state: 'unavailable', via: null, reason: 'Claude features are turned off in Settings.' };
  if (serverAvailable === null || force) serverAvailable = await probeServer();
  if (serverAvailable && s.aiMode !== 'byok') return { state: 'ready', via: 'server', model: serverModel };
  if (s.apiKey.trim() && s.aiMode !== 'server') return { state: 'ready', via: 'byok', model: s.model };
  return {
    state: 'unavailable',
    via: null,
    reason:
      serverAvailable === false && s.aiMode === 'server'
        ? 'The MixMind server has no API key configured.'
        : 'Add an Anthropic API key in Settings → AI to enable the Claude copilot.',
  };
}

function aiOptions() {
  const s = useSettings.getState();
  return { model: s.model, effort: s.effort };
}

async function byokClient() {
  const [{ default: Anthropic }, core] = await Promise.all([import('@anthropic-ai/sdk'), import('./core')]);
  const client = new Anthropic({
    apiKey: useSettings.getState().apiKey.trim(),
    dangerouslyAllowBrowser: true,
  });
  return { client, core };
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

function byokError(core: typeof import('./core'), err: unknown): Error {
  return new Error(core.describeError(err).message);
}

export async function askPicks(via: 'server' | 'byok', req: PicksRequest): Promise<PicksOutput> {
  if (via === 'server') return postJson<PicksOutput>('ai/picks', { ...req, options: aiOptions() });
  const { client, core } = await byokClient();
  try {
    return await core.runPicks(client, req, aiOptions());
  } catch (err) {
    throw byokError(core, err);
  }
}

export async function planSet(via: 'server' | 'byok', req: SetPlanRequest): Promise<SetPlanOutput> {
  if (via === 'server') return postJson<SetPlanOutput>('ai/setplan', { ...req, options: aiOptions() });
  const { client, core } = await byokClient();
  try {
    return await core.runSetPlan(client, req, aiOptions());
  } catch (err) {
    throw byokError(core, err);
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
    const { client, core } = await byokClient();
    try {
      return await core.streamChat(client, req, aiOptions(), onText, signal);
    } catch (err) {
      throw byokError(core, err);
    }
  }
  const r = await fetch(api('ai/chat'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
    body: JSON.stringify({ ...req, options: aiOptions() }),
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
