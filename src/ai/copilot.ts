import { useAI, type ChatMessage } from '../state/ai';
import { useLibrary } from '../state/library';
import { useDecks } from '../state/decks';
import { useUI } from '../state/ui';
import { askPicks, chat, checkCopilot, planSet } from './llm/client';
import { buildContext, summarizeTrack } from './llm/context';
import type { TrackSummary } from './llm/schema';

/** UI-facing actions for the AI copilot (status, picks, chat, set planner). */

export async function refreshCopilotStatus(force = false): Promise<void> {
  if (force) useAI.getState().patch({ copilot: { state: 'checking', via: null } });
  useAI.getState().patch({ copilot: await checkCopilot(force) });
}

function via(): 'server' | 'byok' | null {
  const c = useAI.getState().copilot;
  return c.state === 'ready' ? c.via : null;
}

function push(msg: ChatMessage): void {
  const ai = useAI.getState();
  ai.patch({ chat: [...ai.chat, msg] });
}

function replaceLast(msg: ChatMessage): void {
  const ai = useAI.getState();
  ai.patch({ chat: [...ai.chat.slice(0, -1), msg] });
}

export async function askForPicks(request?: string, discover = true): Promise<void> {
  const v = via();
  if (!v)
    return useUI
      .getState()
      .toast(useAI.getState().copilot.reason ?? 'The AI copilot is not set up.', 'error');
  const ai = useAI.getState();
  if (ai.picksBusy) return;
  const ctx = buildContext();
  if (!ctx.decks.some((d) => d.track))
    return useUI.getState().toast('Load a track first so the AI knows what you are playing.', 'error');
  ai.patch({ picksBusy: true });
  push({ role: 'user', text: request?.trim() || 'What should I play next?' });
  push({ role: 'assistant', text: '' });
  try {
    const picks = await askPicks(v, { context: ctx, request, discover });
    replaceLast({
      role: 'assistant',
      text: picks.headline,
      picks: { headline: picks.headline, picks: picks.picks, discover: picks.discover },
    });
  } catch (err) {
    replaceLast({ role: 'assistant', text: (err as Error).message, error: true });
  } finally {
    useAI.getState().patch({ picksBusy: false });
  }
}

let chatAbort: AbortController | null = null;

export async function sendChat(text: string): Promise<void> {
  const v = via();
  if (!v)
    return useUI
      .getState()
      .toast(useAI.getState().copilot.reason ?? 'The AI copilot is not set up.', 'error');
  if (!text.trim() || useAI.getState().chatBusy) return;
  push({ role: 'user', text: text.trim() });
  const history = useAI
    .getState()
    .chat.filter((m) => !m.error && m.text)
    .slice(-12)
    .map((m) => ({
      role: m.role,
      text: m.picks
        ? `${m.text}\n${m.picks.picks.map((p) => `- ${p.trackId}: ${p.why}`).join('\n')}`
        : m.text,
    }));
  push({ role: 'assistant', text: '' });
  useAI.getState().patch({ chatBusy: true });
  chatAbort = new AbortController();
  let acc = '';
  try {
    await chat(
      v,
      { context: buildContext(), messages: history },
      (d) => {
        acc += d;
        replaceLast({ role: 'assistant', text: acc });
      },
      chatAbort.signal,
    );
  } catch (err) {
    if ((err as Error).name !== 'AbortError')
      replaceLast({
        role: 'assistant',
        text: acc ? `${acc}\n\n⚠ ${(err as Error).message}` : (err as Error).message,
        error: !acc,
      });
  } finally {
    chatAbort = null;
    useAI.getState().patch({ chatBusy: false });
  }
}

export function stopChat(): void {
  chatAbort?.abort();
}

export async function buildSetPlan(durationMin: number, vibe: string): Promise<void> {
  const v = via();
  if (!v)
    return useUI
      .getState()
      .toast(useAI.getState().copilot.reason ?? 'The AI copilot is not set up.', 'error');
  const tracks = Object.values(useLibrary.getState().tracks);
  const library = tracks
    .map(summarizeTrack)
    .filter((x): x is TrackSummary => !!x)
    .slice(0, 400);
  if (library.length < 3) return useUI.getState().toast('Add a few more analysed tracks first.', 'error');
  const { decks, master } = useDecks.getState();
  const startTrackId = decks[master].trackId ?? undefined;
  useAI.getState().patch({ setPlanBusy: true });
  try {
    const plan = await planSet(v, { library, durationMin, vibe, startTrackId });
    useAI.getState().patch({ setPlan: plan });
  } catch (err) {
    useUI.getState().toast((err as Error).message, 'error');
  } finally {
    useAI.getState().patch({ setPlanBusy: false });
  }
}

export function clearChat(): void {
  useAI.getState().patch({ chat: [] });
}
