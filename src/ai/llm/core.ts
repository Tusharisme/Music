import type { Backend } from './backend';
import { AiError } from './errors';
import {
  PICKS_SHAPE,
  SET_PLAN_SHAPE,
  SYSTEM_PROMPT,
  chatSystem,
  libraryBlock,
  picksPrompt,
  setPlanPrompt,
} from './prompts';
import {
  PicksOutputSchema,
  SetPlanOutputSchema,
  TECHNIQUE_IDS,
  type ChatRequest,
  type DjContext,
  type PicksOutput,
  type PicksRequest,
  type SetPlanOutput,
  type SetPlanRequest,
  type TrackSummary,
} from './schema';

/**
 * Copilot tasks on top of any backend: trims the library to what the provider can take,
 * and turns its JSON into clean picks and set plans (free models are not always exact).
 */

type Technique = (typeof TECHNIQUE_IDS)[number];

/** Keep the tracks that matter most when a provider can only take part of the library. */
export function trimLibrary(
  library: TrackSummary[],
  max: number,
  keep: Iterable<string> = [],
): TrackSummary[] {
  if (library.length <= max) return library;
  const want = new Set(keep);
  return [...library.filter((t) => want.has(t.id)), ...library.filter((t) => !want.has(t.id))].slice(0, max);
}

function trimContext(ctx: DjContext, max: number): DjContext {
  const keep = [
    ...ctx.decks.flatMap((d) => (d.track ? [d.track.id] : [])),
    ...ctx.localSuggestions.map((s) => s.id),
  ];
  return { ...ctx, library: trimLibrary(ctx.library, max, keep) };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 600) =>
  (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim().slice(0, max);
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);

const TECHNIQUE_HINTS: [RegExp, Technique][] = [
  [/bass/, 'bass-swap'],
  [/echo|delay/, 'echo-out'],
  [/filter/, 'filter-fade'],
  [/roll|loop/, 'loop-roll'],
  [/cut|slam/, 'quick-cut'],
  [/ramp|tempo/, 'tempo-ramp'],
  [/reverb|wash/, 'reverb-wash'],
  [/spin|rewind/, 'spinback'],
];

export function toTechnique(v: unknown): Technique {
  const s = text(v)
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
  if ((TECHNIQUE_IDS as readonly string[]).includes(s)) return s as Technique;
  return TECHNIQUE_HINTS.find(([re]) => re.test(s))?.[1] ?? 'long-blend';
}

/** A library id from what the model wrote: the exact id, or a recognisable title or id inside it. */
function resolveId(v: unknown, library: TrackSummary[]): string | null {
  const s = text(v, 300);
  if (!s) return null;
  if (library.some((t) => t.id === s)) return s;
  const low = s.toLowerCase();
  return (
    library.find((t) => t.title.toLowerCase() === low)?.id ??
    library.find((t) => t.id.length >= 6 && low.includes(t.id.toLowerCase()))?.id ??
    null
  );
}

function bpmOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n > 40 && n < 300 ? n : null;
}

function yearOf(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  return Number.isInteger(n) && n >= 1900 && n <= new Date().getFullYear() + 1 ? n : null;
}

export function normalizePicks(raw: unknown, library: TrackSummary[], discover: boolean): PicksOutput {
  const o = isObj(raw) ? raw : {};
  const seen = new Set<string>();
  const picks: PicksOutput['picks'] = [];
  for (const p of list(o.picks)) {
    const id = resolveId(p.trackId ?? p.id ?? p.track ?? p.title, library);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    picks.push({
      trackId: id,
      why: text(p.why ?? p.reason),
      technique: toTechnique(p.technique),
      tip: text(p.tip ?? p.mixTip),
    });
    if (picks.length === 4) break;
  }
  const found = discover
    ? list(o.discover)
        .map((d) => ({
          title: text(d.title, 200),
          artist: text(d.artist, 200),
          album: text(d.album ?? d.film ?? d.movie, 200) || null,
          year: yearOf(d.year),
          why: text(d.why ?? d.reason),
          bpm: bpmOf(d.bpm),
          key: text(d.key, 8) || null,
          mixTip: text(d.mixTip ?? d.tip),
        }))
        .filter((d) => d.title && d.artist)
        .slice(0, 5)
    : [];
  if (!picks.length && !found.length)
    throw new AiError('The AI answer had no usable tracks – try again.', 502, '', 'format');
  return {
    headline: text(o.headline, 200) || (picks.length ? 'Here’s what I’d play next' : 'New music to dig for'),
    picks,
    discover: found,
  };
}

export function normalizeSetPlan(raw: unknown, library: TrackSummary[]): SetPlanOutput {
  const o = isObj(raw) ? raw : {};
  const seen = new Set<string>();
  const items: SetPlanOutput['items'] = [];
  for (const i of list(o.items ?? o.tracks ?? o.tracklist)) {
    const id = resolveId(i.trackId ?? i.id ?? i.track ?? i.title, library);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    items.push({ trackId: id, note: text(i.note ?? i.why), technique: toTechnique(i.technique) });
  }
  if (!items.length) throw new AiError('The AI answer had no usable tracks – try again.', 502, '', 'format');
  return { title: text(o.title, 120) || 'Your set', arc: text(o.arc), items };
}

/** Chat APIs want turns that alternate and start with the user. */
function mergeTurns(messages: ChatRequest['messages']): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const m of messages) {
    const last = out[out.length - 1];
    if (!last && m.role !== 'user') continue;
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.text}`;
    else out.push({ role: m.role, content: m.text });
  }
  return out;
}

export async function runPicks(
  backend: Backend,
  req: PicksRequest,
  signal?: AbortSignal,
): Promise<PicksOutput> {
  const context = trimContext(req.context, backend.maxTracks);
  const raw = await backend.json({
    name: 'dj_picks',
    schema: PicksOutputSchema,
    system: SYSTEM_PROMPT,
    library: libraryBlock(context.library),
    prompt: picksPrompt({ ...req, context }),
    shape: PICKS_SHAPE,
    signal,
  });
  return normalizePicks(raw, context.library, req.discover);
}

export async function runSetPlan(
  backend: Backend,
  req: SetPlanRequest,
  signal?: AbortSignal,
): Promise<SetPlanOutput> {
  const library = trimLibrary(req.library, backend.maxTracks, req.startTrackId ? [req.startTrackId] : []);
  const raw = await backend.json({
    name: 'dj_set_plan',
    schema: SetPlanOutputSchema,
    system: SYSTEM_PROMPT,
    library: libraryBlock(library),
    prompt: setPlanPrompt({ ...req, library }),
    shape: SET_PLAN_SHAPE,
    signal,
  });
  return normalizeSetPlan(raw, library);
}

export async function streamChat(
  backend: Backend,
  req: ChatRequest,
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const messages = mergeTurns(req.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user')
    throw new AiError('Nothing to answer.', 400, '', 'setup');
  const context = trimContext(req.context, backend.maxTracks);
  return backend.chat(
    {
      system: SYSTEM_PROMPT,
      library: libraryBlock(context.library),
      tail: chatSystem({ ...req, context }),
      messages,
    },
    onText,
    signal,
  );
}
